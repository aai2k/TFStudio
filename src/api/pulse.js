// A pulse's passage through a design, in time and in its spectrum, as the
// Pulse Analysis window computes it (pulseAnalysis/pulseModel.js), and the
// measured or typed spectrum the window keeps on the design, as its Load
// file… and Apply set it (usePulseAnalysis.js).

import path from 'node:path';
import mainPaths from '../main/paths.js';
import { computePulseAnalysis, pulseFromSettings, spectrumCentreField } from '../components/windows/analysis/pulseAnalysis/pulseModel.js';
import { emptyTable } from '../components/windows/dataExchange/curveEditor/curveTable.js';
import { applyProblem, pulseSpectrumFromTable } from '../components/windows/dataExchange/curveEditor/curveApply.js';
import { tableFromText } from '../components/windows/dataExchange/curveEditor/tableText.js';
import { sessionDefaults } from '../constants/analysisDefaults.js';
import { pulseProblem } from '../utils/physics/pulsePropagation.js';
import { withHerpinRecords } from '../utils/materials/designMaterials.js';
import { designRangeCoverage } from '../utils/materials/materialRange.js';
import { requireResolved } from './materials.js';
import { requireKernel } from './environment.js';
import { phaseSide } from './stackViews.js';
import { checkOptions, requireValue, refusal, isAngle, isPositive } from './check.js';

const { readTextAuto } = mainPaths;
const DEFAULTS = sessionDefaults('pulseAnalysis');
// The window's opening settings that its saved defaults do not hold
// (pulseAnalysis/sessionState.js): a super-Gaussian of order 2, no chirp of
// its own, one bounce, the spectrum drawn from the shape.
const OPENING = { order: 2, gdd: 0, tod: 0, passes: 1, source: 'model' };
const OPTIONS = ['source', 'shape', 'centre', 'duration', 'bandwidth', 'order', 'gdd', 'tod', 'side', 'response', 'pol', 'angle', 'passes'];

// The metrics by the API's names and the model's.
const METRICS = [
    ['flpFwhm', 'flpFwhmFs'], ['inputFwhm', 'inputFwhmFs'], ['outputFwhm', 'outputFwhmFs'], ['outputRms', 'outputRmsFs'],
    ['peakVsFlp', 'peakVsFlp'], ['transformLimitedRatio', 'transformLimitedRatio'], ['energyRatio', 'energyRatio'],
    ['delay', 'delayFs'], ['residualGdd', 'residualGddFs2'], ['residualTod', 'residualTodFs3'],
    ['inputBandwidth', 'inputBandwidthNm'], ['outputBandwidth', 'outputBandwidthNm'], ['timeBandwidth', 'outputTimeBandwidth'],
];

// Why the model gives no pulse, by the reason it returns.
const FAILED = {
    spectrumReachesZeroFrequency: () => 'the pulse is too short for its centre wavelength: part of its spectrum reaches zero frequency',
    responseUnavailable: detail => `the coating's response is not available: ${detail}`,
    noOutput: () => 'no light comes out: the part absorbs all of it, or at this angle reflects all of it inside',
};

// Why a pulse spectrum table cannot be applied, by applyProblem's name for it.
const NOT_APPLIED = {
    needTwoSpectrumRows: 'a spectrum needs at least two rows with a wavelength above zero and an intensity not below zero',
    noSpectrumLight: 'no row has an intensity above zero',
    phaseGaps: 'some rows have a phase and others none; give every row a phase, or none',
};

function checkPulseOptions(given) {
    const call = 'pulseAnalysis';
    requireValue(call, 'source', given.source, v => v === undefined || v === 'model' || v === 'design', "'model' or 'design'");
    requireValue(call, 'shape', given.shape, v => v === undefined || ['gaussian', 'sech2', 'superGaussian'].includes(v), "'gaussian', 'sech2' or 'superGaussian'");
    requireValue(call, 'centre', given.centre, v => v === undefined || isPositive(v), 'a wavelength in nm above 0');
    requireValue(call, 'duration', given.duration, v => v === undefined || isPositive(v), 'a duration in fs above 0');
    requireValue(call, 'bandwidth', given.bandwidth, v => v === undefined || isPositive(v), 'a spectral FWHM in nm above 0');
    requireValue(call, 'order', given.order, v => v === undefined || isPositive(v), 'a super-Gaussian order above 0');
    requireValue(call, 'gdd', given.gdd, v => v === undefined || Number.isFinite(v), 'a GDD in fs²');
    requireValue(call, 'tod', given.tod, v => v === undefined || Number.isFinite(v), 'a TOD in fs³');
    requireValue(call, 'response', given.response, v => v === undefined || v === 'R' || v === 'T', "'R' or 'T'");
    requireValue(call, 'pol', given.pol, v => v === undefined || ['avg', 's', 'p'].includes(v), "'avg', 's' or 'p'");
    requireValue(call, 'angle', given.angle, v => v === undefined || isAngle(v), 'an angle of incidence in degrees, 0 <= angle < 90');
    requireValue(call, 'passes', given.passes, v => v === undefined || (Number.isInteger(v) && v >= 1), 'a whole number of bounces, 1 or more');
}

// A spectrum curve of the model, which runs down in wavelength, as the API
// gives it, up in wavelength.
const spectrumCurve = ({ x, y }) => ({ wavelength: [...x].reverse(), values: [...y].reverse() });
const timeCurve = ({ x, y }) => ({ t: x, intensity: y });

/**
 * A pulse's passage through a design, in time and in its spectrum, as the
 * [Pulse Analysis](/analysis/pulse-analysis/) window computes it: the pulse is
 * reflected off or transmitted through one coated side, or through the whole
 * part, the front coating, one pass through the substrate and the back
 * coating, the first pulse to come out of it; `passes` bounces or passes in a
 * row. Its spectrum is a Gaussian, sech² or super-Gaussian about the centre
 * wavelength, or with `source: 'design'` the spectrum the design holds
 * (setPulseSpectrum), with the chirp of `gdd` and `tod` on top; with s and p
 * averaged, each is propagated on its own and their intensities averaged. The
 * design's cone of incidence is not used, as the window does not use it.
 * Without options, the window's opening settings, on the side the PR, GD, GDD
 * and TOD merit rows score: the back of a design coated on the back alone and
 * the front of any other. The window opens on the front unless only the back
 * holds layers, so with one side empty the two can differ; a side with no
 * layers gives its bare surface.
 *
 * The time curves hold the transform's samples from the first to the last
 * above 1e-4 of the Fourier-limited pulse's peak. The spectrum curves hold the
 * transform's samples where the input spectrum is above 1e-3 of its peak, or a
 * fresh evaluation at least 600 points across that band when the transform
 * has fewer. Past 4000 samples a curve keeps the lowest and highest of each
 * run of its own values in turn, so read each curve against its own t or
 * wavelengths. The metrics are computed on the full transform, so they are
 * the window's numbers.
 *
 * @param design The design.
 * @param [options]
 * @param [options.source='model'] `'model'`, the spectrum of `shape`, or `'design'`, the spectrum the design holds.
 * @param [options.shape='gaussian'] `'gaussian'` or `'sech2'`, a pulse of `duration`, or `'superGaussian'`, a spectrum of `bandwidth` and `order`.
 * @param [options.centre] The centre wavelength, nm, the carrier the chirp is taken about. Without it, 800 nm; with `source: 'design'`, the spectrum's centroid in frequency to the hundredth of a nanometre, as Apply sets it.
 * @param [options.duration=10] The intensity FWHM of the transform-limited pulse, fs, for `'gaussian'` and `'sech2'`.
 * @param [options.bandwidth=100] The intensity FWHM of the spectrum, nm, for `'superGaussian'`.
 * @param [options.order=2] The super-Gaussian's order, above 0; 2 is a Gaussian, and a higher order flattens the top of the spectrum.
 * @param [options.gdd=0] The input's own GDD, fs², about the centre wavelength.
 * @param [options.tod=0] The input's own TOD, fs³, about the centre wavelength.
 * @param [options.side] `'front'`, `'back'`, or with `response: 'T'` `'total'`, the whole part. Without it, the back of a design coated on the back alone and the front of any other.
 * @param [options.response='R'] `'R'`, the reflected pulse, or `'T'`, the transmitted one.
 * @param [options.pol='avg'] The polarization: `'avg'`, `'s'` or `'p'`.
 * @param [options.angle=0] The angle of incidence, degrees in the medium light comes from, 0 up to but not including 90.
 * @param [options.passes=1] The bounces off the coating, or passes through it, a whole number.
 * @returns The pulse.
 * @property mode The sides computed: `'front'`, `'back'` or `'total'`.
 * @property response `'R'` or `'T'`.
 * @property pol The polarization.
 * @property angle The angle of incidence, degrees.
 * @property passes The bounces or passes.
 * @property source `'model'` or `'design'`.
 * @property centre The centre wavelength, nm.
 * @property converged `false` when the time window reached its largest size before the output fitted inside it, so part of the output may wrap round from one end to the other and the curves and metrics are not reliable; `true` otherwise.
 * @property chirped Whether the input's own chirp changes its shape anywhere by more than 1e-4 of the Fourier-limited peak; the window's table lists the input's FWHM only then.
 * @property metrics The window's Results table: `flpFwhm`, `inputFwhm` and `outputFwhm`, the intensity FWHM of the Fourier-limited pulse, the input and the output, fs; `outputRms`, the output's RMS width, fs; `peakVsFlp`, the output's peak over the Fourier-limited pulse's, and `transformLimitedRatio`, over the peak the output's own spectrum would reach with a flat phase, fractions of 1; `energyRatio`, the energy out over the energy in; `delay`, the output's delay after the input, fs; `residualGdd` and `residualTod`, the output's GDD, fs², and TOD, fs³, averaged over its spectrum; `inputBandwidth` and `outputBandwidth`, the spectral intensity FWHM, nm; `timeBandwidth`, the output's time-bandwidth product.
 * @property time The time curves, `flp`, `input` and `output`, each `{ t, intensity }`: t in fs, the intensity on the scale where the Fourier-limited pulse peaks at 1. The output is at its absolute delay; the window's Delay removed view moves it back by `metrics.delay`.
 * @property spectrum The spectrum curves, each `{ wavelength, values }`, wavelengths in nm rising: `input` and `output`, the spectral intensity on the scale where the input peaks at 1; `coatingGdd`, the response's GDD times the passes, fs², the mean of s and p with `pol: 'avg'`; `compensatingGdd`, the GDD that undoes the input's own chirp, fs². `band` is `[low, high]`, nm, the band the curves cover.
 * @property echoDelay With `side: 'total'`, the time from this pulse to the first echo reflected inside the substrate, fs, the substrate's group delay there and back at the centre wavelength; `null` on one side.
 * @property outOfRange The materials of the sides computed whose data stop inside `spectrum.band`, each `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws an option it does not take or a value an option cannot take, `'total'` with `response: 'R'`, or `source: 'design'` on a design that holds no spectrum with light in it
 * @throws a design that names a material that resolves to nothing, a pulse too short for its centre wavelength, a response that cannot be computed across the spectrum, or no light out of the part, all of it absorbed or reflected inside
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^8 H' });
 * const p = tf.pulseAnalysis(design, { centre: 550, duration: 20 });
 * console.log('output FWHM', p.metrics.outputFwhm.toFixed(2), 'fs, peak', (100 * p.metrics.peakVsFlp).toFixed(1), '% of the Fourier-limited pulse');
 */
export function pulseAnalysis(design, options) {
    const given = checkOptions('pulseAnalysis', options, OPTIONS);
    checkPulseOptions(given);
    const {
        source = OPENING.source, shape = DEFAULTS.shape, duration = DEFAULTS.duration, bandwidth = DEFAULTS.bandwidth,
        order = OPENING.order, gdd = OPENING.gdd, tod = OPENING.tod, response = DEFAULTS.target, pol = DEFAULTS.pol,
        angle = DEFAULTS.theta, passes = OPENING.passes,
    } = given;
    const mode = phaseSide('pulseAnalysis', design, given.side, response);
    const spectrum = design.pulseSpectrum ?? null;
    const centroid = source === 'design' ? spectrumCentreField(spectrum) : NaN;
    const centre = given.centre ?? (centroid > 0 ? centroid : DEFAULTS.centerWavelength);
    const pulse = pulseFromSettings({
        source: source === 'design' ? 'file' : 'model', shape, centerWavelength: centre, duration, bandwidth, order, gdd, tod, spectrum,
    });
    if (pulseProblem(pulse) === 'table') {
        throw refusal('noPulseSpectrum', { call: 'pulseAnalysis' },
            "pulseAnalysis: the design holds no pulse spectrum with light in it; set one with setPulseSpectrum, or take source 'model'");
    }
    requireResolved(design);
    requireKernel();
    const shown = withHerpinRecords(design);
    const result = computePulseAnalysis(shown, {
        pulse, side: mode === 'total' ? 'whole' : mode, target: response, polarization: pol, thetaDeg: angle, passes,
    });
    if (!result.valid) throw new Error(`pulseAnalysis: ${FAILED[result.reason](result.detail)}`);
    const band = result.spectrum.bandNm;
    return {
        mode, response, pol, angle, passes, source, centre,
        converged: result.converged, chirped: result.chirped,
        metrics: Object.fromEntries(METRICS.map(([name, key]) => [name, result.metrics[key]])),
        time: { flp: timeCurve(result.time.flp), input: timeCurve(result.time.input), output: timeCurve(result.time.output) },
        spectrum: {
            input: spectrumCurve(result.spectrum.input), output: spectrumCurve(result.spectrum.output),
            coatingGdd: spectrumCurve(result.spectrum.coatingGddFs2), compensatingGdd: spectrumCurve(result.spectrum.compensatingGddFs2),
            band,
        },
        echoDelay: result.echoDelayFs,
        outOfRange: band ? designRangeCoverage(shown, band, mode).offenders : [],
    };
}

/**
 * What the window's Results table reads of `pulse`, a pulseAnalysis answer:
 * the metrics by the model's names, and whether the input is chirped.
 */
export function windowMetrics(pulse) {
    return { chirped: pulse.chirped, metrics: Object.fromEntries(METRICS.map(([name, key]) => [key, pulse.metrics[name]])) };
}

// The editor table a file or rows give, as Load file… reads a file into the
// curve editor and as rows are typed into it.
function spectrumTableOf(fileOrRows) {
    if (typeof fileOrRows === 'string') {
        let text;
        try { text = readTextAuto(fileOrRows); } catch (err) { throw new Error(`setPulseSpectrum: ${fileOrRows}: ${err.message}`); }
        const read = tableFromText(text, emptyTable('pulse'), path.basename(fileOrRows));
        if (read.error) throw new Error(`setPulseSpectrum: ${fileOrRows} holds no wavelength and intensity columns`);
        return read.table;
    }
    return { ...emptyTable('pulse'), rows: fileOrRows.map(([wavelength, intensity, phase = NaN]) => [wavelength, intensity, phase]) };
}

/**
 * Sets the spectrum a design holds for [Pulse Analysis](/analysis/pulse-analysis/),
 * as the window's Load file… and Apply set it: a text table read as the curve
 * editor reads it, its wavelength column in the unit its heading names, or
 * rows given. Each row is a wavelength, an intensity and, when a third column
 * is given, the spectral phase in rad; against wavelength the intensity is
 * read as per unit wavelength, as a spectrometer records it. The rows are
 * kept in the units given, in rising order, so the window shows them; the
 * design saves them. pulseAnalysis with `source: 'design'` reads them, its
 * centre then their centroid, where the window's Apply moves its centre.
 *
 * @param design The design.
 * @param fileOrRows The path of a text table, by its full path, or rows `[wavelength nm, intensity]` or `[wavelength nm, intensity, phase rad]`.
 * @returns The design with the spectrum.
 * @throws a file that cannot be read or holds no wavelength and intensity columns, a row that is not two or three numbers, fewer than two rows with a wavelength above 0 and an intensity not below 0, no row with an intensity above 0, or a phase on some rows and not on others
 * @example
 * const rows = [];
 * for (let w = 760; w <= 840; w += 2) rows.push([w, Math.exp(-(((w - 800) / 20) ** 2))]);
 * const mirror = tf.stackFromFormula(tf.newDesign({ name: 'Mirror', referenceWavelength: 800 }), { formula: '(HL)^8 H' });
 * const design = tf.setPulseSpectrum(mirror, rows);
 * const p = tf.pulseAnalysis(design, { source: 'design' });
 * console.log(design.pulseSpectrum.rows.length, 'rows; centre', p.centre, 'nm; output FWHM', p.metrics.outputFwhm.toFixed(2), 'fs');
 */
export function setPulseSpectrum(design, fileOrRows) {
    const isRow = row => Array.isArray(row) && [2, 3].includes(row.length) && row.every(Number.isFinite);
    requireValue('setPulseSpectrum', 'fileOrRows', fileOrRows, v => (typeof v === 'string' && v.length > 0) || (Array.isArray(v) && v.every(isRow)),
        'the path of a text table, or rows [wavelength nm, intensity] or [wavelength nm, intensity, phase rad]');
    const table = spectrumTableOf(fileOrRows);
    const problem = applyProblem(table);
    if (problem) throw new Error(`setPulseSpectrum: ${NOT_APPLIED[problem]}`);
    return { ...design, pulseSpectrum: pulseSpectrumFromTable(table) };
}
