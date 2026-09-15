import { spectrumT } from './spectrum.js';
import { nReal } from './nReal.js';
import { targetSpan } from './filterTarget.js';

/**
 * Where a filter's passband sits when the filter is used at an angle, and the
 * conversion between the angle it is used at and the angle inside the embedded
 * design.
 *
 * Tilting a narrowband filter moves its passband to shorter wavelengths: every
 * layer's phase thickness carries a factor cos θ_j, so the layers look thinner
 * (Macleod, Thin-Film Optical Filters 5th ed., §8.2.5 "Simple Tilts in
 * Collimated Light", p. 276). For an ideal cavity of effective index n* the peak
 * moves to λ_ref·cos θ*, with θ* = arcsin(sin θ₀/n*) (p. 310).
 *
 * Nothing here estimates that shift. The book's Eq. 8.30 estimate needs an
 * effective index, which a design of several cavities of different orders and
 * materials does not hand over, and it is quoted as good "up to 20° or 30°, or
 * even higher" (p. 310), not at the angles a filter in a beamsplitter mount
 * works at. The band is found instead by scanning the design itself at the angle
 * asked for, which keeps two effects a cos θ thickness model drops: the s/p
 * admittance split that appears once the tilt is no longer small (§9.1), and the
 * splitting of a bandpass filter's own width between the two planes (§9.5.1).
 *
 * Angles travel as the free-space invariant κ = n₀·sin θ₀ (Eq. 9.5), the one
 * quantity every medium in the stack shares, so a band can be bracketed without
 * knowing which medium its angle was quoted in.
 */

/**
 * cos of the propagation angle in a medium of index n, for an invariant κ.
 * Zero once κ reaches n: past that there is no propagating wave in the medium
 * and callers have to treat the geometry as having no band rather than divide
 * by what comes back.
 *
 * The real-index form of `snellCosTheta` in physics/thinFilmMath.js, which is
 * the authority on this convention; the filter engine only ever sees lossless
 * coating materials, and a complex square root per layer per wavelength is not
 * worth paying in a scan the merit runs millions of times.
 */
export function cosInside(kappa, n) {
    const s = kappa / n;
    return Math.sqrt(Math.max(0, 1 - s * s));
}

/** Free-space invariant κ = n₀·sin θ₀ of an angle in a medium of index n₀. */
export function invariantOf(aoiDeg, n0) {
    return n0 * Math.sin(aoiDeg * Math.PI / 180);
}

/**
 * Angle inside the embedded design, in degrees, for light reaching the finished
 * filter at `aoiDeg` in its incident medium.
 *
 * Steps 1 to 5 evaluate the filter with the substrate on both sides, so the
 * angle they have to use is the one the invariant gives in the substrate: 45° in
 * air over BK7 is 27.8° there. Feeding an embedded evaluation the air angle
 * instead designs the filter for an angle nobody will use it at.
 *
 * Read at λ₀ and held there, so a dispersive substrate is evaluated at one angle
 * across the target window rather than at its own angle per wavelength. For the
 * builtin BK7 at 45° that window's ends differ by 0.02°, which stretches the
 * scored shape by 174 ppm, a tenth of a nanometre at 600 nm. It does not reach
 * the delivered design: the reference the quarter waves go down at is solved on
 * the finished filter in its own medium (designReference.js), where every
 * wavelength gets its own angle from the TMM.
 */
export function embeddedAngleDeg({ aoiDeg, nInc, nSub, lambda0_nm }) {
    if (!(aoiDeg > 0)) return 0;
    const kappa = invariantOf(aoiDeg, nReal(nInc, lambda0_nm));
    return Math.asin(Math.min(1, kappa / nReal(nSub, lambda0_nm))) * 180 / Math.PI;
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
 * Transmittance below which the band counts as torn. A passband that survives
 * reaches 100 % embedded, and close to it through a coat, so its half maximum is
 * about 50 %; a scan whose highest sample is below that has no half-maximum
 * crossings to centre on.
 */
const TORN = 0.5;

/**
 * Interval the tilted cavity resonances lie in. A cavity of effective index
 * n* moves to λ_ref·cos θ*, and every n* lies between n_L and n_H: Eq. 8.35 and
 * 8.37 start from the first-order values of Pidgeon and Smith (Eq. 8.36 and
 * 8.38), which lie between the two, and tend to n_H and n_L as the order
 * grows. The layer indices at the reference are read off the layers themselves.
 */
function centreBracket(layers, reference_nm, kappa) {
    let nLo = Infinity, nHi = 0;
    for (const L of layers) { nLo = Math.min(nLo, L.n0); nHi = Math.max(nHi, L.n0); }
    return [reference_nm * cosInside(kappa, nLo), reference_nm * cosInside(kappa, nHi)];
}

/**
 * Lowest wavelength an evaluation at invariant κ can ask a material for: the
 * bottom of the centring scan less the reach of the target points. A caller that
 * samples materials onto a grid has to cover it.
 *
 * Once κ reaches the lowest index in the stack there is no propagating wave in
 * that material, `bandCentreAtAngle` stops before it scans, and the only
 * wavelengths asked for are the target's own. Without that case the formula
 * returns a negative wavelength and a caller sampling from it covers thousands
 * of points nothing will ever read.
 */
export function angleWindowLow({ lambda0_nm, kappa, nLow, halfPass, halfStop }) {
    const span = targetSpan(halfPass, halfStop);
    const cos = cosInside(kappa, nLow);
    return cos > 0 ? lambda0_nm * cos - SCAN_PAD * halfPass - span : lambda0_nm - span;
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
 * Centre of the passband as the design is used at `aoiDeg`: the midpoint of its
 * two half-maximum crossings. Predicting it from the cavity indices instead does
 * not work; a stiffness-weighted effective index lands 0.1 nm long on every
 * design tested, which puts the edge target point on the roll-off.
 *
 * When the scan's highest sample is below TORN the band has not survived the
 * tilt and that sample is the centre. Every passband point of such a design
 * already sits far below its level, so the choice hardly moves its score.
 *
 * The centre is held to the scan's own range at the bottom and to the reference
 * at the top. A design whose band never falls to half maximum gives
 * `halfMaxCrossing` no crossing to return, and the limit it returns instead can
 * put the midpoint outside the window `angleWindowLow` promises a caller;
 * tilting only ever moves a band to shorter wavelengths, so the upper bound is
 * the wavelength the quarter waves were laid at. Without the clamp such a design
 * is scored against materials read off the end of a sampled grid rather than at
 * the wavelengths asked for.
 *
 * @param {object} p
 * @param {Array}    p.layers  engine layers
 * @param {object}   p.target  from buildFilterTarget
 * @param {function} p.nSub    substrate index fn
 * @param {number}   p.aoiDeg  angle in the incident medium, degrees
 * @param {string}   p.pol     's' | 'p' | 'avg'
 * @param {function} [p.nInc]  incident index fn; defaults to nSub, the embedded
 *   case steps 1 to 5 design in, where `aoiDeg` is then the angle inside the
 *   substrate. Pass the real incident medium to find the band of a finished,
 *   coated filter, where `aoiDeg` is the angle it is used at.
 * @param {number}   [p.reference_nm]  wavelength the quarter waves were laid at,
 *   which the band sits below; defaults to the target's λ₀
 * @returns {{ centre:number, peak:number }}  centre in nm, peak T
 */
export function bandCentreAtAngle({
    layers, target, nSub, aoiDeg, pol, nInc = nSub, reference_nm = target.lambda0_nm,
}) {
    const { halfPass, halfStop } = target;
    const kappa = invariantOf(aoiDeg, nReal(nInc, target.lambda0_nm));
    const Tof = (lam) => spectrumT(layers, lam, [nInc, nSub], aoiDeg, pol);
    const [lo, hi] = centreBracket(layers, reference_nm, kappa);
    // κ at or past the lowest index in the stack: that material carries no
    // propagating wave at this angle, so the filter passes nothing and there is
    // no band to centre on. Scanning the collapsed bracket would walk the whole
    // spectrum down to zero for an answer already known.
    if (!(lo > 0)) return { centre: reference_nm, peak: 0 };
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
    const centre = Math.min(reference_nm, Math.max(lo - pad, (left + right) / 2));
    return { centre, peak };
}
