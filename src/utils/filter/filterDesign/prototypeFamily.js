import { nReal } from './nReal.js';
import { couplingOrder } from './coupledPrototype.js';
import { MIRROR_BOUNDS, ORDER_BOUNDS } from './searchClamps.js';

/**
 * Fitted constant relating the specified passband width to the width the
 * prototype table aims at. OptiLayer's tables sit consistently narrower than
 * the specification, by 0.844 and 0.867 of it on the two photographed runs,
 * within each other's quantisation spread, across two wavelengths, two material
 * systems and three against five cavities. 0.98 reproduces 31 of the 31 rows on
 * record for that build (the two runs plus Tikhonravov 2002 Table 1); 1.00 does
 * not. Other builds aim at a different width and need their own constant, so do
 * not average them together.
 */
export const WIDTH_CONSTANT = 0.98;

/**
 * Ratio of a Chebyshev filter's half-power width to its width at the specified
 * passband level: the x with T_q(x) = √(1/ρ), ρ = 1/passLevel − 1.
 *
 * Tikhonravov & Trubetskov, Appl. Opt. 41, 3176 (2002), Eq. 5–6.
 */
function halfPowerWidthRatio(q, passLevel) {
    const rho = Math.max(1e-12, 1 / passLevel - 1);
    return Math.cosh(Math.acosh(Math.sqrt(1 / rho)) / Math.max(1, q));
}

/**
 * Smallest spacer order whose (m, k) prototype is no wider than `relWidth`
 * (a fraction of λ₀).
 *
 * Thelen's passband edge, Macleod, Thin-Film Optical Filters 5th ed.,
 * Eq. 8.59–8.61 (pp. 293–294):
 *
 *   Δλ_B/λ₀ = (4/(kπ))·(n_L/n_H)^x·(n_H − n_L)/(n_H − n_L + n_L/k),  x = m + δ
 *
 * which is (4/π)·(n_L/n_H)^x·(n_H − n_L) / (k·(n_H − n_L) + n_L) and so falls
 * monotonically in k. Inverting it gives the order directly, with no search.
 */
function smallestOrder(m, relWidth, { nHv, nLv, delta }) {
    const contrast = nHv - nLv;
    const numer = (4 / Math.PI) * Math.pow(nLv / nHv, m + delta) * contrast;
    return Math.max(1, Math.ceil((numer / relWidth - nLv) / contrast));
}

/**
 * Build the step-4 equivalent-prototype table: the (m, k) pairs whose coupled
 * q-cavity prototype all have approximately the passband width the
 * specification asks for. There are two ways to hit a given width, stronger
 * mirrors at low spacer order or weaker mirrors at high order, so the table
 * trades m against k at constant width, and the user picks a row as the search
 * seed.
 *
 * Rows run from m = 1 up to the first m that reaches the width at k = 1, and in
 * each row k is the smallest order that fits. Reference tables run to 15 rows
 * and to orders in the hundreds, so the row count is not capped for its own
 * sake; what bounds it is the range the integer search can actually hold, since
 * a row outside that range would be clamped the moment the search started. The
 * table is analytic: measuring each row by TMM costs a quarter of a second per
 * row and buys nothing.
 *
 * @param {number} p.targetFWHM   specified passband full width (nm) = 2·halfPass
 * @param {number} p.cavities     q, which sets the Chebyshev width ratio
 * @param {number} p.passLevel    transmittance the half-width is quoted at (0–1)
 * @param {number} p.widthConstant  which build's prototype width to aim at
 * @param {number} [p.maxMirror]  strongest mirror a row may ask for
 * @param {number} [p.maxOrder]   highest spacer order a row may ask for
 * @returns {{notationM:number, spacerOrder:number}[]}  strongest mirror first
 */
export function buildPrototypeFamily({
    nH, nL, nSub, lambda0_nm, cavities = 4, targetFWHM = 3, passLevel = 0.8913,
    widthConstant = WIDTH_CONSTANT,
    maxMirror = MIRROR_BOUNDS.max, maxOrder = ORDER_BOUNDS.max,
}) {
    const nHv = nReal(nH, lambda0_nm), nLv = nReal(nL, lambda0_nm);
    if (!(nHv > nLv && nLv > 0 && lambda0_nm > 0 && targetFWHM > 0)) return [];
    const ctx = { nHv, nLv, delta: couplingOrder(nHv, nLv, nReal(nSub, lambda0_nm)) };
    const q = Math.max(1, Math.round(cavities));
    const relWidth = widthConstant * halfPowerWidthRatio(q, passLevel) * targetFWHM / lambda0_nm;

    // k falls monotonically in m, so the rows dropped for exceeding maxOrder are
    // the weak-mirror tail and the kept rows stay contiguous in m.
    const rows = [];
    for (let m = 1; m <= maxMirror; m++) {
        const k = smallestOrder(m, relWidth, ctx);
        if (k <= maxOrder) rows.push({ notationM: m, spacerOrder: k });
        if (k === 1) break;
    }
    rows.reverse();
    return rows;
}
