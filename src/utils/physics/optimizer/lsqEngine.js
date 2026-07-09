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
import {
    tmmNeedleScanEval, ADAPTIVE_SAMPLING_DEFAULTS, densifyOperandsForFeatures, collectDesignMaterialIds, tmmFullSystem,
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
import { isRangeAvg, charOf, requiredLambdas, buildPresampledTable } from './sampling.js';
import { makeConeSpec, coneIsActive } from './coneAngle.js';
import { mirrorLayers, insertNeedle, cleanupLayers, bestNeedlePerPosition, insertNeedleIntra } from './layerOps.js';
import { solveLeastSquaresQR, choleskySolve, steihaugCG, solveBoxQP, _vdot, _vnorm } from './linalg.js';
import { _surfaceLayout, makePointEvaluators, _jacRow } from './jacobianAssembly.js';
import { _jtjUpper, _mirrorUpper, makeHessianSampler, _addS, _curvRangeTarget, _curvIntegral, _curvRangeAvg, _operandSupportsFullNewton } from './newtonAssembly.js';

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
        // Variable layout (which free vars exist) is set by surfaceMode; whether
        // the MF is scored full-system is set by evalFullSystem. front_only/
        // back_only + 'total' reuse the validated full-system chain rule but with
        // free variables on one side only (the other side is fixed).
        const { mode, varSide } = _surfaceLayout(this.surfaceMode || 'front_only', !!this.evalFullSystem);

        const ctx  = this._ctxFor(thk);
        const comp = compBase !== undefined ? compBase : evaluateOperands(this.operands, ctx);
        const nFree = freeIdx.length;
        const N = thk.length;   // total free-variable count (= mats.length)

        // Cache one Jacobian package per (λ, polCode, aoi) — reused across
        // all operands that sample the same point. For full-system this caches
        // THREE sub-Jacobians (front-forward, front-reverse, back) plus the
        // composed system R/T/A and per-side derivatives; for single-surface
        // modes it caches one. `sideMap` fixes how per-side derivatives map onto
        // the free-variable vector (length N, same indexing as thk/freeIdx).
        const jacCfg = {
            mode,
            n0mat: this.n0mat, nsmat: this.nsmat, neMat: this.neMat, mats: this.mats,
            thk, N, ctx, subThickMm: this.substrateThicknessMm,
        };
        const sideMap = { N, varSide, nFront: this.nFront, nBack: this.nBack };
        const { propDeriv, propVal } = makePointEvaluators(jacCfg, sideMap);

        // Operand kinds whose analytic chain rule isn't worked out yet
        // (argwave/math/total-thickness) decline the WHOLE analytic Jacobian so
        // step() falls back to FD. Every remaining kind gets a row from _jacRow.
        const jc = { comp, freeIdx, nFree, ctx, propDeriv, propVal };
        const J = [];
        for (let i = 0; i < this.operands.length; i++) {
            const op = this.operands[i];
            if (!op.enabled || comp[i] == null) continue;
            if (isArgwave(op.type) || isMath(op.type) || isTotalThickness(op.type)) return null;
            J.push(_jacRow(op, i, jc));
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
        if (!J || J.length !== m) J = this._fdJacobian(thk, freeIdx, m);
        const { H, Jtr } = _jtjUpper(J, r0, nFree, m);
        _mirrorUpper(H, nFree);
        return { H, Jtr };
    }

    // FULL Newton (JᵀJ + analytic curvature S) is assembled only when the MF is
    // scored on a SINGLE surface (front_only, or back_only with mfEvalMode='side')
    // and every operand supports the analytic curvature. Otherwise _newtonSystem
    // falls back to the Gauss-Newton system.
    _fullNewtonSupported(sm, isSingleBack) {
        if (sm !== 'front_only' && !isSingleBack) return false;
        if (this.evalFullSystem) return false;
        return this.operands.every(_operandSupportsFullNewton);
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
        if (!this._fullNewtonSupported(sm, isSingleBack)) return this._gaussNewtonSystem(thk, freeIdx);

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
        const { H, Jtr } = _jtjUpper(J, r0, nFree, m);

        // Per-(λ,pol,char,aoi) analytic comp value/first/second derivatives over
        // the FREE variables (honoring pol='avg'). Single-front is a direct read;
        // single-back mirrors _analyticJacobian's reversed-stack handling.
        const { sample } = makeHessianSampler({
            n0mat: this.n0mat, nsmat: this.nsmat, neMat: this.neMat, mats: this.mats,
            thk, N: thk.length, isSingleBack, freeIdx, nFree,
        });
        const addS = (coef, d2) => _addS(H, nFree, coef, d2);

        // Second-order curvature term S, iterating operands in the SAME order as
        // _analyticJacobian/_residuals so row index `rp` aligns with r0/J.
        // Constraint/minmax contribute zero curvature (piecewise-linear).
        const hc = { H, J, r0, nFree, sample, addS };
        let rp = 0;
        for (let i = 0; i < this.operands.length; i++) {
            const op = this.operands[i];
            if (!op.enabled || comp[i] == null) continue;
            if (isConstraint(op.type) || isMinmax(op.type)) { rp++; continue; }
            if (isRangeTarget(op.type))   _curvRangeTarget(op, rp, hc);
            else if (isIntegral(op.type)) _curvIntegral(op, rp, hc);
            else if (isRangeAvg(op.type)) _curvRangeAvg(op, rp, hc);
            else {  // single-λ optical: residual = sw·(val − target), ∂²r = sw·∂²comp.
                const pol = polFromType(op.type) ?? op.pol;
                const d2 = sample(op.lambdaStart, pol, charOf(op.type), op.aoi).d2;
                addS(r0[rp] * Math.sqrt(op.weight), d2);
            }
            rp++;
        }

        _mirrorUpper(H, nFree);
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

    // Central-difference Jacobian J[m × nFree] of the residuals, used when the
    // analytic Jacobian declines a merit term. Costs 2·nFree extra TMM passes.
    _fdJacobian(thk, freeIdx, m) {
        const nFree = freeIdx.length;
        const J = Array.from({ length: m }, () => new Array(nFree).fill(0));
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
        return J;
    }

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
        if (!J) J = this._fdJacobian(thk, freeIdx, m);

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
        return this._gradMFFallbackFD(thk, free, g);
    }

    // Central-difference ∇MF, used when the analytic Jacobian declines a merit
    // term (ramp/argwave/TT/total single-side). Differentiates the true MF
    // directly; writes into g and returns it.
    _gradMFFallbackFD(thk, free, g) {
        this.mfAt(thk);   // warm the eval cache at the base point
        for (let ci = 0; ci < free.length; ci++) {
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
