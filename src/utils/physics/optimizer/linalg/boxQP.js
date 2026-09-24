/**
 * Box-constrained QP (primal active-set) for bounded SQP.
 *
 * Solves  min_Δ  q(Δ) = ½ Δᵀ H Δ + gᵀΔ   s.t.  lo ≤ Δ ≤ hi  (element-wise box),
 * for a STRICTLY CONVEX H (the caller passes a diagonally damped, PD Hessian
 * and raises the damping to retry when this returns null). Textbook primal
 * active-set (Nocedal & Wright 2e, §16.5): repeatedly solve the
 * equality-constrained sub-QP on the free set, add the first variable that
 * hits a bound along the step, and release the one fixed variable whose KKT
 * multiplier points furthest back into the feasible region. Δ = 0 must be
 * feasible (lo ≤ 0 ≤ hi); every iterate is feasible and q never rises.
 *
 * Returns { delta, converged }, or null if a sub-solve is not PD. converged is
 * false when the pass cap stopped the solver before the KKT conditions held;
 * delta is then the last feasible iterate.
 */

import { _freeSetStep, _kktRelease } from './activeSet.js';

export function solveBoxQP(H, g, lo, hi, maxPasses = 4 * g.length + 20) {
    const n = g.length;
    const fixed = new Array(n).fill(0);   // 0 free, -1 pinned at lo, +1 pinned at hi
    const Delta = new Array(n).fill(0);
    const qp = { H, g, lo, hi };
    let released = -1;                    // released at the last KKT point, not moved since
    for (let pass = 0; pass < maxPasses; pass++) {
        const step = _freeSetStep(qp, Delta, fixed);
        if (!step) return null;             // not PD → caller raises damping
        if (step.pinned) {
            // Released with a multiplier of the wrong sign, a variable moves
            // off its bound. Pinned straight back with no move, its
            // multiplier was rounding noise: Δ is already the minimizer.
            if (step.t === 0 && step.block === released) return { delta: Delta, converged: true };
            if (step.t > 0) released = -1;
            continue;
        }
        // Free set at its constrained minimizer → try to release a pinned var.
        released = _kktRelease(H, g, Delta, fixed, n);
        if (released < 0) return { delta: Delta, converged: true };
    }
    return { delta: Delta, converged: false };
}

// q(Δ) = ½ ΔᵀHΔ + gᵀΔ.
export function boxQPValue(H, g, Delta) {
    let q = 0;
    for (let i = 0; i < g.length; i++) {
        let hd = 0;
        for (let j = 0; j < g.length; j++) hd += H[i][j] * Delta[j];
        q += Delta[i] * (g[i] + 0.5 * hd);
    }
    return q;
}
