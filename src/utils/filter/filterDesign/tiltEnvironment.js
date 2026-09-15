import { embeddedT } from './spectrum.js';
import { targetSpan } from './filterTarget.js';

/**
 * A narrowband filter tilted in collimated light, in Macleod's first-order
 * model (Thin-Film Optical Filters 5th ed., §8.2.5, p. 276): at oblique
 * incidence every layer's phase thickness carries a factor cos θ_j, and "in
 * narrowband filters, the predominant effect is the apparent change in
 * thickness that moves the filter passband to shorter wavelengths". The
 * admittances stay at their normal-incidence values, the step the book takes
 * on p. 278 ("we replace η by n") to derive the effective index of a tilted
 * cavity, Eq. 8.35 to 8.38. A candidate tilted to θ is therefore evaluated at
 * normal incidence with every thickness multiplied by cos θ_j, where
 *
 *   sin θ_j = sin θ / n_j                                   (p. 278)
 *
 * θ is in degrees and is the angle in AIR, the incident medium of the finished
 * filter. Steps 1 to 5 evaluate the filter embedded in its substrate, but the
 * invariant n sin θ referred to free space (p. 278) keeps the substrate index
 * out of the conversion.
 *
 * The model keeps the differential shrink of the H and L layers, which is what
 * moves cavities of different effective index apart (§8.4.1: "Detuned cavities
 * have a seriously degrading effect on multiple-cavity filters"). It leaves
 * out the s/p admittance split. The integer search has no lever on that split,
 * so scoring it would only add the same floor to every candidate.
 */

/** cos of the angle inside a medium of index n, for a wave at sin θ in air. */
function cosInside(sinAir, n) {
    const s = sinAir / n;
    return Math.sqrt(Math.max(0, 1 - s * s));
}

const sinOf = (deg) => Math.sin(deg * Math.PI / 180);

/**
 * The candidate as light tilted to `tiltDeg` sees it: each layer's thickness
 * scaled by cos of its own refraction angle.
 *
 * The angle is taken at the layer's index at λ₀, not at each wavelength. Over
 * the window the target spans, dispersion changes cos θ_j by under 4e-5 for
 * the builtin Nb2O5 and SiO2 at 15°. Measured against the per-wavelength
 * factor on designs from a search with those materials, the band moves by
 * 0.005 nm against a target point spacing of halfPass/8 and the tilted merit
 * by under 1 %; a per-wavelength factor would cost a square root per layer in
 * every TMM call for that.
 */
export function tiltedLayers(layers, tiltDeg) {
    const sinAir = sinOf(tiltDeg);
    return layers.map((L) => ({ ...L, d: L.d * cosInside(sinAir, L.n0) }));
}

/**
 * Padding of the centring scan beyond the bracket, in units of halfPass. The
 * half-maximum crossings of a passband sit about F(q)·halfPass from its
 * centre, F(q) the half-power over 0.5 dB width ratio of a q-cavity Chebyshev
 * response (halfPowerWidthRatio in prototypeFamily.js), which is 1.17 at
 * three cavities and falls from there. 1.5 keeps both crossings inside the
 * scan wherever the centre falls in the bracket, and covers the tenth of a
 * nanometre by which the coupled response of very high-order cavities can
 * sit past the bracket's edge.
 */
const SCAN_PAD = 1.5;

/**
 * Scan step in units of halfPass. A band still above half maximum is at least
 * 2·halfPass wide, so a third of halfPass puts six or more samples on it and
 * the scan cannot step over it. The spikes a torn band leaves can fall between
 * samples; that changes nothing, since such a design is scored as torn either
 * way.
 */
const SCAN_STEP = 1 / 3;

/**
 * Bisection halvings per half-maximum crossing. Six take a crossing from the
 * scan step to halfPass/192, a twenty-fourth of the target point spacing
 * (halfPass/8), below anything the merit can resolve.
 */
const BISECTIONS = 6;

/**
 * Transmittance below which the tilted band counts as torn. A passband that
 * survives reaches 100 % embedded, so its half maximum is 50 %; a scan whose
 * highest sample is below that has no half-maximum crossings to centre on.
 */
const TORN = 0.5;

/**
 * Interval the tilted cavity resonances lie in. A cavity of effective index
 * n* moves to λ₀·cos θ*, and every n* lies between n_L and n_H: Eq. 8.35 and
 * 8.37 start from the first-order values of Pidgeon and Smith (Eq. 8.36 and
 * 8.38), which lie between the two, and tend to n_H and n_L as the order
 * grows. The layer indices at λ₀ are read off the layers themselves.
 */
function centreBracket(layers, lambda0_nm, tiltDeg) {
    const sinAir = sinOf(tiltDeg);
    let nLo = Infinity, nHi = 0;
    for (const L of layers) { nLo = Math.min(nLo, L.n0); nHi = Math.max(nHi, L.n0); }
    return [lambda0_nm * cosInside(sinAir, nLo), lambda0_nm * cosInside(sinAir, nHi)];
}

/**
 * Lowest wavelength the tilted evaluation can ask a material for: the bottom
 * of the centring scan less the reach of the target points. A caller that
 * samples materials onto a grid has to cover it.
 */
export function tiltWindowLow({ lambda0_nm, tiltDeg, nLow, halfPass, halfStop }) {
    return lambda0_nm * cosInside(sinOf(tiltDeg), nLow) - SCAN_PAD * halfPass - targetSpan(halfPass, halfStop);
}

/**
 * One half-maximum crossing: walk from the peak sample in direction `dir`
 * until a sample falls below `half`, on the scan samples first and past their
 * end at the same step, then bisect between the last two. The walk stops at
 * `limit`, the reach of the target on that side: a band still above half
 * maximum there has no rejection edge the merit could see, and the limit
 * stands in for the crossing.
 */
function halfMaxCrossing(scan, iPeak, dir, half, limit) {
    const { xs, ts, step, Tof } = scan;
    let lamIn = xs[iPeak], lamOut = null;
    for (let i = iPeak + dir; lamOut === null; i += dir) {
        const onScan = i >= 0 && i < xs.length;
        const lam = onScan ? xs[i] : lamIn + dir * step;
        if ((lam - limit) * dir > 0) return limit;
        if ((onScan ? ts[i] : Tof(lam)) < half) lamOut = lam; else lamIn = lam;
    }
    for (let k = 0; k < BISECTIONS; k++) {
        const mid = (lamIn + lamOut) / 2;
        if (Tof(mid) >= half) lamIn = mid; else lamOut = mid;
    }
    return (lamIn + lamOut) / 2;
}

/**
 * Centre of the tilted band: the midpoint of its two half-maximum crossings.
 * Predicting it from the cavity indices instead does not work; a stiffness-
 * weighted effective index lands 0.1 nm long on every design tested, which
 * puts the edge target point on the roll-off.
 *
 * When the scan's highest sample is below TORN the band has not survived the
 * tilt and that sample is the centre. Every passband point of such a design
 * already sits far below its level, so the choice hardly moves its score.
 *
 * The centre is held to the scan's own range at the bottom and to λ₀ at the
 * top. A design whose band never falls to half maximum gives `halfMaxCrossing`
 * no crossing to return, and the limit it returns instead can put the midpoint
 * outside the window `tiltWindowLow` promises a caller; tilting only ever moves
 * a band to shorter wavelengths, so the upper bound is λ₀. Without the clamp
 * such a design is scored against materials read off the end of a sampled grid
 * rather than at the wavelengths asked for.
 *
 * @param {Array} tilted   layers from `tiltedLayers`
 * @param {object} target  from buildFilterTarget, with tiltDeg above zero
 * @returns {{ centre:number, peak:number }}  centre in nm, peak embedded T
 */
export function tiltedBandCentre(tilted, target, nSub) {
    const { lambda0_nm, halfPass, halfStop, tiltDeg } = target;
    const Tof = (lam) => embeddedT(tilted, lam, nSub);
    const [lo, hi] = centreBracket(tilted, lambda0_nm, tiltDeg);
    const step = SCAN_STEP * halfPass, pad = SCAN_PAD * halfPass;
    const xs = [], ts = [];
    for (let lam = lo - pad; lam <= hi + pad + 1e-9; lam += step) { xs.push(lam); ts.push(Tof(lam)); }
    let iPeak = 0;
    for (let i = 1; i < xs.length; i++) if (ts[i] > ts[iPeak]) iPeak = i;
    const peak = ts[iPeak];
    if (peak < TORN) return { centre: xs[iPeak], peak };
    const scan = { xs, ts, step, Tof }, half = peak / 2, span = targetSpan(halfPass, halfStop);
    const left = halfMaxCrossing(scan, iPeak, -1, half, lo - span);
    const right = halfMaxCrossing(scan, iPeak, 1, half, hi + span);
    const centre = Math.min(lambda0_nm, Math.max(lo - pad, (left + right) / 2));
    return { centre, peak };
}
