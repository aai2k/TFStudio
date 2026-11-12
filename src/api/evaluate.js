// A design's spectra, computed by the code the Optical Evaluation window runs
// (the analysis worker's 'opticalSpectrum'), and a short summary of them.

import { dispatchAnalysisEvaluation } from '../utils/workers/analysisEvaluationWorker.js';
import { embedDesignMaterials, withHerpinRecords } from '../utils/materials/designMaterials.js';
import { designRangeCoverage } from '../utils/materials/materialRange.js';
import { resolveEvalMode, makeConeSpec, coneIsActive } from '../utils/physics/optimizer.js';
import { requireResolved } from './materials.js';
import { requireKernel } from './environment.js';
import { inEnvironments } from './designEnvironments.js';
import { checkOptions, checkRange, isAngle } from './check.js';

// R, T and A for unpolarized light, then for s and p.
const QUANTITIES = ['R', 'T', 'A', 'Rs', 'Rp', 'Ts', 'Tp', 'As', 'Ap'];
const isBand = b => !!b && Number.isFinite(b.from) && Number.isFinite(b.to) && b.to >= b.from;

// The spectrum of one design, as spectrum() gives it: the analysis worker's
// 'opticalSpectrum', as the window runs it; outOfRange is what the window's
// material range notice lists.
function spectrumOf(design, { from, to, step, angles }) {
    requireResolved(design);
    requireKernel();
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

/**
 * R, T and A of a design over a range of wavelengths, for unpolarized light
 * and for s and p, as the [Optical Evaluation](/analysis/optical-evaluation/)
 * window computes them. The sides scored follow the design's
 * [evaluation mode](/design/evaluation-modes/), and a design under a cone of
 * incidence is averaged over its cone. A design with more than one
 * [environment](/design/environments/) is computed in environment 1, its own
 * media and substrate, unless `env` names another.
 *
 * @param design The design.
 * @param options
 * @param options.from The first wavelength, nm.
 * @param options.to The last wavelength, nm, above `from`.
 * @param [options.step=1] The wavelength step, nm.
 * @param [options.angles=[0]] The angles of incidence, degrees in the incident medium, each from 0 up to but not including 90.
 * @param [options.env] The environment computed, by its number from 1 or its id, whether it is on or off; or `'all'` for one spectrum per environment that is on, environment 1 when none is. Without it, environment 1.
 * @returns The spectrum; with `env: 'all'`, `{ environments }`, one entry per environment, each this spectrum with the environment's `number`, `id` and `name`.
 * @property evalMode How the design was scored: `'front'`, `'back'` or `'total'`.
 * @property lambda The wavelengths, nm.
 * @property angles For each angle asked, by its value: the lists `R`, `T` and `A` for unpolarized light and `Rs`, `Rp`, `Ts`, `Tp`, `As` and `Ap` for s and p, one value per wavelength, as fractions of 1.
 * @property outOfRange The materials whose data stop inside the range, each `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws a design that names a material that resolves to nothing
 * @throws more points, wavelengths times angles, than one call computes; the refusal names the limit
 * @throws an environment the design does not have, naming the numbers and ids it has
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^5 H' });
 * const s = tf.spectrum(design, { from: 400, to: 700, step: 10, angles: [0, 45] });
 * console.log(s.lambda.length, 'wavelengths');
 * console.log('At 400 nm, 45 degrees: Rs', s.angles[45].Rs[0], 'Rp', s.angles[45].Rp[0]);
 * const wet = tf.addEnvironment(design, { name: 'Under water', incidentMedium: 'H2O' });
 * for (const env of tf.spectrum(wet, { from: 400, to: 700, step: 10, env: 'all' }).environments) console.log(env.number, env.name, 'R at 400 nm', env.angles[0].R[0]);
 */
export function spectrum(design, options) {
    const { from, to, step = 1, angles = [0], env } = checkOptions('spectrum', options, ['from', 'to', 'step', 'angles', 'env']);
    if (!Array.isArray(angles) || !angles.length || !angles.every(isAngle)) {
        throw new Error('spectrum: angles is a list of angles of incidence in degrees, 0 <= angle < 90');
    }
    checkRange('spectrum', { from, to, step }, angles.length);
    return inEnvironments('spectrum', design, env, one => spectrumOf(one, { from, to, step, angles }));
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
 * The mean, lowest and highest value of each quantity of a spectrum, with the
 * wavelength of each extreme, over the whole range and over each band given.
 *
 * @param result A spectrum, as `spectrum` returns it.
 * @param [options]
 * @param [options.bands=[]] The bands, each `{ from, to }` in nm.
 * @returns For each angle of the spectrum, by its value, a list: the whole range first, then each band in the order given, each with these fields.
 * @property from The band's first wavelength, nm.
 * @property to The band's last wavelength, nm.
 * @property R For `R`, and likewise for `T`, `A`, `Rs`, `Rp`, `Ts`, `Tp`, `As` and `Ap`: `{ mean, min, minAt, max, maxAt }`, with `minAt` and `maxAt` in nm; null when no wavelength of the spectrum falls in the band.
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^5 H' });
 * const s = tf.spectrum(design, { from: 400, to: 700, step: 5 });
 * const [whole, band] = tf.summarize(s, { bands: [{ from: 450, to: 650 }] })[0];
 * console.log('Mean R from 400 to 700 nm:', whole.R.mean);
 * console.log('Highest R from 450 to 650 nm:', band.R.max, 'at', band.R.maxAt, 'nm');
 */
export function summarize(result, options) {
    if (result?.environments) throw new Error("summarize: result is one spectrum; summarize each entry of a spectrum with env: 'all' apart");
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
