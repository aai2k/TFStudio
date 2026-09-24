/**
 * Truncated Newton (Newton-CG) refinement engine (matrix-free).
 *
 * The SCALABLE second-order method: a Newton step solved approximately by inner
 * Steihaug-CG using only Hessian-vector products H·v ≈ (∇MF(x+εv) − ∇MF(x))/ε
 * built from the analytic gradient (gradMF) — never the dense Hessian. This
 * avoids the dense Newton engine's O(N²) Hessian assembly (benchmarked at ~17×
 * the cost of one gradient on a 50-layer design, `tests/newton_perf.mjs`) and
 * the O(N³) factorization, and stays on the WASM-accelerated gradient path.
 *
 * Works for ALL surface modes: it only calls gradMF, which is exact-analytic in
 * every surface mode (the Jacobian was extended to single-surface direct +
 * Macleod §2.6.4 full-system chain rule) with an FD fallback for the rare
 * unsupported operands — so unlike the dense Newton engine there is nothing
 * per-mode to derive; this engine never needed the front_only restriction.
 *
 * Recommended for complex, large-scale problems: it approximates the Newton
 * step with an iterative CG solver to manage computational cost in
 * high-dimensional parameter spaces. Trust-region globalization
 * (Nocedal & Wright 2e §7.1).
 */
import { LSQEngine } from '../physics/optimizer.js';
import { steihaugCG, _vnorm } from '../physics/optimizer/linalg.js';
import { limitStepToSpans } from '../physics/optimizer/halfWaveSpan.js';
import { movablePositions, projectedTrial } from '../physics/optimizer/boundedStep.js';

export class NewtonCGOptimizer extends LSQEngine {
    // Hessian-vector product via central-free forward FD of the analytic
    // gradient: H·v ≈ (∇MF(x+εv) − ∇MF(x))/ε, projected to the free coordinates.
    // The probe x+εv is not clamped to the box. It moves no layer by more than
    // 1.5e-8·(1 + ‖x‖∞) nm and the merit is smooth across a bound, whereas a
    // clamped probe would no longer be εv away from x.
    _makeHvp({ thk, freeIdx, g, xinf, nFree }) {
        return (v) => {
            let vinf = 0; for (let a = 0; a < nFree; a++) vinf = Math.max(vinf, Math.abs(v[a]));
            if (vinf < 1e-300) return new Array(nFree).fill(0);
            const eps = Math.sqrt(2.2e-16) * (1 + xinf) / vinf;
            const xp = [...thk];
            for (let a = 0; a < nFree; a++) {
                const k = freeIdx[a];
                xp[k] = thk[k] + eps * v[a];
            }
            const gp = this.gradMF(xp, freeIdx);
            const out = new Array(nFree);
            for (let a = 0; a < nFree; a++) out[a] = (gp[freeIdx[a]] - g[a]) / eps;
            return out;
        };
    }

    // Trial the trust-region step p on the variables in moveIdx: evaluate the
    // actual vs model decrease, resize the trust radius, and accept when the
    // step improves the merit. The trial is projected onto the box, and the
    // model is judged on the move s that projection leaves, not on p.
    _applyTrustStep({ thk, freeIdx, moveIdx, g, p, hvp, tr }) {
        const thkTry = projectedTrial(this, freeIdx, moveIdx, p);
        const s = moveIdx.map((k, a) => (thkTry[k] === thk[k] + p[a] ? p[a] : thkTry[k] - thk[k]));
        const Hs = hvp(s);
        let sHs = 0, gs = 0;
        for (let a = 0; a < s.length; a++) { sHs += s[a] * Hs[a]; gs += g[a] * s[a]; }
        const pred = -(gs + 0.5 * sHs);          // model decrease of MF

        const mfTry  = this.mfAt(thkTry);
        const actual = this.mf - mfTry;
        const ratio  = pred > 1e-18 ? actual / pred : (actual > 0 ? 1 : -1);
        const pnorm  = _vnorm(p);

        let trNew = tr;
        if (ratio < 0.25)                         trNew = 0.25 * tr;
        else if (ratio > 0.75 && pnorm > 0.8 * tr) trNew = Math.min(2 * tr, 1e4);
        this.tnTrust = Math.max(trNew, 1e-6);

        if (ratio > 0.1 && actual > 0) {
            this.thicknesses = thkTry;
            this.mf = mfTry;
            if (mfTry < this.mfBest) { this.mfBest = mfTry; this.thickBest = [...thkTry]; }
            this.tnStall = 0;
        } else {
            this.tnStall = (this.tnStall || 0) + 1;
        }
    }

    // Matrix-free Truncated Newton (Newton-CG) step: solve H·p = −∇MF
    // approximately by inner Steihaug-CG, with Hessian-vector products from a
    // forward-FD of the analytic gradient. Each inner CG iter = one extra gradMF
    // (WASM-accelerated), so a step costs ~(k+2) gradients instead of the dense
    // Hessian's O(N²) assembly. Trust region governs acceptance + step size; works
    // for ALL surface modes (only needs gradMF). Reference: Nocedal & Wright 2e §7.1.
    step() {
        const thk     = this.thicknesses;
        const freeIdx = thk.map((_, i) => i).filter(i => !this.lockedMask[i]);
        const nFree   = freeIdx.length;
        if (nFree === 0) return;

        // Layers held at a bound by the gradient take no step; the CG solve,
        // its Hessian-vector products and the trust ratio all live on the
        // remaining layers (boundedStep.js).
        const gFull = this.gradMF(thk, freeIdx);
        const moveIdx = movablePositions(this, freeIdx, freeIdx.map(k => gFull[k])).map(a => freeIdx[a]);
        const g = moveIdx.map(k => gFull[k]);
        const gnorm = _vnorm(g);
        if (gnorm < 1e-10) { this.tnStall = (this.tnStall || 0) + 1; this.iter++; return; }

        let xinf = 0; for (let a = 0; a < nFree; a++) xinf = Math.max(xinf, Math.abs(thk[freeIdx[a]]));
        const hvp = this._makeHvp({ thk, freeIdx: moveIdx, g, xinf, nFree: moveIdx.length });

        const tr = this.tnTrust ?? Math.max(1, 0.1 * (1 + xinf));
        const maxCG = Math.min(moveIdx.length, 25);
        const p = limitStepToSpans(steihaugCG(hvp, g, tr, maxCG), moveIdx, this.stepSpans);

        this._applyTrustStep({ thk, freeIdx, moveIdx, g, p, hvp, tr });
        this.iter++;
    }

    // Converge on merit tolerance or when the trust-region step stalls (several
    // consecutive rejected/zero-gradient steps ⇒ at a local minimum).
    isConverged() {
        return !this._hasFreeParameters() || this.mf < this.tol || (this.tnStall || 0) >= 6;
    }
}
