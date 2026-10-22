// A design's spectra, computed by the code the Optical Evaluation window runs
// (the analysis worker's 'opticalSpectrum'), and a short summary of them.

import { dispatchAnalysisEvaluation } from '../utils/workers/analysisEvaluationWorker.js';
import { embedDesignMaterials, withHerpinRecords } from '../utils/materials/designMaterials.js';
import { designRangeCoverage } from '../utils/materials/materialRange.js';
import { resolveEvalMode, makeConeSpec, coneIsActive } from '../utils/physics/optimizer.js';
import { requireResolved } from './materials.js';
import { warnWithoutKernel } from './environment.js';
import { checkOptions, checkRange, isAngle } from './check.js';

// R, T and A for unpolarized light, then for s and p.
const QUANTITIES = ['R', 'T', 'A', 'Rs', 'Rp', 'Ts', 'Tp', 'As', 'Ap'];
const isBand = b => !!b && Number.isFinite(b.from) && Number.isFinite(b.to) && b.to >= b.from;

/**
 * R, T and A of `design`, for unpolarized light and for s and p (Rs, Rp, Ts,
 * Tp, As, Ap), from `from` to `to` nm in steps of `step`, at each angle of
 * incidence in `angles` (degrees in the incident medium), scored the way the
 * design's surface mode says (evalMode: 'front', 'back' or 'total'). Resolves
 * to { evalMode, lambda, angles: { [angle]: { R, T, A, Rs, Rp, Ts, Tp, As,
 * Ap } }, outOfRange }, fractions of 1. A design under a cone of incidence is
 * averaged over its cone, as the window does. outOfRange lists the materials
 * whose data stop inside [from, to] ({ id, name, rangeNm, heldFlat }), where
 * the window shows its material range notice: outside rangeNm their n and k
 * are held at the last value (heldFlat) or extrapolated.
 */
export function spectrum(design, options) {
    const { from, to, step = 1, angles = [0] } = checkOptions('spectrum', options, ['from', 'to', 'step', 'angles']);
    if (!Array.isArray(angles) || !angles.length || !angles.every(isAngle)) {
        throw new Error('spectrum: angles is a list of angles of incidence in degrees, 0 <= angle < 90');
    }
    checkRange('spectrum', { from, to, step }, angles.length);
    requireResolved(design);
    warnWithoutKernel();
    const shown = withHerpinRecords(design);
    const evalMode = resolveEvalMode(shown);
    const coned = coneIsActive(makeConeSpec(shown.cone || {}));
    const data = dispatchAnalysisEvaluation('opticalSpectrum', {
        design: coned ? embedDesignMaterials(shown) : shown,
        params: { lambdaStart: from, lambdaEnd: to, lambdaStep: step, thetas: angles },
        evalMode,
    });
    const byAngle = {};
    for (const series of data.series) {
        byAngle[series.theta] = Object.fromEntries(QUANTITIES.map(q => [q, Array.from(series[q])]));
    }
    return { evalMode, lambda: Array.from(data.lambda), angles: byAngle, outOfRange: designRangeCoverage(shown, [from, to]).offenders };
}

// The mean, lowest and highest of `values` over the samples where `inBand`
// holds, with the wavelength of each extreme.
function bandStats(lambda, values, inBand) {
    let sum = 0, count = 0, lo = Infinity, hi = -Infinity, atLo = null, atHi = null;
    values.forEach((v, i) => {
        if (!inBand(lambda[i])) return;
        sum += v; count++;
        if (v < lo) { lo = v; atLo = lambda[i]; }
        if (v > hi) { hi = v; atHi = lambda[i]; }
    });
    return count ? { mean: sum / count, min: lo, minAt: atLo, max: hi, maxAt: atHi } : null;
}

/**
 * A short account of a spectrum (from spectrum()): for each angle and
 * quantity, the mean, lowest and highest value with where they fall, over the
 * whole range and over each band [from, to] in nm given in `bands`.
 */
export function summarize(result, options) {
    const { bands = [] } = checkOptions('summarize', options, ['bands']);
    if (!Array.isArray(bands) || !bands.every(isBand)) {
        throw new Error('summarize: bands is a list of { from, to } in nm, from <= to');
    }
    const ranges = [{ from: result.lambda[0], to: result.lambda[result.lambda.length - 1] }, ...bands];
    const out = {};
    for (const [angle, series] of Object.entries(result.angles)) {
        out[angle] = ranges.map(({ from, to }) => ({
            from, to,
            ...Object.fromEntries(QUANTITIES.map(q => [q, bandStats(result.lambda, series[q], l => l >= from && l <= to)])),
        }));
    }
    return out;
}
