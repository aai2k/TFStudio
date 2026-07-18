/**
 * Analytic "schematic" target curve for the step-2 preview — a smooth
 * (Butterworth / maximally-flat) band-pass bell that passes EXACTLY through the
 * two spec points: T = passLevel at ±halfPass and T = stopLevel at ±halfStop.
 * This is the step-2 "schematic of the filter to be designed" — an
 * idealized target, NOT a real multilayer response (which is why the old
 * embedded-TMM preview showed a comb of split peaks).
 *
 *   T(x) = 1 / (1 + ε²·x^(2p)),   x = |λ−λ₀|/halfPass
 *   ε² = 1/passLevel − 1                       (so T(1) = passLevel)
 *   p  = ln((1/stopLevel−1)/ε²) / (2·ln SF)    (so T(SF) = stopLevel)
 *
 * @returns {(lam:number)=>number}  T in [0,1]
 */
export function idealFilterCurve({ lambda0_nm, halfPass, halfStop, passLevel = 0.8913, stopLevel = 0.001 }) {
    const eps2 = Math.max(1e-9, 1 / passLevel - 1);
    const SF = halfStop / halfPass;
    let p = 4;
    if (SF > 1 && stopLevel > 0 && stopLevel < passLevel) {
        const rhs = (1 / stopLevel - 1) / eps2;
        p = Math.log(rhs) / (2 * Math.log(SF));
    }
    return (lam) => {
        const x = Math.abs(lam - lambda0_nm) / halfPass;
        return 1 / (1 + eps2 * Math.pow(x, 2 * p));
    };
}
