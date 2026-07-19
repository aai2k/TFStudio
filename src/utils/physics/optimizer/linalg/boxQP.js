/**
 * Box-constrained QP (primal active-set) for bounded SQP.
 *
 * Solves  min_Δ  ½ Δᵀ H Δ + gᵀΔ   s.t.  lo ≤ Δ ≤ hi   (element-wise box),
 * for a STRICTLY CONVEX H (the caller passes a diagonally-damped, PD Hessian —
 * raise damping and retry if this returns null). Textbook primal active-set:
 * repeatedly solve the equality-constrained sub-QP on the free set, add the
 * first variable that hits a bound along the step, and release a fixed variable
 * whose KKT multiplier points back into the feasible region — terminates
 * finitely for strictly convex box QPs. Returns the optimal Δ (always feasible:
 * lo ≤ Δ ≤ hi, and Δ = 0 must be feasible, i.e. lo ≤ 0 ≤ hi), or null if a
 * sub-solve is not PD.
 */

import { choleskySolve } from './cholesky.js';
import { _freeSubQP, _freeSet, _maxFeasibleStep, _stepAndPin, _kktRelease } from './activeSet.js';

export function solveBoxQP(H, g, lo, hi) {
    const n = g.length;
    const fixed = new Array(n).fill(0);   // 0 free, -1 pinned at lo, +1 pinned at hi
    const Delta = new Array(n).fill(0);
    const maxIter = 4 * n + 20;
    for (let iter = 0; iter < maxIter; iter++) {
        const F = _freeSet(fixed, n);
        if (F.length > 0) {
            const { Hs, bs } = _freeSubQP(H, g, Delta, fixed, F);
            const dF = choleskySolve(Hs, bs);
            if (!dF) return null;           // not PD → caller raises damping
            const step = _maxFeasibleStep(F, Delta, dF, lo, hi);
            if (_stepAndPin(Delta, fixed, F, dF, step)) continue;
        }
        // Free set at its constrained minimizer → try to release a pinned var.
        if (!_kktRelease(H, g, Delta, fixed, n)) break;
    }
    return Delta;
}
