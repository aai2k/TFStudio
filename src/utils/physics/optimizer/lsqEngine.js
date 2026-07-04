/**
 * `LSQEngine` — the shared analytic least-squares optimization engine for
 * thin-film merit functions. It owns the eval context, residuals, the exact
 * analytic Jacobian / Hessian assembly, gradient (`gradMF`), bounds/locks,
 * convergence, and the Levenberg–Marquardt (DLS) `step()`. The second-order
 * STEP STRATEGIES live in their own subclass files (newton.js / newtonCG.js /
 * sqp.js, each `extends LSQEngine`); they reuse this engine's system assemblers
 * (`_newtonSystem`, `_gaussNewtonSystem`, `_thicknessBounds`, `_projectBestToBox`)
 * and the LM fallback (`lmStep`).
 *
 * `DLSOptimizer` (the plain DLS/LM refiner, and the evaluator wrapped by the
 * EngineBase CG/DE/SA optimizers) is `LSQEngine` with the inherited LM `step()`.
 *
 * Imports the eval core (merit + Jacobian
 * eval), pure linalg solvers, and layer ops.
 * References: Sullivan & Dobrowolski Appl. Opt. 35 (1996); Nocedal & Wright 2e.
 */

import { tmm, tmmNeedleScan, tmmThicknessJacobian } from '../thinFilmMath.js';
import { resolveSourceSpec, resolveDetectorSpec } from '../spectralWeightings.js';
import {
    tmmJacEval, tmmHessEval, tmmNeedleScanEval, ADAPTIVE_SAMPLING_DEFAULTS, densifyOperandsForFeatures, collectDesignMaterialIds, tmmFullSystem,
    isFullSystemEval, resolveEvalMode, tmmProp, MATH_REGISTRY, makeRefResolver, computeMathValue,
    mathResidual, mathResidualKind, evalOperand, buildEvalContext, evaluateOperands, ARGWAVE_RESIDUAL_SCALE_NM,
    operandResidualScale, calcMF, mfWeightDenominator,
} from './evalCore.js';
import {
    OPTICAL_OPERAND_TYPES, RANGE_TARGET_OPERAND_TYPES, TOTAL_THICKNESS_OPERAND_TYPES, BLANK_OPERAND_TYPES, INTEGRAL_OPERAND_TYPES, MINMAX_OPERAND_TYPES,
    CONSTRAINT_OPERAND_TYPES, INEQUALITY_OPERAND_TYPES, MATH_OPERAND_TYPES, ARGWAVE_OPERAND_TYPES, OPERAND_TYPES, OPERAND_POLS,
    isConstraint, isDmfs, isBlank, isTotalThickness, isRangeTarget, isIntegral,
    isMinmax, isMinType, isInequality, isArgwave, isArgwaveMin, isMath,
    isMathSingleRef, isMathPairRef, isFractionalUnit, mathTargetInPercent, argwaveOpticalChar, argwavePolCode,
    polFromType, AVG_POINTS, AVG_STEP_NM, AVG_POINTS_MAX, bandSampleCount, ARGWAVE_DEFAULT_POINTS,
    PNORM_DEFAULT, makeOperand, isRamp, makeConstraintOperand, makeDefaultConstraints, makeDmfsOperand,
} from './operandModel.js';
import { isRangeAvg, charOf, operandSampleLambdas, requiredLambdas, buildPresampledTable } from './sampling.js';
import { makeConeSpec, coneIsActive } from './coneAngle.js';
import { mirrorLayers, insertNeedle, cleanupLayers, bestNeedlePerPosition, insertNeedleIntra } from './layerOps.js';
import { solveLeastSquaresQR, choleskySolve, steihaugCG, solveBoxQP, _vdot, _vnorm } from './linalg.js';

// ── DLS Optimizer (Levenberg-Marquardt) ───────────────────────────────────────
//
// Reference: Sullivan & Dobrowolski, Appl. Opt. 35, 5484-5492 (1996).
// Jacobian computed via central finite differences over all operands.

export class LSQEngine {
    constructor(operands, design, resolveMat, opts = {}) {
        this.operands    = operands;
        this.resolveMat  = resolveMat;
        this.surfaceMode = design?.surfaceMode || 'front_only';
        this.mfEvalMode  = design?.mfEvalMode  || 'side';
        // When true, the MF is scored against the full system even though only
        // one side carries optimization variables (front_only/back_only + total).
        this.evalFullSystem = isFullSystemEval(this.surfaceMode, this.mfEvalMode);
        // Cone-angle averaging. Normalized once; flows into every
        // _ctxFor() so the merit/residuals are cone-averaged. When active the
        // analytic Jacobian (a single-angle read) is declined so the gradient
        // falls back to FD, which differences the cone-averaged residuals and
        // therefore stays exactly consistent with the MF.
        this.cone        = makeConeSpec(design?.cone || {});
        this.layerSide   = 'frontLayers';   // legacy field; callers may inspect

        const front = design.frontLayers || [];
        const backRaw = design.backLayers || [];
        // In symmetric mode the back stack is a mirror of the front: the
        // physical sequence outward from the substrate is identical on both
        // sides, so back = reverse(front) (not a plain copy). No independent
        // back variables — just a sync rule.
        const back  = this.surfaceMode === 'symmetric' ? [...front].reverse() : backRaw;

        const inc  = typeof design.incidentMedium === 'string' ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
        const exit = typeof design.exitMedium     === 'string' ? design.exitMedium     : (design.exitMedium?.material     ?? 'Air');

        this.n0mat = resolveMat(inc);
        this.nsmat = resolveMat(design.substrate?.material ?? 'BK7');
        this.neMat = resolveMat(exit);
        this.substrateThicknessMm = design.substrate?.thickness ?? 1.0;

        this.frontMats        = front.map(l => resolveMat(l.material));
        this.frontThicks      = front.map(l => l.thickness || 0);
        this.frontLockedMask  = front.map(l => !!l.locked);
        this.backMats         = back.map(l => resolveMat(l.material));
        this.backThicks       = back.map(l => l.thickness || 0);
        this.backLockedMask   = back.map(l => !!l.locked);
        this.nFront           = this.frontThicks.length;
        this.nBack            = this.backThicks.length;

        // Optimization variable vector. Layout depends on surfaceMode:
        //   front_only      → [front...]                  back is bare substrate (ignored)
        //   back_only       → [back...]                   front held fixed, optimize back
        //   symmetric       → [front...]                  back is auto-mirrored every eval
        //   both_independent→ [front..., back...]         optimize both
        if (this.surfaceMode === 'both_independent') {
            this.thicknesses = [...this.frontThicks, ...this.backThicks];
            this.mats        = [...this.frontMats, ...this.backMats];
            this.lockedMask  = [...this.frontLockedMask, ...this.backLockedMask];
        } else if (this.surfaceMode === 'back_only') {
            this.thicknesses = [...this.backThicks];
            this.mats        = [...this.backMats];
            this.lockedMask  = [...this.backLockedMask];
        } else {
            this.thicknesses = [...this.frontThicks];
            this.mats        = [...this.frontMats];
            this.lockedMask  = [...this.frontLockedMask];
        }

        this.D_MIN  = opts.dMin   ?? 1.0;
        this.D_MAX  = opts.dMax   ?? 2000.0;
        this.lamD   = opts.lamInit ?? 1e-2;
        this.lamN   = opts.lamNInit ?? 1e-3;   // modified-Newton damping state (newtonStep)
        this.lamS   = opts.lamSInit ?? 1e-3;   // bounded-SQP damping state (sqpStep)
        this.tol    = opts.tol    ?? 1e-7;
        this.h      = opts.fdStep ?? 1.0;

        const comp0    = evaluateOperands(this.operands, this._ctxFor(this.thicknesses));
        this.mf        = calcMF(this.operands, comp0);
        this.mfBest    = this.mf;
        this.thickBest = [...this.thicknesses];
        this.iter      = 0;
    }

    // Build the eval-context for a candidate thickness vector, splitting it
    // into front/back according to surfaceMode.
    _ctxFor(thk) {
        let frontThicks, frontMats, backThicks, backMats;
        if (this.surfaceMode === 'both_independent') {
            frontThicks = thk.slice(0, this.nFront);
            backThicks  = thk.slice(this.nFront);
            frontMats   = this.frontMats;
            backMats    = this.backMats;
        } else if (this.surfaceMode === 'symmetric') {
            // Mirror symmetry: back is the front stack reversed (front is
            // stored air→sub, back is stored sub→exit, so an identical
            // physical coating means back = reverse(front)).
            frontThicks = thk;
            backThicks  = [...thk].reverse();
            frontMats   = this.frontMats;
            backMats    = [...this.frontMats].reverse();
        } else if (this.surfaceMode === 'back_only') {
            // Back is the optimization vector. Front is fixed — kept in ctx so a
            // 'total' MF evaluates the back coating against the whole filter
            // (fixed front + substrate). In 'side' mode tmmProp reads only the
            // back stack, so the fixed front is simply ignored.
            frontThicks = this.frontThicks;
            backThicks  = thk;
            frontMats   = this.frontMats;
            backMats    = this.backMats;
        } else {
            // front_only: front is the optimization vector. The back coating is
            // fixed; include it only for 'total' MF (otherwise empty → the
            // legacy single-front-surface model is used by tmmProp).
            frontThicks = thk;
            frontMats   = this.frontMats;
            backThicks  = this.evalFullSystem ? this.backThicks : [];
            backMats    = this.evalFullSystem ? this.backMats   : [];
        }
        return {
            _isEvalContext:       true,
            surfaceMode:          this.surfaceMode,
            mfEvalMode:           this.mfEvalMode,
            evalFullSystem:       this.evalFullSystem,
            cone:                 this.cone,
            n0mat:                this.n0mat,
            nsmat:                this.nsmat,
            neMat:                this.neMat,
            substrateThicknessMm: this.substrateThicknessMm,
            frontThicks, frontMats,
            backThicks,  backMats,
            fullThicks:           thk,    // constraints act on the full optimization vector
        };
    }

    // `compBase` (optional) — a precomputed evaluateOperands() result for THIS
    // exact thickness vector, threaded in by a caller that has already evaluated
    // the base point (e.g. step()/_newtonSystem/gradMF, which also need the
    // Jacobian at the same thk). evaluateOperands is pure & deterministic given
    // the (thk-derived) context, so reusing it is bit-identical and skips one
    // full TMM operand sweep per step (M5). Omitted ⇒ evaluate here as before
    // (perturbed FD points always recompute — they pass no compBase).
    _residuals(thicknesses, compBase) {
        const comp = compBase !== undefined
            ? compBase
            : evaluateOperands(this.operands, this._ctxFor(thicknesses));
        const out = [];
        for (let i = 0; i < this.operands.length; i++) {
            const op = this.operands[i];
            if (!op.enabled || comp[i] == null) continue;
            let res;
            if (isConstraint(op.type)) {
                // One-sided thickness-bound penalty. Always pushed (0 when
                // satisfied) so the residual vector keeps a fixed length
                // across perturbed evaluations — required for the Jacobian.
                res = op.type === 'MNT'
                    ? Math.max(0, op.target - comp[i])
                    : Math.max(0, comp[i] - op.target);
            } else if (isMinmax(op.type)) {
                // Worst-case "T ≥ target" (min) or "R ≤ target" (max): only the
                // violation contributes. comp[i] is the soft-min / soft-max.
                res = isMinType(op.type)
                    ? Math.max(0, op.target - comp[i])
                    : Math.max(0, comp[i] - op.target);
            } else if (isMath(op.type)) {
                // Zemax-style math operand: residual semantics declared in
                // MATH_RESIDUAL_KIND (one-sided for OPGT/OPLT/ABGT/ABLT,
                // equality for OPVA/ABSO/DIFF/SUMM/PROD).
                res = mathResidual(op, comp[i]);
            } else if (isTotalThickness(op.type)) {
                // Total-thickness target (nm). cmp 'le'/'ge' → one-sided
                // constraint residual (0 when satisfied; always pushed so the
                // residual vector keeps a fixed length for the Jacobian);
                // default → two-sided equality.
                res = op.cmp === 'le' ? Math.max(0, comp[i] - op.target)
                    : op.cmp === 'ge' ? Math.max(0, op.target - comp[i])
                    :                   comp[i] - op.target;
            } else if (isRamp(op)) {
                // Ramp: comp[i] is the RMS deviation from the target line already.
                res = comp[i];
            } else {
                // Includes optical single-λ, range-avg, and weighted-integral
                // (TIW/RIW/AIW) — all two-sided "hit the target" residuals.
                res = comp[i] - op.target;
            }
            // Same per-type unit normalization as calcMF (σ = 1 for optical, so
            // pure-optical residuals are unchanged; argwave nm ÷ σ_λ). The FD
            // Jacobian differences this vector, so it inherits σ automatically;
            // the analytic Jacobian only runs when σ = 1 everywhere.
            const scaled = Math.sqrt(op.weight) * res / operandResidualScale(op);
            // Guard against a NaN/Inf residual poisoning the QR/LM solve. Unlike
            // calcMF (a scalar reduction where skipping is safe), the residual
            // vector MUST keep a fixed length aligned row-for-row with the
            // analytic Jacobian and with the base/perturbed vectors the FD
            // Jacobian differences — so substitute a finite 0 instead of
            // skipping the entry. A degenerate (all-NaN) design is then rejected
            // by the accept test, since calcMF returns Infinity for it.
            out.push(Number.isFinite(scaled) ? scaled : 0);
        }
        return out;
    }

    // Analytic ∂(residual)/∂(thickness) Jacobian (Macleod Eq. 2.111/2.113 +
    // Sullivan & Dobrowolski 1996 pre/post derivative, via
    // tmmThicknessJacobian). Rows align EXACTLY with _residuals() (same
    // operand iteration & skip logic).
    //
    // Per-surface-mode model:
    //   front_only       → single-front-surface TMM Jacobian, direct read.
    //   back_only        → single-back-surface TMM on REVERSED back stack
    //                      (light from exit medium); storage→reversed-position
    //                      mapping applied when reading derivatives out.
    //   symmetric        → full-system (Macleod §2.6.4) chain rule; thk[i]
    //                      drives front layer i AND back layer (N-1-i),
    //                      contributions summed.
    //   both_independent → full-system chain rule; free-variable layout is
    //                      [front..., back...], front side reads from the
    //                      front sub-Jacobian, back side from the back.
    //
    // Returns null for unsupported merit-function term types so step()
    // can fall back to FD where the analytic chain rule isn't worked out.
    // `compBase` (optional) — precomputed evaluateOperands() for this exact thk,
    // shared with the caller's _residuals() base eval (M5). Used only for the
    // operand-level reduction (which λ* a band-extremum picked, ramp RMS, the
    // violated tests); the Jacobian's own TMM derivatives are computed separately
    // via tmmJacEval. Omitted ⇒ evaluate here as before. Bit-identical either way.
    _analyticJacobian(thk, freeIdx, compBase) {
        // Cone-angle averaging: the analytic chain rule is derived
        // for a single incidence angle. With a cone active the residuals are a
        // weighted sum over many angles, so decline → callers use the FD path,
        // which differences the cone-averaged _residuals and is consistent by
        // construction. (Cone-summing the analytic Jacobian is a future speedup.)
        if (coneIsActive(this.cone)) return null;
        const surfaceMode = this.surfaceMode || 'front_only';
        // Variable layout (which free vars exist) is set by surfaceMode; whether
        // the MF is scored full-system is set by evalFullSystem. front_only/
        // back_only + 'total' reuse the validated full-system chain rule but with
        // free variables on one side only (the other side is fixed).
        const evalFull      = !!this.evalFullSystem;
        const isFull        = evalFull || surfaceMode === 'symmetric' || surfaceMode === 'both_independent';
        const isSingleFront = !isFull && surfaceMode === 'front_only';
        const isSingleBack  = !isFull && surfaceMode === 'back_only';
        // How free variables map onto front/back per-layer derivatives.
        const varSide = surfaceMode === 'both_independent' ? 'both'
                      : surfaceMode === 'symmetric'        ? 'symmetric'
                      : surfaceMode === 'back_only'        ? 'back'
                      :                                      'front';

        const ctx  = this._ctxFor(thk);
        const comp = compBase !== undefined ? compBase : evaluateOperands(this.operands, ctx);
        const nFree = freeIdx.length;
        const N = thk.length;   // total free-variable count (= mats.length)

        // Cache one Jacobian package per (λ, polCode, aoi) — reused across
        // all operands that sample the same point. For full-system we cache
        // THREE sub-Jacobians (front-forward, front-reverse, back) plus the
        // composed system R/T/A and per-side derivatives ∂R_sys/∂d_*,
        // ∂T_sys/∂d_*, ∂A_sys/∂d_*; for single-surface modes we cache one.
        const jacCache = new Map();
        const subThickMm = this.substrateThicknessMm;

        const computeJac = (lam, polCode, aoi) => {
            if (isSingleFront) {
                const n0 = this.n0mat.getNK(lam);
                const ns = this.nsmat.getNK(lam);
                const layers = thk.map((d, i) => ({ n: this.mats[i].getNK(lam), d }));
                const J = tmmJacEval(lam, aoi, polCode, n0, ns, layers);
                return { kind: 'singleFront', R: J.R, T: J.T, A: J.A,
                         dR: J.dRdd, dT: J.dTdd, dA: J.dAdd };
            }
            if (isSingleBack) {
                // backThicks are stored substrate→exit; for light incident from
                // the exit medium the TMM sees them in exit→substrate order, so
                // reverse for the call. Derivatives indexed in reversed-stack
                // positions; map back to storage indices on the way out.
                const n0 = this.neMat.getNK(lam);
                const ns = this.nsmat.getNK(lam);
                const layersRev = [];
                for (let i = N - 1; i >= 0; i--) {
                    layersRev.push({ n: this.mats[i].getNK(lam), d: thk[i] });
                }
                const J = tmmJacEval(lam, aoi, polCode, n0, ns, layersRev);
                const dR = new Array(N), dT = new Array(N), dA = new Array(N);
                for (let i = 0; i < N; i++) {
                    const j = N - 1 - i;
                    dR[i] = J.dRdd[j]; dT[i] = J.dTdd[j]; dA[i] = J.dAdd[j];
                }
                return { kind: 'singleBack', R: J.R, T: J.T, A: J.A, dR, dT, dA };
            }
            // ── Full system (symmetric / both_independent) ─────────────────
            // Compose three TMM Jacobians via Macleod §2.6.4:
            //   T_sys = T_f · P · T_b / (1 − R_f' · R_b · P²)
            //   R_sys = R_f + T_f · T_f' · P² · R_b / (1 − R_f' · R_b · P²)
            // Then propagate per-layer ∂R/∂d, ∂T/∂d through the same chain
            // rule used in scanNeedlesAnalytic (front insertions read fwd+rev,
            // back insertions read bck).
            const n0 = this.n0mat.getNK(lam);
            const ns = this.nsmat.getNK(lam);
            const ne = this.neMat.getNK(lam);

            const sin0 = Math.sin(aoi * Math.PI / 180);
            const sinSub = ns[0] > 0 ? Math.min(1, n0[0] * sin0 / ns[0]) : 0;
            const cosSub = Math.sqrt(1 - sinSub * sinSub);
            const aoiSub = Math.asin(sinSub) * 180 / Math.PI;

            const frontMats   = ctx.frontMats;
            const frontThicks = ctx.frontThicks;
            const backMats    = ctx.backMats;
            const backThicks  = ctx.backThicks;

            const fLayers    = frontThicks.map((d, i) => ({ n: frontMats[i].getNK(lam), d }));
            const fLayersRev = [...fLayers].reverse();
            const bLayers    = backThicks.map((d, i)  => ({ n: backMats[i].getNK(lam),  d }));

            const Jfwd = tmmJacEval(lam, aoi,    polCode, n0, ns, fLayers);
            const Jrev = tmmJacEval(lam, aoiSub, polCode, ns, n0, fLayersRev);
            const Jbck = tmmJacEval(lam, aoiSub, polCode, ns, ne, bLayers);

            const k_sub    = ns[1];
            const d_sub_nm = subThickMm * 1e6;
            const P  = (k_sub > 0 && cosSub > 0)
                ? Math.exp(-4 * Math.PI * k_sub * d_sub_nm / (lam * cosSub))
                : 1.0;
            const P2 = P * P;

            const Rf  = Jfwd.R, Tf  = Jfwd.T;
            const Rfp = Jrev.R, Tfp = Jrev.T;
            const Rb  = Jbck.R, Tb  = Jbck.T;

            const D     = 1 - Rfp * Rb * P2;
            const invD2 = 1 / (D * D);
            const R_sys = Rf + (Tf * Tfp * P2 * Rb) / D;
            const T_sys = (Tf * P * Tb) / D;
            const A_sys = Math.max(0, 1 - R_sys - T_sys);

            const Nf = fLayers.length, Nb = bLayers.length;
            const dR_front = new Array(Nf), dT_front = new Array(Nf), dA_front = new Array(Nf);
            for (let i = 0; i < Nf; i++) {
                const dRf  = Jfwd.dRdd[i],          dTf  = Jfwd.dTdd[i];
                // Front layer i (storage air→sub) sits at reversed-pass index (Nf-1-i).
                const dRfp = Jrev.dRdd[Nf - 1 - i], dTfp = Jrev.dTdd[Nf - 1 - i];
                const dT   = (P * Tb) * invD2 * (D * dTf + Tf * P2 * Rb * dRfp);
                const dR   = dRf + (P2 * Rb) * invD2 *
                                (D * (dTf * Tfp + Tf * dTfp) + Tf * Tfp * P2 * Rb * dRfp);
                dR_front[i] = dR; dT_front[i] = dT; dA_front[i] = -(dR + dT);
            }
            const dR_back = new Array(Nb), dT_back = new Array(Nb), dA_back = new Array(Nb);
            for (let i = 0; i < Nb; i++) {
                const dRb = Jbck.dRdd[i], dTb = Jbck.dTdd[i];
                const dT  = (P * Tf) * invD2 * (D * dTb + Tb * P2 * Rfp * dRb);
                const dR  = (Tf * Tfp * P2) * invD2 * dRb;
                dR_back[i] = dR; dT_back[i] = dT; dA_back[i] = -(dR + dT);
            }

            return { kind: 'full', R: R_sys, T: T_sys, A: A_sys,
                     dR_front, dT_front, dA_front,
                     dR_back,  dT_back,  dA_back };
        };
        const getJac = (lam, polCode, aoi) => {
            const key = lam + '|' + polCode + '|' + aoi;
            let v = jacCache.get(key);
            if (v === undefined) { v = computeJac(lam, polCode, aoi); jacCache.set(key, v); }
            return v;
        };

        // Map per-side per-layer derivatives onto the free-variable vector
        // (length N, same indexing as thk/freeIdx).
        const nFront = this.nFront, nBack = this.nBack;
        const accumulateInto = (out, J, char, weight) => {
            if (J.kind === 'singleFront' || J.kind === 'singleBack') {
                const d = char === 'T' ? J.dT : char === 'R' ? J.dR : J.dA;
                for (let i = 0; i < N; i++) out[i] += weight * d[i];
                return;
            }
            // full system — map per-side per-layer derivatives onto the free vec
            const df = char === 'T' ? J.dT_front : char === 'R' ? J.dR_front : J.dA_front;
            const db = char === 'T' ? J.dT_back  : char === 'R' ? J.dR_back  : J.dA_back;
            if (varSide === 'symmetric') {
                // thk[i] is the front variable; the auto-mirrored back layer
                // (Nb-1-i) shares the same physical thickness, so its
                // sensitivity adds to the same free variable. (Nf = Nb = N
                // by construction in symmetric mode.)
                for (let i = 0; i < N; i++) {
                    out[i] += weight * (df[i] + db[N - 1 - i]);
                }
            } else if (varSide === 'both') {
                // both_independent: free vector is [front..., back...]
                for (let i = 0; i < nFront; i++) out[i]          += weight * df[i];
                for (let i = 0; i < nBack;  i++) out[nFront + i] += weight * db[i];
            } else if (varSide === 'back') {
                // back_only + total: free vars = back layers only; the front
                // (fixed) contributes to the system value but has no free var.
                for (let i = 0; i < nBack; i++) out[i] += weight * db[i];
            } else {
                // front_only + total: free vars = front layers only; the back
                // (fixed) contributes to the system value but has no free var.
                for (let i = 0; i < nFront; i++) out[i] += weight * df[i];
            }
        };

        // ∂(property)/∂d for every free variable at one λ, honoring pol='avg'
        // (½(s+p)) — matches the polarization handling in tmm* eval paths.
        const propDeriv = (lam, pol, char, aoi) => {
            const out = new Array(N).fill(0);
            if (pol === 'avg') {
                accumulateInto(out, getJac(lam, 's', aoi), char, 0.5);
                accumulateInto(out, getJac(lam, 'p', aoi), char, 0.5);
            } else {
                accumulateInto(out, getJac(lam, pol, aoi), char, 1.0);
            }
            return out;
        };
        const pickV = (Jc, char) => char === 'T' ? Jc.T : char === 'R' ? Jc.R : Jc.A;
        const propVal = (lam, pol, char, aoi) => {
            if (pol === 'avg')
                return 0.5 * (pickV(getJac(lam, 's', aoi), char) + pickV(getJac(lam, 'p', aoi), char));
            return pickV(getJac(lam, pol, aoi), char);
        };

        const J = [];
        for (let i = 0; i < this.operands.length; i++) {
            const op = this.operands[i];
            if (!op.enabled || comp[i] == null) continue;
            const row = new Array(nFree).fill(0);
            const sw  = Math.sqrt(op.weight);

            if (isConstraint(op.type)) {
                // Subgradient of sw·max(0, ±(target−comp)); comp = min (MNT)
                // or max (MXT) over the 1-based layer-index range.
                const all = ctx.fullThicks || ctx.frontThicks || [];
                const lo = Math.max(0, Math.round(op.lambdaStart) - 1);
                const hi = Math.min(all.length - 1, Math.round(op.lambdaEnd) - 1);
                if (lo <= hi) {
                    let argj = lo, best = all[lo] || 0;
                    for (let jj = lo; jj <= hi; jj++) {
                        const v = all[jj] || 0;
                        if (op.type === 'MNT' ? v < best : v > best) { best = v; argj = jj; }
                    }
                    const violated = op.type === 'MNT'
                        ? (op.target - comp[i] > 0)
                        : (comp[i] - op.target > 0);
                    if (violated) {
                        const ci = freeIdx.indexOf(argj);
                        if (ci >= 0) row[ci] = sw * (op.type === 'MNT' ? -1 : 1);
                    }
                }
                J.push(row);
                continue;
            }

            // ── Argwave (MXW*/MNW*) — defer to FD ────────────────────────────
            // The envelope-theorem analytic gradient of an argmax is doable
            // (∂λ*/∂d = −(∂²C/∂λ∂d)/(∂²C/∂λ²) at the peak), but it needs
            // second derivatives and a peak-tracking strategy. Until that's
            // built, FD fallback for the whole step keeps results correct.
            if (isArgwave(op.type)) return null;

            // ── Zemax math operands — analytic via ref Jacobian + chain rule ─
            // For now the analytic Jacobian for math operands triggers FD
            // fallback (returns null for the whole step).  Rationale:
            //   • OPGT/OPLT/OPVA/ABSO/ABGT/ABLT have a single ref → chain
            //     rule = ± (or sign(ref)) × J_ref.  Doable but needs the
            //     referenced row's Jacobian to be computed inside this
            //     function — adds complexity.
            //   • DIFF/SUMM/PROD have two refs → ±J_ref1 ± J_ref2 (or product
            //     rule for PROD).
            //   • Legacy OPGT/OPLT with op.baseType (no refId) had a
            //     specialized inline path that worked but had its own
            //     limitations.
            // For v1 of the ref-based architecture we accept FD-only and
            // revisit analytic later; per-step cost is +O(2·nFree·m) which
            // is fine for typical MF sizes.  This keeps the math-operand
            // contract clean: any new math kind in MATH_REGISTRY automatically
            // works in DLS without extra Jacobian wiring.
            if (isMath(op.type)) return null;

            // ── Total thickness (TT) — defer to FD ───────────────────────────
            // ∂(Σd)/∂d_k = 1 for every free layer is trivial, but the free-var
            // ↔ stack mapping differs per surface mode; FD fallback keeps it
            // unambiguously correct (TT is cheap to difference).
            if (isTotalThickness(op.type)) return null;

            const char = charOf(op.type);
            const pol  = polFromType(op.type) ?? op.pol;

            // ── Continuous per-λ target (TGT/RGT/AGT) ────────────────────────
            // residual = sw·comp, comp = √(mean dev²).
            // ∂comp/∂d_k = (1/(comp·n))·Σ dev_s·∂val_s/∂d_k.
            if (isRangeTarget(op.type)) {
                const lams = operandSampleLambdas(op);
                const n = lams.length;
                const cval = comp[i];
                if (cval > 1e-12) {
                    const t0 = op.target;
                    const t1 = op.targetEnd != null ? op.targetEnd : op.target;
                    for (let s = 0; s < n; s++) {
                        const f   = s / (n - 1);
                        const ti  = t0 + (t1 - t0) * f;
                        const dev = propVal(lams[s], pol, char, op.aoi) - ti;
                        const d   = propDeriv(lams[s], pol, char, op.aoi);
                        for (let ci = 0; ci < nFree; ci++) row[ci] += dev * d[freeIdx[ci]];
                    }
                    const scale = sw / (cval * n);
                    for (let ci = 0; ci < nFree; ci++) row[ci] *= scale;
                }
                J.push(row);
                continue;
            }

            // Weighted-integral: residual = sw·(C̄_w − target),
            //   ∂C̄_w/∂d_j = Σ_i (w_i / Σ w_k) · ∂C_i/∂d_j   (linear, exact).
            if (isIntegral(op.type)) {
                const lams = operandSampleLambdas(op);
                const n    = lams.length;
                const S    = resolveSourceSpec(op.source   || { id: 'E' });
                const D    = resolveDetectorSpec(op.detector || { id: 'flat' });
                let den = 0;
                const wts = new Array(n);
                for (let s = 0; s < n; s++) {
                    const w = S.sampler(lams[s]) * D.sampler(lams[s]);
                    wts[s] = w; den += w;
                }
                if (den > 1e-30) {
                    const invDen = 1 / den;
                    for (let s = 0; s < n; s++) {
                        const wi = wts[s] * invDen;
                        if (!(wi > 0)) continue;
                        const d = propDeriv(lams[s], pol, char, op.aoi);
                        for (let ci = 0; ci < nFree; ci++) row[ci] += wi * d[freeIdx[ci]];
                    }
                    for (let ci = 0; ci < nFree; ci++) row[ci] *= sw;
                }
                J.push(row);
                continue;
            }

            // Worst-case min/max: residual = sw·max(0, ±(target−comp)), where
            // comp is the TRUE extremum of C(λ) over the band (see evalOperand).
            // Inactive (subgradient 0) when satisfied. When active, the extremum
            // is attained at one wavelength λ* (the argmin/argmax sample), so the
            // subgradient is sw·(±1)·∂C(λ*)/∂d_j — the same single-extremum
            // subgradient used for MNT/MXT. Must find λ* on the SAME grid
            // evalOperand used, so comp and this gradient stay self-consistent
            // (and the Jacobian matches a finite-difference of the residual).
            if (isMinmax(op.type)) {
                const isMin = isMinType(op.type);
                const violated = isMin
                    ? (op.target - comp[i] > 0)
                    : (comp[i] - op.target > 0);
                if (!violated) { J.push(row); continue; }

                const lams = operandSampleLambdas(op);
                const n    = lams.length;
                let argS = 0, bestV = isMin ? Infinity : -Infinity;
                for (let s = 0; s < n; s++) {
                    const v = propVal(lams[s], pol, char, op.aoi);
                    if (isMin ? v < bestV : v > bestV) { bestV = v; argS = s; }
                }
                // ∂residual/∂comp under the violated branch: +1 for max, −1 for min.
                const dResSign = isMin ? -1 : +1;
                const d = propDeriv(lams[argS], pol, char, op.aoi);
                for (let ci = 0; ci < nFree; ci++) row[ci] = sw * dResSign * d[freeIdx[ci]];
                J.push(row);
                continue;
            }

            if (isRangeAvg(op.type)) {
                // Band mean: residual = sw·(mean − target). (TAV/RAV/AAV are
                // pure averages — no ramp; ramps live in TGT/RGT/AGT above.)
                const lams = operandSampleLambdas(op);
                const n = lams.length;
                for (let s = 0; s < n; s++) {
                    const d = propDeriv(lams[s], pol, char, op.aoi);
                    for (let ci = 0; ci < nFree; ci++) row[ci] += d[freeIdx[ci]];
                }
                const scale = sw / n;
                for (let ci = 0; ci < nFree; ci++) row[ci] *= scale;
            } else {
                // Single-λ: residual = sw·(val − target).
                const d = propDeriv(op.lambdaStart, pol, char, op.aoi);
                for (let ci = 0; ci < nFree; ci++) row[ci] = sw * d[freeIdx[ci]];
            }
            J.push(row);
        }
        return J;
    }

    // ── Newton system: H·Δ = −Jᵀr, H = JᵀJ + S ───────────────────────────────
    // Assembles the TRUE merit-function Hessian for second-order (Newton)
    // refinement. Minimizing MF = √(SSR/ΣW) ≡ minimizing SSR = Σ rₚ²; the
    // Newton step solves H_SSR·Δ = −∇SSR with ∇SSR = 2·Jᵀr and
    //   H_SSR = 2·(JᵀJ + S),  S[a][b] = Σₚ rₚ·∂²rₚ/∂dₐ∂d_b
    // (the factor 2 cancels). Gauss–Newton / LM keeps only JᵀJ and drops S; the
    // S curvature term is what gives genuine quadratic convergence near the
    // minimum (Tikhonov–Tikhonravov–Trubetskov 1993). Per-residual ∂²rₚ uses the
    // analytic comp-Hessian tmmThicknessHessian
    // (FD-validated, tests/hessian_fd_validation.mjs).
    //
    // Scope: front_only single-surface (the mode whose analytic Jacobian is a
    // direct read). Returns null — caller falls back to LM step() — for any
    // other surface/eval mode, or if the analytic Jacobian declines (math/
    // argwave/TT operands), or if σ-normalization ≠ 1 (then Jacobian is FD).
    // Supported residual curvature: single-λ optical, range-avg (TAV/RAV/AAV),
    // weighted-integral (linear in comp ⇒ ∂²r = sw·Σα·∂²comp); range-target
    // (TGT/RGT/AGT, the √-of-mean-square chain); constraint/minmax contribute
    // zero curvature (piecewise-linear). Returns { H, Jtr } (nFree×nFree, nFree).
    // Gauss-Newton system { H = JᵀJ, Jtr = Jᵀr } for the cases the FULL analytic
    // Newton Hessian (below) does not cover: full-system MF scoring (evalFullSystem
    // = both_independent / symmetric, or a single side with "ignore the other side"
    // off / mfEvalMode='total') and math/argwave/TT/σ≠1 operands. The Jacobian is the
    // EXACT analytic Jacobian (valid in every surface mode — single-surface direct
    // + Macleod §2.6.4 full-system chain rule), with the same central-FD fallback
    // the LM step() uses when _analyticJacobian declines a term. Dropping the
    // second-order curvature term S is the standard Gauss-Newton approximation
    // (S→0 as residuals→0 near the optimum); the engines' own damping / trust
    // region / box-QP keep it well conditioned. THIS is what lets Newton /
    // Newton-CG / SQP run their own algorithm natively in EVERY surface mode
    // instead of silently reverting to the LM step. Returns a full symmetric H.
    _gaussNewtonSystem(thk, freeIdx) {
        const compBase = evaluateOperands(this.operands, this._ctxFor(thk));   // shared base eval (M5)
        const r0 = this._residuals(thk, compBase);
        const m  = r0.length, nFree = freeIdx.length;
        let J = this._analyticJacobian(thk, freeIdx, compBase);
        if (!J || J.length !== m) {
            // central-FD Jacobian — identical convention to the LM step().
            J = Array.from({ length: m }, () => new Array(nFree).fill(0));
            for (let ci = 0; ci < nFree; ci++) {
                const k  = freeIdx[ci];
                const hk = Math.max(this.h, Math.abs(thk[k]) * 1e-4);
                const thkP = [...thk]; thkP[k] = Math.min(thk[k] + hk, this.D_MAX);
                const thkM = [...thk]; thkM[k] = Math.max(thk[k] - hk, this.D_MIN);
                const rP = this._residuals(thkP);
                const rM = this._residuals(thkM);
                const dh = thkP[k] - thkM[k];
                if (dh > 0) for (let ri = 0; ri < m; ri++) J[ri][ci] = (rP[ri] - rM[ri]) / dh;
            }
        }
        const H   = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
        const Jtr = new Array(nFree).fill(0);
        for (let row = 0; row < m; row++) {
            const Jr = J[row], rr = r0[row];
            for (let a = 0; a < nFree; a++) {
                Jtr[a] += Jr[a] * rr;
                const Jra = Jr[a];
                for (let b = a; b < nFree; b++) H[a][b] += Jra * Jr[b];
            }
        }
        for (let a = 0; a < nFree; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
        return { H, Jtr };
    }

    _newtonSystem(thk, freeIdx) {
        // FULL Newton (Gauss-Newton JᵀJ + analytic second-order curvature S) is
        // assembled whenever the MF is scored on a SINGLE surface — front_only or
        // back_only with "ignore the other side" on (mfEvalMode='side', i.e.
        // !evalFullSystem). Back_only is the identical single-surface problem (light
        // enters from the exit medium through the reversed stack into the substrate),
        // so the same analytic comp-Hessian (tmmThicknessHessian) applies; getH()
        // below mirrors _analyticJacobian's isSingleBack reversal. When the MF is
        // FULL-SYSTEM (evalFullSystem: surfaceMode both_independent / symmetric, OR a
        // single side with "ignore the other side" off / mfEvalMode='total') the MF
        // is the composed two-sided system, whose full Hessian is a much larger
        // derivation — those fall through to the Gauss-Newton system (H=JᵀJ), as do
        // unsupported operands (math/argwave/TT/σ≠1). Either way the second-order
        // engines run natively in EVERY mode (no silent LM fallback).
        const sm = this.surfaceMode || 'front_only';
        const isSingleBack = sm === 'back_only';
        const fullNewtonOK = (sm === 'front_only' || isSingleBack)
            && !this.evalFullSystem
            && this.operands.every(op => !op.enabled
                || (!isMath(op.type) && !isArgwave(op.type) && !isTotalThickness(op.type)
                    && operandResidualScale(op) === 1));
        if (!fullNewtonOK) return this._gaussNewtonSystem(thk, freeIdx);

        // One base-point sweep shared by the Jacobian, the residuals AND the
        // comp-Hessian operand reduction below (M5 — was three evaluateOperands
        // on the same thk). Pure ⇒ bit-identical.
        const comp = evaluateOperands(this.operands, this._ctxFor(thk));
        const J = this._analyticJacobian(thk, freeIdx, comp);
        if (!J) return this._gaussNewtonSystem(thk, freeIdx);
        const r0   = this._residuals(thk, comp);
        const nFree = freeIdx.length, m = r0.length;
        if (m !== J.length) return this._gaussNewtonSystem(thk, freeIdx);   // safety: row alignment

        // JᵀJ (upper triangle) and Jtr = Jᵀr.
        const H   = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
        const Jtr = new Array(nFree).fill(0);
        for (let row = 0; row < m; row++) {
            const Jr = J[row], rr = r0[row];
            for (let a = 0; a < nFree; a++) {
                Jtr[a] += Jr[a] * rr;
                const Jra = Jr[a];
                for (let b = a; b < nFree; b++) H[a][b] += Jra * Jr[b];
            }
        }

        // Per-(λ,pol,char,aoi) analytic comp value/first/second derivatives over
        // the FREE variables (honoring pol='avg'). Single-front: a direct read +
        // subset of the full-stack analytic Hessian.
        const hcache = new Map();
        const N = thk.length;
        // Remap a reversed-stack Hessian package back to storage-layer order.
        // ∂²/∂dᵢ∂dⱼ is symmetric, so read via at() (handles upper-only storage).
        const remapHessianRev = (Hr) => {
            const at = (M, p, q) => (p <= q ? M[p][q] : M[q][p]);
            const d1 = (arr) => { const o = new Array(N); for (let i = 0; i < N; i++) o[i] = arr[N - 1 - i]; return o; };
            const d2 = (M) => {
                const o = Array.from({ length: N }, () => new Array(N).fill(0));
                for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) o[i][j] = at(M, N - 1 - i, N - 1 - j);
                return o;
            };
            return { T: Hr.T, R: Hr.R, A: Hr.A,
                     dTdd: d1(Hr.dTdd), dRdd: d1(Hr.dRdd), dAdd: d1(Hr.dAdd),
                     d2Tdd: d2(Hr.d2Tdd), d2Rdd: d2(Hr.d2Rdd), d2Add: d2(Hr.d2Add) };
        };
        const getH = (lam, polCode, aoi) => {
            const key = lam + '|' + polCode + '|' + aoi;
            let v = hcache.get(key);
            if (v === undefined) {
                const ns = this.nsmat.getNK(lam);
                if (isSingleBack) {
                    // Same single-surface Hessian as front_only, entered from the
                    // exit medium with the stack reversed (storage is sub→exit);
                    // remap derivative indices back to storage order. Mirrors the
                    // _analyticJacobian isSingleBack branch exactly.
                    const n0 = this.neMat.getNK(lam);
                    const layersRev = [];
                    for (let i = N - 1; i >= 0; i--) layersRev.push({ n: this.mats[i].getNK(lam), d: thk[i] });
                    v = remapHessianRev(tmmHessEval(lam, aoi, polCode, n0, ns, layersRev));
                } else {
                    const n0 = this.n0mat.getNK(lam);
                    const layers = thk.map((d, i) => ({ n: this.mats[i].getNK(lam), d }));
                    v = tmmHessEval(lam, aoi, polCode, n0, ns, layers);
                }
                hcache.set(key, v);
            }
            return v;
        };
        const pV  = (Hk, ch) => ch === 'T' ? Hk.T : ch === 'R' ? Hk.R : Hk.A;
        const p1  = (Hk, ch) => ch === 'T' ? Hk.dTdd : ch === 'R' ? Hk.dRdd : Hk.dAdd;
        const p2  = (Hk, ch) => ch === 'T' ? Hk.d2Tdd : ch === 'R' ? Hk.d2Rdd : Hk.d2Add;
        // returns { val, d1:[nFree], d2:[nFree][nFree] (upper) }
        const sample = (lam, pol, ch, aoi) => {
            const d1 = new Array(nFree).fill(0);
            const d2 = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
            let val = 0;
            const add = (w, polCode) => {
                const Hk = getH(lam, polCode, aoi);
                val += w * pV(Hk, ch);
                const D1 = p1(Hk, ch), D2 = p2(Hk, ch);
                for (let a = 0; a < nFree; a++) {
                    d1[a] += w * D1[freeIdx[a]];
                    const ra = D2[freeIdx[a]];
                    for (let b = a; b < nFree; b++) d2[a][b] += w * ra[freeIdx[b]];
                }
            };
            if (pol === 'avg') { add(0.5, 's'); add(0.5, 'p'); } else add(1.0, pol);
            return { val, d1, d2 };
        };
        const addS = (coef, d2) => {            // H += coef · d2  (upper triangle)
            if (!coef) return;
            for (let a = 0; a < nFree; a++) for (let b = a; b < nFree; b++) H[a][b] += coef * d2[a][b];
        };

        // Second-order curvature term S, iterating operands in the SAME order as
        // _analyticJacobian/_residuals so row index `rp` aligns with r0/J.
        let rp = 0;
        for (let i = 0; i < this.operands.length; i++) {
            const op = this.operands[i];
            if (!op.enabled || comp[i] == null) continue;
            const rowR = r0[rp];                // residual value for this operand
            const sw   = Math.sqrt(op.weight);
            if (isConstraint(op.type) || isMinmax(op.type)) { rp++; continue; } // ∂²r = 0
            const char = charOf(op.type);
            const pol  = polFromType(op.type) ?? op.pol;

            if (isRangeTarget(op.type)) {
                // comp = √((1/n)Σ devₛ²); the JᵀJ-of-row already added sw²·∂cₐ∂c_b,
                // and the full second-order term collapses (see derivation) to
                //   H_contrib[a][b] = sw²·(1/n)Σₛ(gₛₐgₛ_b + devₛ·∂²valₛ) − sw²·∂cₐ∂c_b
                // so we add S = that minus the row's JᵀJ (= −sw²∂cₐ∂c_b + sw²/n Σ g g
                // + sw²/n Σ dev ∂²val). We add the whole curvature directly and undo
                // the row's JᵀJ contribution.
                const lams = operandSampleLambdas(op);
                const n = lams.length;
                const t0 = op.target;
                const t1 = op.targetEnd != null ? op.targetEnd : op.target;
                // accumulate Σ gₐg_b and Σ dev·∂²val over samples
                const gg  = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
                const dv2 = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
                for (let s = 0; s < n; s++) {
                    const fr  = n > 1 ? s / (n - 1) : 0;
                    const ti  = t0 + (t1 - t0) * fr;
                    const smp = sample(lams[s], pol, char, op.aoi);
                    const dev = smp.val - ti;
                    for (let a = 0; a < nFree; a++) {
                        const ga = smp.d1[a];
                        for (let b = a; b < nFree; b++) {
                            gg[a][b]  += ga * smp.d1[b];
                            dv2[a][b] += dev * smp.d2[a][b];
                        }
                    }
                }
                // H += sw²/n·(gg + dv2)  − (row JᵀJ already in H = sw²·∂c∂c)
                const c2 = (sw * sw) / n;
                for (let a = 0; a < nFree; a++) {
                    for (let b = a; b < nFree; b++) {
                        H[a][b] += c2 * (gg[a][b] + dv2[a][b]) - J[rp][a] * J[rp][b];
                    }
                }
                rp++; continue;
            }

            if (isIntegral(op.type)) {
                const lams = operandSampleLambdas(op);
                const n = lams.length;
                const S = resolveSourceSpec(op.source || { id: 'E' });
                const D = resolveDetectorSpec(op.detector || { id: 'flat' });
                let den = 0; const wts = new Array(n);
                for (let s = 0; s < n; s++) { const w = S.sampler(lams[s]) * D.sampler(lams[s]); wts[s] = w; den += w; }
                if (den > 1e-30) {
                    const invDen = 1 / den;
                    const d2acc = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
                    for (let s = 0; s < n; s++) {
                        const wi = wts[s] * invDen;
                        if (!(wi > 0)) continue;
                        const smp = sample(lams[s], pol, char, op.aoi);
                        for (let a = 0; a < nFree; a++) for (let b = a; b < nFree; b++) d2acc[a][b] += wi * smp.d2[a][b];
                    }
                    addS(rowR * sw, d2acc);     // ∂²r = sw·Σ wi·∂²comp ; S = r·∂²r
                }
                rp++; continue;
            }

            if (isRangeAvg(op.type)) {
                const lams = operandSampleLambdas(op);
                const n = lams.length;
                const d2acc = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
                for (let s = 0; s < n; s++) {
                    const smp = sample(lams[s], pol, char, op.aoi);
                    for (let a = 0; a < nFree; a++) for (let b = a; b < nFree; b++) d2acc[a][b] += smp.d2[a][b];
                }
                addS((rowR * sw) / n, d2acc);   // ∂²r = sw/n·Σ ∂²comp
                rp++; continue;
            }

            // Single-λ optical: residual = sw·(val − target), ∂²r = sw·∂²comp.
            const smp = sample(op.lambdaStart, pol, char, op.aoi);
            addS(rowR * sw, smp.d2);
            rp++;
        }

        // Mirror to full symmetric matrix.
        for (let a = 0; a < nFree; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
        return { H, Jtr };
    }

    // Stable, never-overridden handle to the Levenberg–Marquardt step. The
    // second-order engines (NewtonOptimizer / SQPOptimizer) override step() to
    // dispatch to newtonStep()/sqpStep(); those fall back to the LM step for any
    // unsupported case (non-front_only surface mode, FD-only/argwave/TT operands).
    // The fallback MUST call lmStep(), NOT this.step() — the latter re-dispatches
    // through the subclass override and recurses until the stack overflows
    // (real bug: Newton/SQP crashed on back_only/symmetric/both_independent and
    // in "Try all" on any two-sided design). lmStep() reaches the
    // base LM body directly, so it is correct regardless of subclass. The hot
    // step() path itself is left byte-for-byte untouched (bit-identical guarantee).
    lmStep() { LSQEngine.prototype.step.call(this); }

    // Second-order STEP STRATEGIES (Newton / Newton-CG / SQP) live in their own
    // subclass files (newton.js / newtonCG.js / sqp.js, each `extends LSQEngine`);
    // they reuse this engine's `_newtonSystem` / `_thicknessBounds` (SQP) and the
    // `lmStep` fallback. The LM `step()` below is the engine's default strategy.

    step() {
        const thk     = this.thicknesses;
        const freeIdx = thk.map((_, i) => i).filter(i => !this.lockedMask[i]);
        const nFree   = freeIdx.length;
        if (nFree === 0) return;

        // One base-point operand sweep, shared by the residuals and the analytic
        // Jacobian below (M5 — was two independent evaluateOperands on the same
        // thk). Pure/deterministic ⇒ bit-identical.
        const compBase = evaluateOperands(this.operands, this._ctxFor(thk));
        const r0 = this._residuals(thk, compBase);
        const m  = r0.length;
        if (m === 0) return;

        // Jacobian J[m × nFree]: exact analytic for all surface modes
        // (single-surface direct + full-system Macleod §2.6.4 chain rule);
        // FD fallback (2·nFree extra TMM passes per step) kept for the rare
        // cases _analyticJacobian declines (e.g. unsupported merit term).
        let J = this._analyticJacobian(thk, freeIdx, compBase);
        if (!J) {
            J = Array.from({ length: m }, () => new Array(nFree).fill(0));
            for (let ci = 0; ci < nFree; ci++) {
                const k  = freeIdx[ci];
                const hk = Math.max(this.h, Math.abs(thk[k]) * 1e-4);
                const thkP = [...thk]; thkP[k] = Math.min(thk[k] + hk, this.D_MAX);
                const thkM = [...thk]; thkM[k] = Math.max(thk[k] - hk, this.D_MIN);
                const rP = this._residuals(thkP);
                const rM = this._residuals(thkM);
                const dh = thkP[k] - thkM[k];
                for (let ri = 0; ri < m; ri++) J[ri][ci] = (rP[ri] - rM[ri]) / dh;
            }
        }

        // Marquardt scaling: damp each parameter by the curvature it sees,
        // sᵢ = (JᵀJ)_ii + ε.  Only the *diagonal* of JᵀJ is needed (the
        // squared column norms of J); the off-diagonal coupling stays inside
        // J and is handled by the QR factorization, so JᵀJ is never formed.
        const dampDiag = new Array(nFree).fill(0);
        for (let ci = 0; ci < nFree; ci++) {
            let s = 0;
            for (let ri = 0; ri < m; ri++) s += J[ri][ci] * J[ri][ci];
            dampDiag[ci] = s + 1e-10;
        }

        // Augmented least-squares system  [ J ; √(λ·diag) ] Δ ≈ [ −r ; 0 ].
        // Its normal equations are exactly (JᵀJ + λ·diag)Δ = −Jᵀr — the same
        // damped step as before — but solved by QR (condition number κ(J),
        // not κ(J)²).
        const aug = new Array(m + nFree);
        const rhs = new Array(m + nFree);
        for (let ri = 0; ri < m; ri++) {
            aug[ri] = J[ri].slice();
            rhs[ri] = -r0[ri];
        }
        for (let ci = 0; ci < nFree; ci++) {
            const row = new Array(nFree).fill(0);
            row[ci]  = Math.sqrt(this.lamD * dampDiag[ci]);
            aug[m + ci] = row;
            rhs[m + ci] = 0;
        }
        const delta = solveLeastSquaresQR(aug, rhs);

        const thkTry = [...thk];
        for (let ci = 0; ci < nFree; ci++) {
            const k = freeIdx[ci];
            thkTry[k] = Math.max(this.D_MIN, Math.min(this.D_MAX, thk[k] + delta[ci]));
        }

        const comp   = evaluateOperands(this.operands, this._ctxFor(thkTry));
        const mfTry  = calcMF(this.operands, comp);

        if (mfTry < this.mf) {
            this.thicknesses = thkTry;
            this.mf  = mfTry;
            this.lamD = Math.max(this.lamD * 0.5, 1e-8);
            if (mfTry < this.mfBest) {
                this.mfBest    = mfTry;
                this.thickBest = [...thkTry];
            }
        } else {
            this.lamD = Math.min(this.lamD * 5.0, 1e8);
        }
        this.iter++;
    }

    // ── Pure evaluator helpers (no state mutation) ─────────────────────────────
    // Shared by the Global-Refinement engines (DE / SA / CG), which wrap a
    // DLSOptimizer purely as an evaluator so they inherit the exact surface-mode
    // vector layout, bounds, locks, material resolution and applyToDesign. These
    // do NOT touch this.thicknesses / this.mf / this.lamD, so the bit-identical
    // step() path is unaffected.

    // Merit function at an arbitrary thickness vector (identical math to the
    // value DLS / DE / SA minimize — straight calcMF on _ctxFor(thk)).
    mfAt(thk) {
        return calcMF(this.operands, evaluateOperands(this.operands, this._ctxFor(thk)));
    }

    // Optical merit (OMF) at an arbitrary thickness vector — same eval as mfAt
    // but excluding MNT/MXT/TT manufacturability penalties (skipConstraints).
    // Surfaced for display ONLY; the optimizer still minimizes the full mfAt.
    mfOpticalAt(thk) {
        return calcMF(this.operands, evaluateOperands(this.operands, this._ctxFor(thk)), { skipConstraints: true });
    }

    // Exact analytic gradient ∇MF(thk), length = thk.length, zero at locked
    // indices. Derivation: MF = √(SSR/ΣW), SSR = Σ rᵢ² = dot(_residuals).
    // _analyticJacobian is J = ∂(_residuals)/∂d, so ∂SSR/∂dⱼ = 2(Jᵀr)ⱼ and
    //   ∇MF = ∇SSR / (2·ΣW·MF) = (Jᵀr)·MF / SSR
    // (ΣW cancels via SSR = ΣW·MF²). Falls back to central differences on mfAt
    // when the analytic Jacobian declines a merit term (ramp/argwave/TT/total
    // single-side) — same fallback policy as step(). Both branches return the
    // TRUE ∇MF, so CG sees a consistent gradient regardless of branch.
    gradMF(thk, freeIdxIn) {
        const free  = freeIdxIn || thk.map((_, i) => i).filter(i => !this.lockedMask[i]);
        const nFree = free.length;
        const g     = new Array(thk.length).fill(0);
        if (nFree === 0) return g;

        // Shared base-point sweep for residuals + Jacobian (M5). gradMF is the hot
        // path for CG (default synthesis refiner) and Newton-CG, so this halves
        // its per-call TMM cost. Pure ⇒ bit-identical.
        const compBase = evaluateOperands(this.operands, this._ctxFor(thk));
        const r   = this._residuals(thk, compBase);
        const m   = r.length;
        let SSR = 0;
        for (let i = 0; i < m; i++) SSR += r[i] * r[i];
        if (SSR === 0 || m === 0) return g;   // already at a target → zero gradient

        const J = this._analyticJacobian(thk, free, compBase);
        if (J) {
            // ∇MF = (Jᵀr) / (‖r‖ · √D)  where MF = √(SSR/D) and SSR = Σ(√w·r)².
            // D is calcMF's normalization denominator (optical weight only — NOT
            // the MNT/MXT/TT constraint weights, which sit in SSR's numerator but
            // not the denominator). Use the shared helper so this stays identical
            // to calcMF; a mismatch would make CG see a gradient inconsistent with
            // the reported MF.
            let sumW = mfWeightDenominator(this.operands);
            if (sumW <= 0) sumW = 1;
            const normR = Math.sqrt(SSR);           // = ‖r‖ = √D · MF
            const scale = 1 / (normR * Math.sqrt(sumW));   // = 1/(‖r‖·√ΣW) = ∇MF scale
            for (let ci = 0; ci < nFree; ci++) {
                let s = 0;
                for (let ri = 0; ri < m; ri++) s += J[ri][ci] * r[ri];
                g[free[ci]] = s * scale;
            }
            return g;
        }

        // FD fallback — central differences on the true MF.
        const mf0 = this.mfAt(thk);   // not used directly, but warms eval cache
        void mf0;
        for (let ci = 0; ci < nFree; ci++) {
            const k  = free[ci];
            const hk = Math.max(this.h, Math.abs(thk[k]) * 1e-4);
            const thkP = thk.slice(); thkP[k] = Math.min(thk[k] + hk, this.D_MAX);
            const thkM = thk.slice(); thkM[k] = Math.max(thk[k] - hk, this.D_MIN);
            const dh = thkP[k] - thkM[k];
            if (dh <= 0) { g[k] = 0; continue; }
            g[k] = (this.mfAt(thkP) - this.mfAt(thkM)) / dh;
        }
        return g;
    }

    isConverged() {
        return this.mf < this.tol || this.lamD >= 1e8;
    }

    restoreBest() {
        this.thicknesses = [...this.thickBest];
        const comp = evaluateOperands(this.operands, this._ctxFor(this.thicknesses));
        this.mf = calcMF(this.operands, comp);
    }

    applyToDesign(d) {
        if (this.surfaceMode === 'both_independent') {
            const frontT = this.thicknesses.slice(0, this.nFront);
            const backT  = this.thicknesses.slice(this.nFront);
            const front = (d.frontLayers || []).map((l, i) => ({ ...l, thickness: frontT[i] ?? l.thickness }));
            const back  = (d.backLayers  || []).map((l, i) => ({ ...l, thickness: backT[i]  ?? l.thickness }));
            return { ...d, frontLayers: front, backLayers: back };
        }
        if (this.surfaceMode === 'symmetric') {
            // Front + back share the same thicknesses (and the same materials, by definition).
            const front = (d.frontLayers || []).map((l, i) => ({ ...l, thickness: this.thicknesses[i] ?? l.thickness }));
            // Build back as the mirror of front: reversed order so the
            // physical coating is identical outward from the substrate.
            const back  = mirrorLayers(front);
            return { ...d, frontLayers: front, backLayers: back };
        }
        if (this.surfaceMode === 'back_only') {
            // Front is untouched; optimization vector → back thicknesses.
            const back = (d.backLayers || []).map((l, i) => ({ ...l, thickness: this.thicknesses[i] ?? l.thickness }));
            return { ...d, backLayers: back };
        }
        // front_only (legacy)
        const front = (d.frontLayers || []).map((l, i) => ({ ...l, thickness: this.thicknesses[i] ?? l.thickness }));
        return { ...d, frontLayers: front };
    }
}

// The plain DLS / Levenberg–Marquardt refiner = the engine with its inherited LM
// `step()`. Kept as the public name (imported across the app + wrapped by the
// EngineBase CG/DE/SA optimizers as a pure evaluator); also the base the
// Newton/Newton-CG/SQP subclasses extend.
export class DLSOptimizer extends LSQEngine {}

// ── Refinement early-termination ─────────────────────────────────────────────
// Trubetskov, "Deep search methods for multilayer coating design," Appl. Opt.
// 59, A75 (2020): the only "machine-learning" feature of deep search is killing
// doomed refinements early by comparing each refinement's merit-vs-iteration
// trajectory against the best stored ones, so a wide candidate sweep (refine
// ALL P-minima, keep best) becomes affordable instead of O(candidates × full
// refine). This runs an *existing* DLSOptimizer to convergence OR until its MF
// trajectory shows it cannot beat a reference trajectory.
//
// PURE CONTROL LOGIC: it only calls dls.step() (unchanged) and reads dls.mf, so
// the bit-identical worker-equivalence guarantee (project_optimizer_worker) is
// untouched. step() accepts only improving moves, so dls.mf is monotone
// non-increasing and dls.thicknesses always holds the best — no restoreBest()
// needed after an early stop.
//
// Abort policy (conservative — must never kill a refinement that would have
// won): a refinement is aborted only when it is BOTH (a) plateaued — relative
// MF gain over the last `patience` steps below `minRelGain` — AND (b) trailing
// the reference trajectory at the same iteration by more than `margin`. A
// late-bloomer (still dropping fast) is never killed because (a) fails. With no
// reference, only the plateau test applies (it is then just an early-convergence
// exit, not a comparative kill).
//
// opts: { maxIter=60, reference=null, warmup=4, patience=5, minRelGain=1e-3,
//         margin=0.05 }
// returns { mf, iters, trajectory, aborted }
export function refineWithEarlyStop(dls, opts = {}) {
    const maxIter    = opts.maxIter    ?? 60;
    const reference  = opts.reference  || null;
    const warmup     = opts.warmup     ?? 4;
    const patience   = opts.patience   ?? 5;
    const minRelGain = opts.minRelGain ?? 1e-3;
    const margin     = opts.margin     ?? 0.05;

    const trajectory = [dls.mf];
    let aborted = false;
    while (!(dls.isConverged() || dls.iter >= maxIter)) {
        dls.step();
        trajectory.push(dls.mf);
        const t = trajectory.length - 1;
        if (t < warmup) continue;

        // (a) plateau: relative MF gain over the patience window
        const past    = trajectory[Math.max(0, t - patience)];
        const relGain = past > 0 ? (past - dls.mf) / past : 0;
        if (relGain >= minRelGain) continue;       // still progressing — keep going

        if (!reference) { aborted = true; break; }  // plateaued, no rival → converged-enough
        // (b) trailing the reference at this iteration → can't catch up
        const ref = reference[Math.min(t, reference.length - 1)];
        if (ref != null && dls.mf > ref * (1 + margin)) { aborted = true; break; }
    }
    return { mf: dls.mf, iters: dls.iter, trajectory, aborted };
}
