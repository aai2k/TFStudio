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


import {
    isFullSystemEval, effectiveBackLayers,
    evaluateOperands, phaseDispersionThicknessPoint, ellipsometryThicknessPoint,
    operandResidualScale, calcMF, mfWeightDenominator,
    operandEvaluationErrors, OperandEvaluationError, operandSampleDeviations,
} from './evalCore.js';
import { operandResidualRows } from './residualRows.js';
import { isArgwave, isMath, isEField, isMeasuredCurve } from './operandModel.js';
import { expandMeasuredCurveOperands } from './measuredCurveOperand.js';
import { makeConeSpec, coneIsActive } from './coneAngle.js';
import { mirrorLayers } from './layerOps.js';
import { solveLeastSquaresQR } from './linalg.js';
import { halfWaveSpans, limitStepToSpans } from './halfWaveSpan.js';
import { LM_MAX_DAMPING, scaledStepRatio, predictedReduction, lmStopReason } from './lmStopping.js';
import { boxedStart, movablePositions, residualGradient, restrictColumns, projectedTrial } from './boundedStep.js';
import { _surfaceLayout, makePointEvaluators, _jacRows } from './jacobianAssembly.js';
import { _jtjUpper, _mirrorUpper, makeHessianSampler, _addS, _curvOperand, _operandSupportsFullNewton } from './newtonAssembly.js';

// Operand kinds whose analytic chain rule is not worked out. One of them in
// the merit function puts the whole Jacobian onto finite differences.
const DECLINES_ANALYTIC_JACOBIAN = [
    isArgwave, isMath, isMeasuredCurve, isEField,
];

const sameValues = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

// Whether a cache entry { thicknesses, freeIdx } was built at exactly this
// point with exactly these free variables.
function cachedAt(entry, thk, freeIdx) {
    return !!entry && sameValues(entry.thicknesses, thk) && sameValues(entry.freeIdx, freeIdx);
}

// ── DLS Optimizer (Levenberg-Marquardt) ───────────────────────────────────────
//
// Reference: Sullivan & Dobrowolski, Appl. Opt. 35, 5484-5492 (1996).
// Jacobian computed via central finite differences over all operands.

export class LSQEngine {
    constructor(operands, design, resolveMat, opts = {}) {
        // Measured spectra persist as one compact, immutable snapshot operand,
        // but least-squares engines need one residual row per measured point.
        // Expanding defensively here covers every optimizer entry point (main
        // thread, workers, cleaner, manual needle, and benchmark), including
        // callers that do not pass through the adaptive-sampling run seam.
        this.operands    = expandMeasuredCurveOperands(operands);
        this.resolveMat  = resolveMat;
        this.surfaceMode = design?.surfaceMode || 'front_only';
        this.mfEvalMode  = design?.mfEvalMode  || 'side';
        // When true, the MF is scored against the full system even though only
        // one side carries optimization variables (front_only/back_only + total).
        this.evalFullSystem = isFullSystemEval(this.surfaceMode, this.mfEvalMode);
        // Cone-angle averaging. Normalized once; flows into every
        // _ctxFor() so the merit/residuals are cone-averaged. Every context
        // shares one store of cone node sets, settled by the first evaluation
        // (evalCore/coneNodeCount.js), so the merit function, its analytic
        // Jacobian and every trial point of the run average over the same rays.
        this.cone        = makeConeSpec(design?.cone || {});
        this._coneNodes  = new Map();
        // Stress run temperatures, read by the STR operand through the context.
        this.stress      = design?.stress || null;
        this.layerSide   = 'frontLayers';   // legacy field; callers may inspect

        const front = design.frontLayers || [];
        // In symmetric mode the back stack is a mirror of the front, with no
        // independent back variables; effectiveBackLayers holds that rule.
        const back  = effectiveBackLayers(design);

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

        // Thickness box, nm. No upper bound unless the caller passes one: the
        // user's own upper bound is the MXT operand, and LWIR half-wave layers
        // and thick spacers are legitimately microns thick. What keeps a DLS,
        // Newton, Newton-CG or SQP step local is the per-layer step span
        // (halfWaveSpan.js), not a box.
        this.D_MIN  = opts.dMin   ?? 1.0;
        this.D_MAX  = opts.dMax   ?? Infinity;
        this.thicknesses = boxedStart(this);
        this.stepSpans = halfWaveSpans(this.operands, this.mats);
        this.lamD   = opts.lamInit ?? 1e-2;
        this.lamN   = opts.lamNInit ?? 1e-3;   // modified-Newton damping state (newtonStep)
        this.lamS   = opts.lamSInit ?? 1e-3;   // bounded-SQP damping state (sqpStep)
        this.tol    = opts.tol    ?? 1e-7;
        this.h      = opts.fdStep ?? 1.0;

        const comp0    = evaluateOperands(this.operands, this._ctxFor(this.thicknesses));
        const errorIndex = operandEvaluationErrors(comp0).findIndex(Boolean);
        if (errorIndex >= 0) {
            const op = this.operands[errorIndex];
            throw new OperandEvaluationError(
                `Row ${errorIndex + 1} ${op.type}: ${operandEvaluationErrors(comp0)[errorIndex]}`,
            );
        }
        this.mf        = calcMF(this.operands, comp0);
        this.mfBest    = this.mf;
        this.thickBest = [...this.thicknesses];
        this.iter      = 0;
        this._linearizationCache = null;
        this._newtonSystemCache = null;
        // The stopping test (lmStopping.js) the last LM step met, or null.
        this.convergedBy = null;
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
            _coneNodeCache:       this._coneNodes,
            stress:               this.stress,
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
        const errorIndex = operandEvaluationErrors(comp).findIndex(Boolean);
        if (errorIndex >= 0) {
            const op = this.operands[errorIndex];
            throw new OperandEvaluationError(
                `Row ${errorIndex + 1} ${op.type}: ${operandEvaluationErrors(comp)[errorIndex]}`,
            );
        }
        // Same per-type unit normalization as calcMF (σ = 1 for optical, so
        // pure-optical residuals are unchanged; argwave nm ÷ σ_λ). The FD
        // Jacobian differences this vector, so it inherits σ automatically;
        // every analytic row builder divides by the same
        // operandResidualScale(op), which is what keeps the two consistent
        // for the σ ≠ 1 operands that have an analytic chain rule (Ψ, Δ,
        // phase and dispersion). A range target gives one row per sample.
        const deviations = operandSampleDeviations(comp);
        const out = [];
        for (let i = 0; i < this.operands.length; i++) {
            const op = this.operands[i];
            if (!op.enabled || comp[i] == null) continue;
            out.push(...operandResidualRows(op, comp[i], deviations[i]));
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
    // With a cone active every R/T/A derivative is the weighted sum of the
    // per-ray derivatives over the rays the residuals were averaged over
    // (makePointEvaluators), which is exact because the average is linear.
    //
    // Returns null for unsupported merit-function term types so step()
    // can fall back to FD where the analytic chain rule isn't worked out.
    // `compBase` (optional) — precomputed evaluateOperands() for this exact thk,
    // shared with the caller's _residuals() base eval (M5). Used only for the
    // operand-level reduction (which λ* a band-extremum picked, ramp RMS, the
    // violated tests); the Jacobian's own TMM derivatives are computed separately
    // via tmmJacEval. Omitted ⇒ evaluate here as before. Bit-identical either way.
    _analyticJacobian(thk, freeIdx, compBase) {
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
        const { propDeriv } = makePointEvaluators(jacCfg, sideMap);

        // Operand kinds whose analytic chain rule is not worked out yet decline
        // the whole Jacobian so step() falls back to finite differences.
        const jc = {
            comp,
            freeIdx,
            nFree,
            ctx,
            propDeriv,
            phasePoint: (op, wavelength) => phaseDispersionThicknessPoint(op, ctx, wavelength),
            ellipsometryPoint: op => ellipsometryThicknessPoint(op, ctx, this.operands),
            residualScale: operandResidualScale,
        };
        const J = [];
        for (let i = 0; i < this.operands.length; i++) {
            const op = this.operands[i];
            if (!op.enabled || comp[i] == null) continue;
            if (DECLINES_ANALYTIC_JACOBIAN.some(test => test(op.type))) return null;
            const rows = _jacRows(op, i, jc);
            if (!rows) return null;
            J.push(...rows);
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
    // argwave operands), or if σ-normalization ≠ 1 (then Jacobian is FD).
    // Supported residual curvature: single-λ optical, range-avg (TAV/RAV/AAV),
    // weighted-integral (linear in comp ⇒ ∂²r = sw·Σα·∂²comp); range-target
    // (TGT/RGT/AGT, one single-λ residual per sample). The manufacturability rows
    // and the worst-case min/max rows contribute zero curvature (curvature.js
    // says why for min/max). Returns { H, Jtr } (nFree×nFree, nFree).
    // Gauss-Newton system { H = JᵀJ, Jtr = Jᵀr } for the cases the FULL analytic
    // Newton Hessian (below) does not cover: full-system MF scoring (evalFullSystem
    // = both_independent / symmetric, or a single side with "ignore the other side"
    // off / mfEvalMode='total') and math/argwave/σ≠1 operands. The Jacobian is the
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
    // falls back to the Gauss-Newton system. The curvature sampler reads one
    // angle of incidence, so a cone-averaged merit takes the Gauss-Newton system
    // too, with the cone-averaged Jacobian.
    _fullNewtonSupported(sm, isSingleBack) {
        if (sm !== 'front_only' && !isSingleBack) return false;
        if (this.evalFullSystem) return false;
        if (coneIsActive(this.cone)) return false;
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
        // unsupported operands (math/argwave/σ≠1). Either way the second-order
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
        const hc = { r0, nFree, sample, addS };
        let rp = 0;
        for (let i = 0; i < this.operands.length; i++) {
            if (!this.operands[i].enabled || comp[i] == null) continue;
            rp += _curvOperand(this.operands[i], rp, hc);
        }

        _mirrorUpper(H, nFree);
        return { H, Jtr };
    }

    // Stable, never-overridden handle to the Levenberg–Marquardt step. The
    // second-order engines (NewtonOptimizer / SQPOptimizer) override step() to
    // dispatch to newtonStep()/sqpStep(); those fall back to the LM step for any
    // unsupported case (non-front_only surface mode, FD-only/argwave operands).
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

    _linearizationAt(thk, freeIdx) {
        const cached = this._linearizationCache;
        if (cachedAt(cached, thk, freeIdx)) return cached;

        const compBase = evaluateOperands(this.operands, this._ctxFor(thk));
        const r0 = this._residuals(thk, compBase);
        let J = this._analyticJacobian(thk, freeIdx, compBase);
        if (!J) J = this._fdJacobian(thk, freeIdx, r0.length);
        this._linearizationCache = {
            thicknesses: [...thk],
            freeIdx: [...freeIdx],
            r0,
            J,
        };
        return this._linearizationCache;
    }

    // The Newton / SQP system { H, Jtr } at thk, reused while the engine stays
    // at the same point: a rejected trial changes only the damping, and the
    // dense H costs O(N²) kernel work to assemble. Keyed by the thickness
    // vector and the free set, so an accepted step or a restored best point
    // builds a new one. Callers must not modify the returned H or Jtr.
    _newtonSystemAt(thk, freeIdx) {
        const cached = this._newtonSystemCache;
        if (cachedAt(cached, thk, freeIdx)) return cached.system;
        const system = this._newtonSystem(thk, freeIdx);
        this._newtonSystemCache = { thicknesses: [...thk], freeIdx: [...freeIdx], system };
        return system;
    }

    step() {
        const thk     = this.thicknesses;
        const freeIdx = thk.map((_, i) => i).filter(i => !this.lockedMask[i]);
        if (freeIdx.length === 0) return;

        // Rejected trials change damping without changing this linearization.
        const { r0, J: Jfree } = this._linearizationAt(thk, freeIdx);
        const m  = r0.length;
        if (m === 0) return;

        // Layers held at a bound by the gradient take no step (boundedStep.js).
        // With none left to move the point is stationary for the bounded
        // problem, which saturates the damping the same way rejected trials do.
        const cols = movablePositions(this, freeIdx, residualGradient(Jfree, r0));
        if (cols.length === 0) { this.lamD = LM_MAX_DAMPING; this.iter++; this.convergedBy = 'damping'; return; }
        const moveIdx = cols.map(c => freeIdx[c]);
        const nFree   = cols.length;
        const J = restrictColumns(Jfree, cols);

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
        const delta = limitStepToSpans(solveLeastSquaresQR(aug, rhs), moveIdx, this.stepSpans);
        const thkTry = projectedTrial(this, freeIdx, moveIdx, delta);

        const comp   = evaluateOperands(this.operands, this._ctxFor(thkTry));
        const mfTry  = calcMF(this.operands, comp);

        let accepted = null;
        if (mfTry < this.mf) {
            const move = moveIdx.map(k => thkTry[k] - thk[k]);
            accepted = {
                actual: 1 - (mfTry / this.mf) ** 2,
                predicted: predictedReduction(J, r0, move),
                ratio: scaledStepRatio(move, moveIdx.map(k => thk[k]), dampDiag),
            };
            this.thicknesses = thkTry;
            this._linearizationCache = null;
            this.mf  = mfTry;
            this.lamD = Math.max(this.lamD * 0.5, 1e-8);
            if (mfTry < this.mfBest) {
                this.mfBest    = mfTry;
                this.thickBest = [...thkTry];
            }
        } else {
            this.lamD = Math.min(this.lamD * 5.0, LM_MAX_DAMPING);
        }
        this.iter++;
        this.convergedBy = lmStopReason({ mf: this.mf, tol: this.tol, lamD: this.lamD, step: accepted });
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
            // D is calcMF's normalization denominator over the rows it scored
            // at this point (optical weight only, never the MNT/MXT/TT
            // constraint weights, and never a comment row's), so the gradient
            // is the gradient of the reported MF.
            let sumW = mfWeightDenominator(this.operands, compBase);
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

    _hasFreeParameters() {
        return this.lockedMask.some(locked => !locked);
    }

    // Converged when nothing is free, or when the LM step's last iteration met a
    // stopping test (convergedBy, lmStopping.js). The merit and damping tests
    // are repeated here for an engine that has not stepped yet.
    isConverged() {
        return !this._hasFreeParameters() || this.mf < this.tol || this.lamD >= LM_MAX_DAMPING
            || this.convergedBy != null;
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
