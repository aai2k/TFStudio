/**
 * The monitor signal of one growing layer, and what it costs to stop on it.
 *
 * Everything here works on one layer of one witness chip. `ctx` bundles the
 * fixed optical situation while that layer grows:
 *
 *   { lam, curMat, belowMats, belowThicks, sys }
 *
 * where `belowMats` / `belowThicks` are the layers already on the chip, written
 * outermost first, and `sys` is the optical system singleSignal expects
 * ({ theta, pol, char, incMat, subMat, subThickMM }). The growing layer always
 * leads the stack: in a chamber it is the one facing the incident medium.
 *
 * Termination error is the number the worksheet is built around. A monitor
 * reading wrong by dS stops the layer at the wrong thickness, by an amount that
 * depends on the rule the layer is cut with:
 *
 *   level    the signal is followed to a computed level, so the thickness error
 *            is the signal error divided by the slope there: Dd = dS / |dS/dd|.
 *   turning  the reversal itself is detected, so the signal has to move dS away
 *            from the extremum before the turn is seen. Near an extremum
 *            S ~ S_ext + 1/2 S'' (d - d_ext)^2, giving Dd = sqrt(2 dS / |S''|).
 *
 * Reference: H. A. Macleod, Thin-Film Optical Filters, 5th ed., Ch. 12.
 */

import { singleSignal } from './signalModel.js';

// Enough of the layer's continuation to bracket the next turning point. Turning
// points of a lossless layer fall one quarter wave apart; the margin covers the
// shift absorption and oblique incidence add.
const CONTINUATION_QW = 1.35;
const GRID = { samplesPerQW: 50, maxSamples: 800 };
const COARSE_GRID = { samplesPerQW: 16, maxSamples: 200 };

/** Monitor signal with the growing layer at thickness `d`. */
export function signalAt(ctx, d) {
    return singleSignal(ctx.lam, [ctx.curMat, ...ctx.belowMats], [d, ...ctx.belowThicks], ctx.sys);
}

/**
 * The layer's signal from bare chip to well past its cut, so the turning point
 * after the cut is on the curve.
 *
 * @param {object} ctx    the layer's optical situation
 * @param {number} dCut   thickness the layer is stopped at, nm
 * @param {number} dQW    quarter wave in this layer at the monitor wavelength, nm
 * @param {boolean} coarse  sample sparsely, for a wavelength search
 */
export function sampleLayerCurve(ctx, dCut, dQW, coarse = false) {
    const dMax = dCut + CONTINUATION_QW * dQW;
    const { samplesPerQW, maxSamples } = coarse ? COARSE_GRID : GRID;
    const count = Math.min(maxSamples, Math.max(24, Math.ceil((dMax / dQW) * samplesPerQW) + 1));
    const h = dMax / (count - 1);
    const d = new Float64Array(count);
    const s = new Float64Array(count);
    for (let k = 0; k < count; k++) {
        d[k] = k * h;
        s[k] = signalAt(ctx, d[k]);
    }
    return { d, s, h, dMax };
}

// Sub-sample position, value and second derivative of an extremum, from the
// parabola through the sample and its two neighbours.
function refineExtremum({ dAt, h, a, b, c, isMax }) {
    const curve2 = a - 2 * b + c;
    const slope1 = (c - a) / 2;
    const shift = curve2 !== 0 ? -slope1 / curve2 : 0;
    return {
        d: dAt + shift * h,
        s: b + slope1 * shift + 0.5 * curve2 * shift * shift,
        isMax,
        curvature: curve2 / (h * h),
    };
}

/** Local extrema of a sampled curve, each refined off the sampling grid. */
export function findExtrema({ d, s, h }) {
    const out = [];
    for (let k = 1; k < s.length - 1; k++) {
        const a = s[k - 1], b = s[k], c = s[k + 1];
        const isMax = b >= a && b >= c && (b > a || b > c);
        const isMin = b <= a && b <= c && (b < a || b < c);
        if (isMax || isMin) out.push(refineExtremum({ dAt: d[k], h, a, b, c, isMax }));
    }
    return out;
}

/** dS/dd at the cut, by central difference on the exact signal. */
export function slopeAtCut(ctx, dCut) {
    if (!(dCut > 0)) return 0;
    const eps = Math.max(0.02, 0.002 * dCut);
    return (signalAt(ctx, dCut + eps) - signalAt(ctx, Math.max(0, dCut - eps))) / (2 * eps);
}

/** The extremum a turning-point cut is made on: the one nearest the cut. */
export function nearestExtremum(extrema, d) {
    let best = null;
    for (const e of extrema) {
        if (!best || Math.abs(e.d - d) < Math.abs(best.d - d)) best = e;
    }
    return best;
}

/**
 * Thickness error left by a monitor reading wrong by `signalError`, in nm.
 * A layer cut on time has no optical feedback and no optical error to report.
 */
export function terminationError({ strategy, signalError, slope, cutExtremum }) {
    if (strategy === 'time') return null;
    if (strategy === 'turning') {
        const curvature = Math.abs(cutExtremum?.curvature ?? 0);
        return curvature > 0 ? Math.sqrt(2 * signalError / curvature) : Infinity;
    }
    const steepness = Math.abs(slope);
    return steepness > 0 ? signalError / steepness : Infinity;
}
