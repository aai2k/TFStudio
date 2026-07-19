/**
 * Primal active-set mechanics for the box-constrained QP (linalg/boxQP.js).
 *
 * Pure helpers that build the free-set sub-problem, take the largest feasible
 * step, pin blocking variables, and release variables whose KKT multiplier
 * points back into the feasible region.
 */

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

// Release one pinned variable whose KKT multiplier λ_i = (H·Δ + g)_i points back
// into the feasible region (λ<0 at lo, λ>0 at hi). Mutates `fixed`; returns
// true if any variable was released.
export function _kktRelease(H, g, Delta, fixed, n) {
    const HD = new Array(n).fill(0);
    for (let i = 0; i < n; i++) { let s = 0; const Hi = H[i]; for (let j = 0; j < n; j++) s += Hi[j] * Delta[j]; HD[i] = s; }
    let released = false;
    for (let i = 0; i < n; i++) {
        if (!fixed[i]) continue;
        const lam = HD[i] + g[i];
        if (fixed[i] < 0 && lam < -1e-12) { fixed[i] = 0; released = true; }
        else if (fixed[i] > 0 && lam > 1e-12) { fixed[i] = 0; released = true; }
    }
    return released;
}
