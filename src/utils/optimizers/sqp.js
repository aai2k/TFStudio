/**
 * Bounded Sequential Quadratic Programming (SQP) refinement engine.
 *
 * A Newton step with the layer-thickness bounds [MNT, MXT] (∩ [D_MIN, D_MAX])
 * as HARD constraints instead of the soft one-sided quadratic penalties the
 * other engines use. Each step solves the box-constrained QP
 *     min_Δ  ½ Δᵀ H Δ + (Jᵀr)·Δ   s.t.   loᵢ ≤ dᵢ + Δᵢ ≤ hiᵢ
 * with H the analytic merit Hessian (diagonally damped to positive-definite) —
 * reusing LSQEngine._newtonSystem (Hessian/gradient) + the primal active-set
 * box-QP solver. Iterates stay feasible, so the MNT/MXT penalty residuals are
 * identically zero and contribute nothing: the box fully replaces the penalty,
 * with no weight-tuning and exact bound satisfaction.
 *
 * Sequential QP is recommended for complex problems; this is
 * the box-constrained core (qualifier/minmax inequality targets as constraints
 * are a documented follow-up). Works in ALL surface modes: it
 * reuses _newtonSystem, which gives a full analytic Hessian for single-surface
 * scoring (front_only / back_only with "ignore the other side" on) and a
 * Gauss-Newton Hessian (H=JᵀJ) for full-system scoring (Both / symmetric, or a
 * single side with "ignore the other side" off) — so step() always runs a
 * genuine bounded-QP step (never silently LM). A residual Cholesky/QP-failure
 * safeguard may defer to lmStep().
 *
 * Validated: tests/sqp_validation.mjs (exact bound satisfaction + equal-or-
 * better MF than the penalty approach on a bounded design).
 */
import { LSQEngine } from '../physics/optimizer.js';
import { solveBoxQP } from '../physics/optimizer/linalg.js';

export class SQPOptimizer extends LSQEngine {
    constructor(operands, design, resolveMat, opts = {}) {
        super(operands, design, resolveMat, opts);
        // Project the initial point into the hard box so the engine is feasible
        // from iteration 0 (and mfBest/thickBest reference a feasible design).
        const freeIdx = this.thicknesses.map((_, i) => i).filter(i => !this.lockedMask[i]);
        const { boxLo, boxHi } = this._thicknessBounds(freeIdx);
        let clamped = false;
        for (let a = 0; a < freeIdx.length; a++) {
            const k = freeIdx[a];
            const v = Math.min(boxHi[a], Math.max(boxLo[a], this.thicknesses[k]));
            if (v !== this.thicknesses[k]) { this.thicknesses[k] = v; clamped = true; }
        }
        if (clamped) {
            this.mf = this.mfAt(this.thicknesses);
            this.mfBest = this.mf;
            this.thickBest = [...this.thicknesses];
        }
    }

    // ── Per-free-variable hard thickness box [lo,hi] ────────────
    // D_MIN/D_MAX intersected with any MNT (lower) / MXT (upper) constraint operand
    // covering each layer. Constraint operands carry a 1-based layer-index range in
    // lambdaStart/lambdaEnd and the bound in target — the same convention the
    // analytic-Jacobian constraint subgradient uses.
    // Tighten [lo,hi] for one MNT (min-thickness) / MXT (max-thickness) operand
    // over the layer range it targets (1-based layer indices in [lambdaStart,
    // lambdaEnd]).
    _applyThicknessConstraint(op, freeIdx, lo, hi) {
        const a0 = Math.round(op.lambdaStart), a1 = Math.round(op.lambdaEnd);
        for (let a = 0; a < freeIdx.length; a++) {
            const layer1 = freeIdx[a] + 1;            // 1-based layer index
            if (layer1 < a0 || layer1 > a1) continue;
            if (op.type === 'MNT') lo[a] = Math.max(lo[a], op.target);
            else                   hi[a] = Math.min(hi[a], op.target);
        }
    }

    _thicknessBounds(freeIdx) {
        const nFree = freeIdx.length;
        const lo = new Array(nFree).fill(this.D_MIN);
        const hi = new Array(nFree).fill(this.D_MAX);
        for (const op of this.operands) {
            if (op.enabled && (op.type === 'MNT' || op.type === 'MXT'))
                this._applyThicknessConstraint(op, freeIdx, lo, hi);
        }
        for (let a = 0; a < nFree; a++) if (lo[a] > hi[a]) { const m = 0.5 * (lo[a] + hi[a]); lo[a] = hi[a] = m; }
        return { boxLo: lo, boxHi: hi };
    }

    // Keep thickBest inside the SQP feasible box so restoreBest() honours the
    // EXACT-bounds guarantee even when a step fell back to lmStep (which clamps
    // only to [D_MIN,D_MAX], not the MNT/MXT box) or when a prior best predates
    // the box. Re-evaluates mfBest at the projected point.
    _projectBestToBox(freeIdx, boxLo, boxHi) {
        if (!this.thickBest) return;
        let changed = false;
        const tb = [...this.thickBest];
        for (let a = 0; a < freeIdx.length; a++) {
            const k = freeIdx[a];
            const v = Math.min(boxHi[a], Math.max(boxLo[a], tb[k]));
            if (v !== tb[k]) { tb[k] = v; changed = true; }
        }
        if (changed) { this.thickBest = tb; this.mfBest = this.mfAt(tb); }
    }

    // Project the current point into the feasible box (a starting design may
    // violate user bounds; SQP enforces them from iteration 0). Re-evaluates mf
    // if the projection moved the point.
    _enterFeasibleBox(freeIdx, nFree, boxLo, boxHi) {
        const thk = this.thicknesses;
        let clamped = false;
        const thkF = [...thk];
        for (let a = 0; a < nFree; a++) {
            const k = freeIdx[a];
            const v = Math.min(boxHi[a], Math.max(boxLo[a], thk[k]));
            if (v !== thk[k]) { thkF[k] = v; clamped = true; }
        }
        if (clamped) { this.thicknesses = thkF; this.mf = this.mfAt(thkF); }
    }

    // Solve the damped box-constrained QP, escalating the diagonal damping μ until
    // the box-QP solver succeeds (or the retry budget is spent). Returns the step
    // Δ (null on failure) and the μ actually used.
    _solveDampedBoxQP({ H, Jtr, loD, hiD, mu }) {
        let delta = null;
        for (let tries = 0; tries < 12 && !delta; tries++) {
            const A = H.map((rowv, a) => { const r = rowv.slice(); r[a] = r[a] + mu * Math.max(Math.abs(rowv[a]), 1e-12) + 1e-12; return r; });
            delta = solveBoxQP(A, Jtr, loD, hiD);
            if (!delta) mu *= 10;
        }
        return { delta, mu };
    }

    // Bounded-SQP step: a Newton step with MNT/MXT as HARD box constraints instead
    // of soft penalties. Each iterate solves the box-constrained QP
    //   min ½ΔᵀHΔ + Jᵀr·Δ  s.t. lo ≤ d+Δ ≤ hi  (H = analytic merit Hessian, damped
    // to PD). Iterates stay feasible, so the MNT/MXT penalty residuals are zero and
    // contribute nothing to H/∇. Falls back to lmStep for unsupported modes/operands.
    // Separate damping state (lamS).
    step() {
        const thk     = this.thicknesses;
        const freeIdx = thk.map((_, i) => i).filter(i => !this.lockedMask[i]);
        const nFree   = freeIdx.length;
        if (nFree === 0) return;

        const { boxLo, boxHi } = this._thicknessBounds(freeIdx);
        this._enterFeasibleBox(freeIdx, nFree, boxLo, boxHi);
        // Also project the stored best: a fallback lmStep from a previous
        // iteration may have left thickBest outside the box.
        this._projectBestToBox(freeIdx, boxLo, boxHi);
        const thk2 = this.thicknesses;

        const sys = this._newtonSystem(thk2, freeIdx);
        if (!sys) { this.lmStep(); this._projectBestToBox(freeIdx, boxLo, boxHi); return; }     // unsupported → LM
        const { H, Jtr } = sys;

        // Δ-space box: lo ≤ Δ ≤ hi, with 0 feasible (thk2 already in box).
        const loD = new Array(nFree), hiD = new Array(nFree);
        for (let a = 0; a < nFree; a++) { loD[a] = boxLo[a] - thk2[freeIdx[a]]; hiD[a] = boxHi[a] - thk2[freeIdx[a]]; }

        const { delta, mu } = this._solveDampedBoxQP({ H, Jtr, loD, hiD, mu: this.lamS ?? 1e-3 });
        if (!delta) { this.lamS = Math.min(mu, 1e8); this.lmStep(); this._projectBestToBox(freeIdx, boxLo, boxHi); return; }

        const thkTry = [...thk2];
        for (let a = 0; a < nFree; a++) {
            const k = freeIdx[a];
            // box ⊆ [D_MIN,D_MAX]; clamp defensively against FP drift.
            thkTry[k] = Math.max(this.D_MIN, Math.min(this.D_MAX, thk2[k] + delta[a]));
        }
        const mfTry = this.mfAt(thkTry);
        if (mfTry < this.mf) {
            this.thicknesses = thkTry;
            this.mf   = mfTry;
            this.lamS = Math.max(mu * 0.3, 1e-6);
            if (mfTry < this.mfBest) { this.mfBest = mfTry; this.thickBest = [...thkTry]; }
        } else {
            this.lamS = Math.min(mu * 10, 1e8);
        }
        this.iter++;
    }

    isConverged() {
        return this.mf < this.tol || this.lamS >= 1e8 || this.lamD >= 1e8;
    }
}
