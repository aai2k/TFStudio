/**
 * Chebyshev estimate of the required number of cavities from the shape factor.
 *
 *   q = acosh( √((1/T_s − 1)/(1/T_p − 1)) ) / acosh(SF)
 *
 * with T_p the passband-edge transmittance (default 0.8913 = 0.5 dB) and T_s the
 * stopband transmittance (default 0.001 = 30 dB).
 *
 * METHOD (Tikhonravov & Trubetskov 2002, §3 + Appendix A): the minimum number
 * of cavities q is the smallest order for which the Chebyshev polynomial
 * T_q(S) exceeds the threshold  √((1/T_s − 1)/ρ),  ρ = 1/T_p − 1  (Eq. 6/9),
 * computed via the recurrence T_0=1, T_1=S, T_j = 2·S·T_{j−1} − T_{j−2} (Eq. A2).
 * The "more than q" rule defaults to q+1, so `recommended = q+1`.
 *   - S = 1.714 → q = 5 (paper's worked example, "five or more").
 *   - S = 3     → q = 3, recommended 4 (LEC25D9, ">3" → 4).
 *
 * @returns {{ q:number, recommended:number, threshold:number }}  q = Chebyshev minimum
 */
export function recommendCavities({ shapeFactor, Tpass = 0.8913, Tstop = 0.001 }) {
    const S = shapeFactor;
    if (!(S > 1) || !isFinite(S)) return { q: 0, recommended: 1, threshold: 0 };
    const rho = 1 / Tpass - 1;                       // Eq. 5
    const threshold = Math.sqrt((1 / Tstop - 1) / rho);   // Eq. 6/9 (≈100 for −0.5/−30 dB)
    let Tprev = 1, Tcur = S, q = 1;                  // T_0, T_1
    if (Tcur > threshold) return { q: 1, recommended: 2, threshold };
    for (q = 2; q <= 60; q++) {
        const Tnext = 2 * S * Tcur - Tprev;          // Eq. A2
        if (Tnext > threshold) break;
        Tprev = Tcur; Tcur = Tnext;
    }
    return { q, recommended: q + 1, threshold };
}
