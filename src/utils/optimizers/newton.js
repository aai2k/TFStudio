/**
 * Modified-Newton ("Hyper Newton") refinement engine.
 *
 * Reuses the entire LSQEngine setup (surface-mode vector layout, residuals,
 * exact analytic Jacobian, bounds, locks, `_newtonSystem`), but each step() uses
 * the TRUE merit-function Hessian H = JᵀJ + Σ rₚ·∂²rₚ — assembled from the
 * FD-validated analytic comp-Hessian (tmmThicknessHessian) — and a Cholesky solve
 * of the diagonally-damped system (H + μ·diag)Δ = −Jᵀr, raising μ until PD (trust
 * region). This is the documented "Newton / Hyper Newton" endgame:
 * Gauss–Newton/LM keeps only JᵀJ and converges linearly; the second-order S
 * term restores quadratic convergence near the minimum.
 *
 * Surface modes: the full analytic Hessian (JᵀJ + S) is assembled whenever the
 * merit is scored on a SINGLE surface — front_only or back_only with
 * mfEvalMode='side' ("ignore the other side" on). back_only is the same single-
 * surface problem entered from the exit medium with the stack reversed; getH
 * mirrors _analyticJacobian's isSingleBack remap. When the merit is full-system
 * (evalFullSystem: both_independent / symmetric, or a single side with "ignore
 * the other side" off / mfEvalMode='total') — or for math/argwave/TT/σ≠1
 * operands — _newtonSystem returns a Gauss-Newton Hessian (H=JᵀJ) instead. So
 * step() always runs a genuine (Gauss-)Newton step, never silently the LM step.
 * A residual Cholesky non-PD safeguard can still defer to lmStep().
 *
 * Reference: Tikhonov, Tikhonravov, Trubetskov, "Second order optimization
 * methods in the synthesis of multilayer coatings," Comp. Maths. Math. Phys.
 * 33, 1339 (1993). Validated: tests/hessian_fd_validation.mjs (kernel) +
 * tests/newton_validation.mjs (merit Hessian + convergence).
 */
import { LSQEngine } from '../physics/optimizer.js';
import { choleskySolve } from '../physics/optimizer/linalg.js';

export class NewtonOptimizer extends LSQEngine {
    // Modified-Newton ("Hyper Newton") step: solve (H + μ·diag(H))Δ = −Jᵀr via
    // Cholesky, raising μ until the damped Hessian is positive definite (trust
    // region). Accept/reject + μ-adaptation mirror the LM step(); on any
    // unsupported case it transparently falls back to the LM step (lmStep). Uses
    // a SEPARATE damping state (this.lamN) so it can be interleaved with lmStep.
    step() {
        const thk     = this.thicknesses;
        const freeIdx = thk.map((_, i) => i).filter(i => !this.lockedMask[i]);
        const nFree   = freeIdx.length;
        if (nFree === 0) return;

        const sys = this._newtonSystem(thk, freeIdx);
        if (!sys) { this.lmStep(); return; }     // unsupported → LM
        const { H, Jtr } = sys;

        let mu = this.lamN ?? 1e-3;
        const rhs = Jtr.map(x => -x);
        let delta = null;
        for (let tries = 0; tries < 12 && !delta; tries++) {
            // Damp the diagonal: A = H + μ·|diag(H)| + ε  (Levenberg on the true H).
            const A = H.map((rowv, a) => {
                const r = rowv.slice();
                r[a] = r[a] + mu * Math.max(Math.abs(rowv[a]), 1e-12) + 1e-12;
                return r;
            });
            delta = choleskySolve(A, rhs);     // null if A not PD → raise μ
            if (!delta) mu *= 10;
        }
        if (!delta) { this.lamN = Math.min(mu, 1e8); this.lmStep(); return; }  // give up → LM

        const thkTry = [...thk];
        for (let a = 0; a < nFree; a++) {
            const k = freeIdx[a];
            thkTry[k] = Math.max(this.D_MIN, Math.min(this.D_MAX, thk[k] + delta[a]));
        }
        const mfTry = this.mfAt(thkTry);
        if (mfTry < this.mf) {
            this.thicknesses = thkTry;
            this.mf   = mfTry;
            this.lamN = Math.max(mu * 0.3, 1e-6);
            if (mfTry < this.mfBest) { this.mfBest = mfTry; this.thickBest = [...thkTry]; }
        } else {
            this.lamN = Math.min(mu * 10, 1e8);
        }
        this.iter++;
    }

    // Converge on the merit tolerance, on the Newton damping saturating, OR on
    // the LM damping saturating (the latter only when the step fell back to lmStep).
    isConverged() {
        return this.mf < this.tol || this.lamN >= 1e8 || this.lamD >= 1e8;
    }
}
