/**
 * Primal active-set mechanics for the box-constrained QP (linalg/boxQP.js).
 *
 * Pure helpers that build the free-set sub-problem, take the largest feasible
 * step, pin blocking variables, and release the variable whose KKT multiplier
 * points furthest back into the feasible region.
 */

import { choleskySolve } from './cholesky.js';

// Assemble the equality-constrained sub-QP on the free set F:
// H_FF·δ = −(g_F + H_FW·Δ_W). Returns { Hs, bs }.
export function _freeSubQP(H, g, Delta, fixed, F) {
    const n = g.length;
    const nf = F.length;
    const Hs = Array.from({ length: nf }, () => new Array(nf).fill(0));
    const bs = new Array(nf).fill(0);
    for (let a = 0; a < nf; a++) {
        let rhs = -g[F[a]];
        for (let i = 0; i < n; i++) if (fixed[i]) rhs -= H[F[a]][i] * Delta[i];
        bs[a] = rhs;
        const Hrow = H[F[a]];
        for (let b = 0; b < nf; b++) Hs[a][b] = Hrow[F[b]];
    }
    return { Hs, bs };
}

// Indices of the currently-free variables (fixed[i] === 0).
export function _freeSet(fixed, n) {
    const F = [];
    for (let i = 0; i < n; i++) if (!fixed[i]) F.push(i);
    return F;
}

// Largest feasible step t∈[0,1] from Δ toward the free sub-solution dF, plus the
// first variable to hit a bound (block; blockSide −1 = lo, +1 = hi; −1 = none)
// and blockVal = the bound value that variable pins to.
export function _maxFeasibleStep(F, Delta, dF, lo, hi) {
    let t = 1, block = -1, blockSide = 0;
    for (let a = 0; a < F.length; a++) {
        const i = F[a], from = Delta[i], to = dF[a];
        if (to < lo[i] - 1e-15) { const tt = (lo[i] - from) / (to - from); if (tt < t) { t = tt; block = i; blockSide = -1; } }
        else if (to > hi[i] + 1e-15) { const tt = (hi[i] - from) / (to - from); if (tt < t) { t = tt; block = i; blockSide = 1; } }
    }
    const blockVal = block < 0 ? 0 : (blockSide < 0 ? lo[block] : hi[block]);
    return { t, block, blockSide, blockVal };
}

// Advance Δ by the feasible fraction t toward dF over the free set, then, if a
// variable blocked, pin it to its bound. Mutates Delta/fixed; returns true if a
// variable was pinned (caller re-iterates the active set).
export function _stepAndPin(Delta, fixed, F, dF, step) {
    const { t, block, blockSide, blockVal } = step;
    for (let a = 0; a < F.length; a++) { const i = F[a]; Delta[i] = Delta[i] + t * (dF[a] - Delta[i]); }
    if (block >= 0) { Delta[block] = blockVal; fixed[block] = blockSide; return true; }
    return false;
}

// One pass on the free set of the QP { H, g, lo, hi }: solve its sub-QP, move
// Δ as far toward that solution as the box allows, and pin the variable that
// blocks. Mutates Delta/fixed. Returns null when the sub-QP is not PD, else
// the step taken: { t, block, pinned } (see _maxFeasibleStep); an empty free
// set takes none.
export function _freeSetStep(qp, Delta, fixed) {
    const F = _freeSet(fixed, qp.g.length);
    if (F.length === 0) return { t: 0, block: -1, pinned: false };
    const { Hs, bs } = _freeSubQP(qp.H, qp.g, Delta, fixed, F);
    const dF = choleskySolve(Hs, bs);
    if (!dF) return null;
    const step = _maxFeasibleStep(F, Delta, dF, qp.lo, qp.hi);
    return { t: step.t, block: step.block, pinned: _stepAndPin(Delta, fixed, F, dF, step) };
}

// Release the one pinned variable whose KKT multiplier λ_i = (H·Δ + g)_i points
// furthest back into the feasible region (λ<0 at lo, λ>0 at hi). Dropping a
// single wrong-sign bound per pass makes the next step leave that bound and
// lower q, which the method's finite termination rests on (Nocedal & Wright
// 2e, §16.5). A multiplier within the rounding error of its own sum,
// n·ε·(|g_i| + Σ_j |H_ij·Δ_j|) (Higham, Accuracy and Stability of Numerical
// Algorithms 2e, §3.1), and never below 1e-12, counts as zero. Mutates
// `fixed`; returns the released index, or −1 when every multiplier has the
// KKT sign.
export function _kktRelease(H, g, Delta, fixed, n) {
    const roundoff = n * Number.EPSILON;
    let release = -1, most = 0;
    for (let i = 0; i < n; i++) {
        if (!fixed[i]) continue;
        let s = 0, size = Math.abs(g[i]);
        const Hi = H[i];
        for (let j = 0; j < n; j++) { const t = Hi[j] * Delta[j]; s += t; size += Math.abs(t); }
        const lam = s + g[i];
        const inward = fixed[i] < 0 ? lam : -lam;     // < 0: q falls moving off the bound
        if (inward < -Math.max(1e-12, roundoff * size) && inward < most) { most = inward; release = i; }
    }
    if (release >= 0) fixed[release] = 0;
    return release;
}
