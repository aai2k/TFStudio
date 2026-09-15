import { embeddedT, spectrumT } from './spectrum.js';

/**
 * Full width (nm) of the CENTRAL peak at an absolute T level. Returns 0 if the
 * peak never reaches the level.
 *
 * Only the order containing λ₀ is measured. At high spacer order the free
 * spectral range collapses and neighbouring orders fall inside any fixed
 * window, so taking the outermost crossings would measure several orders at
 * once.
 *
 * @param {function} [p.nInc]  incident index fn; defaults to nSub, the embedded case
 */
export function measureWidth(layers, lambda0_nm, level, nSub, { span = 80, step = 0.02, nInc = null } = {}) {
    const Tat = nInc ? (lam) => spectrumT(layers, lam, [nInc, nSub]) : (lam) => embeddedT(layers, lam, nSub);
    const lo = lambda0_nm - span, hi = lambda0_nm + span;
    const xs = [], ts = [];
    for (let lam = lo; lam <= hi + 1e-9; lam += step) { xs.push(lam); ts.push(Tat(lam)); }
    // central peak: index of max T nearest λ₀
    let ci = -1, best = Infinity;
    for (let i = 0; i < xs.length; i++) {
        if (ts[i] >= level) { const d = Math.abs(xs[i] - lambda0_nm); if (d < best) { best = d; ci = i; } }
    }
    if (ci < 0) return 0;
    let li = ci, ri = ci;
    while (li > 0 && ts[li] >= level) li--;
    while (ri < xs.length - 1 && ts[ri] >= level) ri++;
    const cross = (i0, i1) => { const t0 = ts[i0], t1 = ts[i1]; return t1 === t0 ? xs[i0] : xs[i0] + (level - t0) * (xs[i1] - xs[i0]) / (t1 - t0); };
    return Math.abs(cross(ri, ri - 1) - cross(li, li + 1));
}
