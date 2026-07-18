/**
 * Round a mirror layer count UP to odd. At λ₀ a half-wave spacer is an absentee
 * layer, so only ODD (both-ends-H) mirrors give a resonant cavity; even-layer
 * mirrors are anti-resonant (flat / valley-at-centre).
 */
export function oddUp(m) { const v = Math.max(1, Math.round(m)); return v % 2 === 1 ? v : v + 1; }

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
 * Coupled-cavity prototype mirror vector for N cavities: outer mirrors `go`,
 * inner (coupling) mirrors `gi` (both odd). The doubled inner mirrors give the
 * flat-top response — this IS Thelen's equivalent-layer prototype (the inner
 * "Equivalent layer 2" repeated q−1 times, Tikhonravov 2002 §3).
 *
 *   go = oddUp(m)
 *   gi = 2·go + 2δ − 1   for ODD m   (Thelen Eq. 10 inner mirror)
 *   gi = 2·go + 2δ − 3   for EVEN m  (one fewer inner pair)
 *
 * The parity step keeps consecutive m rows DISTINCT (m and m−1 round to the same
 * odd `go`). δ = `couplingOrder(...)` (1 for typical materials).
 */
export function coupledMirrors(N, m, d = 1) {
    const go = oddUp(m);
    const giBase = 2 * go + 2 * d - 1;
    const gi = (Math.round(m) % 2 === 1) ? giBase : Math.max(3, giBase - 2);
    const arr = [];
    for (let i = 0; i <= N; i++) arr.push((i === 0 || i === N) ? go : gi);
    return arr;
}
