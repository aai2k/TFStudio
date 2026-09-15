/**
 * Thelen coupling order δ from Eq. 10 (N₁² = nₛ·N₂).
 *
 * A both-ends-H quarter-wave mirror of 2x+1 layers presents equivalent index
 * N = nH^(x+1)/nL^x to the cavity. Writing the outer mirror as N₁ (x₁ pairs) and
 * the inner coupling mirror as N₂ (x₂ pairs), the Thelen matching condition
 * N₁² = nₛ·N₂ reduces to  nH·(nL/nH)^δ = nₛ  with δ = x₂ − 2·x₁, i.e.
 *
 *   δ = round( ln(nₛ/nH) / ln(nL/nH) )
 *
 * so the inner mirror has m_inner = 2·m_outer + 2δ − 1 layers. Verified against
 * Tikhonravov 2002 Table 1 (nH=2.1, nL=1.45, nₛ=1.52 → δ=1, outer 17 → inner 35).
 */
export function couplingOrder(nHv, nLv, nSv) {
    if (!(nHv > nLv && nLv > 0 && nSv > 0)) return 1;
    const d = Math.round(Math.log(nSv / nHv) / Math.log(nLv / nHv));
    return Math.max(0, d);
}

/**
 * Coupled-cavity prototype mirror vector for N cavities: outer mirrors of m
 * quarter-wave layers, inner (coupling) mirrors of 2m + 2δ − 1. The doubled
 * inner mirrors give the flat-top response: this is Thelen's equivalent-layer
 * prototype (the inner "Equivalent layer 2" repeated q−1 times, Tikhonravov
 * 2002 §3), and δ = `couplingOrder(...)` (1 for typical materials).
 *
 * Both parities of m are prototypes. An even m simply means the mirrors end on
 * the other material from where they started, which the alternating stack of
 * `prototypePositions` expresses by moving the spacers to the other material;
 * the cavities stay resonant either way.
 */
export function coupledMirrors(N, m, d = 1) {
    const go = Math.max(1, Math.round(m));
    const gi = Math.max(1, 2 * go + 2 * d - 1);
    const arr = [];
    for (let i = 0; i <= N; i++) arr.push((i === 0 || i === N) ? go : gi);
    return arr;
}
