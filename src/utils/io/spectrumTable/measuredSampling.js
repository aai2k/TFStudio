import { createPchipInterpolator } from '../../materials/pchip.js';
import { measuredCurveData } from './measuredCurve.js';

export const MEASURED_GRID_MODES = ['measured', 'thinned', 'uniform'];
export const MAX_MEASURED_TARGET_POINTS = 20000;

/** Median positive spacing of a normalized measured curve, in nm. */
export function measuredCurveSpacing(curve) {
    const { x } = measuredCurveData(curve);
    const differences = [];
    for (let index = 1; index < x.length; index++) {
        const difference = x[index] - x[index - 1];
        if (Number.isFinite(difference) && difference > 0) differences.push(difference);
    }
    if (!differences.length) return null;
    differences.sort((a, b) => a - b);
    const middle = Math.floor(differences.length / 2);
    return differences.length % 2
        ? differences[middle]
        : (differences[middle - 1] + differences[middle]) * 0.5;
}

function boundedRange(data, options) {
    const dataMin = data.x[0];
    const dataMax = data.x[data.x.length - 1];
    const requestedMin = Number.isFinite(options.rangeMin) ? options.rangeMin : dataMin;
    const requestedMax = Number.isFinite(options.rangeMax) ? options.rangeMax : dataMax;
    let min = Math.max(dataMin, Math.min(requestedMin, requestedMax));
    let max = Math.min(dataMax, Math.max(requestedMin, requestedMax));
    if (Array.isArray(options.safeRange) && options.safeRange.length >= 2) {
        min = Math.max(min, Math.min(options.safeRange[0], options.safeRange[1]));
        max = Math.min(max, Math.max(options.safeRange[0], options.safeRange[1]));
    }
    return {
        min,
        max,
        clipped: min > Math.min(requestedMin, requestedMax) || max < Math.max(requestedMin, requestedMax),
        requested: [Math.min(requestedMin, requestedMax), Math.max(requestedMin, requestedMax)],
    };
}

function measuredPairsInRange(data, min, max) {
    const pairs = [];
    for (let index = 0; index < data.x.length; index++) {
        if (data.x[index] < min || data.x[index] > max) continue;
        pairs.push([data.x[index], data.y[index]]);
    }
    return pairs;
}

function thinPairs(pairs, every) {
    const stride = Math.max(1, Math.round(every) || 1);
    if (stride === 1 || pairs.length <= 2) return pairs;
    const output = pairs.filter((_pair, index) => index % stride === 0);
    const last = pairs[pairs.length - 1];
    if (output[output.length - 1] !== last) output.push(last);
    return output;
}

// Returns { pairs } or, for a step that cannot produce a usable grid,
// { error }. A rejected step is something the user typed, so it is reported
// through the dialog rather than raised: the caller runs during render.
function uniformPairs(data, min, max, step) {
    const spacing = Number(step);
    if (!Number.isFinite(spacing) || spacing <= 0) return { error: 'step' };
    if (!(max >= min)) return { pairs: [] };
    const count = Math.floor((max - min) / spacing + 1e-10) + 1;
    if (count > MAX_MEASURED_TARGET_POINTS) return { error: 'points' };
    const interpolate = createPchipInterpolator(data.x.map((x, index) => [x, data.y[index]]));
    if (!interpolate) return { pairs: [] };
    const pairs = new Array(Math.max(1, count));
    for (let index = 0; index < pairs.length; index++) {
        const wavelength = min + index * spacing;
        pairs[index] = [wavelength, interpolate(wavelength)];
    }
    return { pairs };
}

/**
 * Snapshot a measured curve on one of the three supported fitting grids.
 * `safeRange`, when present, is the common declared material range and clips
 * the requested span before any sampling or interpolation.
 */
export function sampleMeasuredCurve(curve, options = {}) {
    const data = measuredCurveData(curve);
    if (!data.x.length) {
        return {
            lambdas: [], targets: [], sourceCount: 0, spacingNm: null, error: null,
            maxPoints: MAX_MEASURED_TARGET_POINTS,
            range: null, requestedRange: null, clipped: false, stepTooFine: false,
        };
    }
    const mode = MEASURED_GRID_MODES.includes(options.mode) ? options.mode : 'measured';
    const bounds = boundedRange(data, options);
    if (bounds.max < bounds.min) {
        return {
            lambdas: [], targets: [], sourceCount: data.x.length,
            spacingNm: measuredCurveSpacing(curve), range: null, error: null,
            maxPoints: MAX_MEASURED_TARGET_POINTS,
            requestedRange: bounds.requested, clipped: true, stepTooFine: false,
        };
    }
    let pairs = [];
    let error = null;
    if (mode === 'uniform') {
        const uniform = uniformPairs(data, bounds.min, bounds.max, options.stepNm);
        if (uniform.error) error = uniform.error;
        else pairs = uniform.pairs;
    } else {
        pairs = measuredPairsInRange(data, bounds.min, bounds.max);
        if (mode === 'thinned') pairs = thinPairs(pairs, options.thinEvery);
    }
    const spacingNm = measuredCurveSpacing(curve);
    return {
        lambdas: pairs.map(pair => pair[0]),
        targets: pairs.map(pair => pair[1]),
        sourceCount: data.x.length,
        spacingNm,
        error,
        maxPoints: MAX_MEASURED_TARGET_POINTS,
        range: pairs.length ? [pairs[0][0], pairs[pairs.length - 1][0]] : null,
        requestedRange: bounds.requested,
        clipped: bounds.clipped,
        stepTooFine: mode === 'uniform' && spacingNm != null && options.stepNm < spacingNm - 1e-9,
    };
}
