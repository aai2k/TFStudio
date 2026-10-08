/**
 * A pulse sent through a linear optical element given by its complex transfer
 * function, by Fourier transform.
 *
 * The output spectrum is the input spectrum times H(ω)^N for N passes, with H
 * the full complex coefficient at every frequency. Nothing is expanded in
 * powers of Δω, so the ripple and the higher-order terms a GDD curve hides
 * reach the output pulse.
 *
 * Grid. The envelope is sampled uniformly in Δω = ω − ω0. The step in time is
 * set by the pulse and fixes the span in frequency, 2π/dt, which is at least
 * twice the band the pulse occupies. H is evaluated only inside that band, where
 * the input spectral intensity is above SPECTRAL_FLOOR of its peak, and the
 * rest is zero. The time window is 2π/δω. A transform is periodic, so a pulse
 * longer than the window wraps onto itself and still looks like a pulse. The
 * window is therefore doubled until the energy in its outer edges is
 * negligible and the window twice as long draws the same curves; a result
 * that never gets there is returned marked unconverged rather than drawn as if
 * it were right.
 *
 * Zero frequency. A pulse of a few optical cycles has a spectrum whose far
 * tail reaches ω = 0. The band stops there. A pulse with more than a negligible
 * share of its spectral energy at or below zero frequency is refused: its
 * envelope no longer describes a field.
 *
 * Reference delay. The output is computed with the group delay at the band's
 * strongest frequency removed, so a mirror stack that delays the pulse by
 * picoseconds does not need a window picoseconds long. That delay is the
 * response's own analytic group delay there and is returned as
 * referenceDelayFs. The output's times on the returned grid, and in its
 * metrics, are measured from it; the reported delay, metrics.delayFs, is
 * absolute.
 *
 * Polarization. Each response in `responses` is one channel, s or p. An
 * unpolarized pulse is an equal mix of the two; their fields do not interfere
 * in the intensity, so the output intensity is the mean of the channel
 * intensities.
 *
 * Units: time fs, angular frequency rad/fs, wavelength nm.
 */

import { fftInPlace } from './fft.js';
import {
    carrierOmega as carrierOmegaOf, inputTimeExtent, pulseProblem, pulseSpectrumModel,
    wavelengthFromOmega as wavelengthAt,
} from './pulseSpectrum.js';
import { analyticDelay, pulseMetrics } from './metrics.js';
import {
    bandIndices, checkedPoint, flatPhase, inputBand, missingResponse, outputBand,
    referenceDelay, sampleBand, transferPower, zeroFrequencyShare,
} from './bandSampling.js';

// The band outside which the input spectral intensity is below this fraction
// of its peak is left unevaluated. Cutting the spectrum there moves a reported
// duration by a few parts in 1e7 for a Gaussian and in 1e6 for sech², far
// below what a plot or a four-digit readout can show.
const SPECTRAL_FLOOR = 1e-12;
// Samples per transform-limited intensity FWHM. The shortest feature the band
// above can carry, 2π over its width, is a third of that FWHM for a Gaussian
// and a fifth for sech², so it spans nine samples or more and the drawn curve
// needs no interpolation.
const SAMPLES_PER_DURATION = 48;
// The most of the transform's span in frequency the band may take. Past the
// whole span, band samples would land on slots already taken and add to them,
// folding the spectrum onto itself; the half left empty keeps two samples or
// more across the shortest feature the band can carry. A measured spectrum with
// a baseline across a wide range carries light far from its line, and this is
// what sizes the step for it.
const BAND_SHARE = 0.5;
// The outer eighth of the window on each side is the guard band: energy there
// is energy about to wrap round from the other end.
const GUARD_FRACTION = 0.125;
// Most energy the guard band may hold, of the input or of any output channel.
// A share ε that wraps round lands on the pulse coherently and could move its
// intensity by up to 2√ε of the peak, 2e-4 here; what of it does reach the
// curves also changes them from one window to the next, which
// INTENSITY_AGREEMENT bounds. Together they held every duration tried, among
// them a measured spectrum cut off while still carrying light, to 1.1e-6 of a
// direct integration. A spectrum cut off that way has a tail in time whose
// share halves only with each doubling, so a much tighter limit would not be
// reached within DEFAULT_MAX_POINTS.
const GUARD_ENERGY = 1e-8;
// Most of the input's spectral energy that may be cut off: at or below zero
// frequency, or where the response has no value. Cutting a share ε moves the
// transform-limited duration by about √ε, 3e-5 here, below the last of the
// four digits it is read to.
const CUT_ENERGY = 1e-9;
// A pulse folded back into the window by a whole number of windows can leave
// the guard band empty, but a fold that carries much energy moves the
// transformed pulse's centroid away from the delay the analytic group delay
// gives. Unfolded, the two agree to about 1e-6 of the pulse duration, and to
// under 1e-3 where a material table ends inside the band, a gap that shrinks,
// unevenly, as the window grows. A faint fold can pass this test.
const DELAY_AGREEMENT = 1e-3;
// Most the input or output intensity may change, as a share of its peak, from
// a window to the one twice as long. Content wrapped an odd number of times
// lands elsewhere in the longer window, so a faint fold shows here. A change
// this small moves a half-maximum point by about 1e-5 of the duration. What
// none of these tests sees is a faint, separate echo far enough out to wrap an
// even number of times in both windows: it lands in the same place in each.
const INTENSITY_AGREEMENT = 1e-5;
// Largest transform. Its window is about 22 000 transform-limited durations,
// 0.2 ns for a 10 fs pulse, and its working arrays take a few hundred MB.
export const DEFAULT_MAX_POINTS = 2 ** 20;

function nextPowerOfTwo(value) {
    return 2 ** Math.ceil(Math.log2(Math.max(2, value)));
}

/**
 * |A(t)|² on the time grid, ascending from −n/2·dt, for a band spectrum. The
 * overall scale (δω/2π)² is left off; every signal shares it.
 */
function bandToIntensity(band, points) {
    const re = new Float64Array(points);
    const im = new Float64Array(points);
    for (let index = 0; index < band.re.length; index++) {
        const slot = (index + band.first + points) % points;
        re[slot] += band.re[index];
        im[slot] += band.im[index];
    }
    // A(t_m) = Σ_j Ã_j exp(−2πi·j·m/n): the exp(−iωt) convention.
    fftInPlace(re, im, -1);
    const intensity = new Float64Array(points);
    const half = points / 2;
    for (let m = 0; m < points; m++) {
        intensity[(m + half) % points] = re[m] * re[m] + im[m] * im[m];
    }
    return intensity;
}

function guardEnergy(intensity) {
    const guard = Math.floor(intensity.length * GUARD_FRACTION);
    let edge = 0;
    let total = 0;
    for (let index = 0; index < intensity.length; index++) {
        total += intensity[index];
        if (index < guard || index >= intensity.length - guard) edge += intensity[index];
    }
    return total > 0 ? edge / total : 0;
}

function averageIntensity(intensities) {
    const result = new Float64Array(intensities[0].length);
    for (const intensity of intensities) {
        for (let index = 0; index < result.length; index++) {
            result[index] += intensity[index] / intensities.length;
        }
    }
    return result;
}

/** Total of a sampled intensity and its centroid in samples from the window's middle. */
function centroidInSamples(intensity) {
    let total = 0;
    let moment = 0;
    for (let index = 0; index < intensity.length; index++) {
        total += intensity[index];
        moment += intensity[index] * (index - intensity.length / 2);
    }
    return { total, centroid: moment / total };
}

/**
 * Largest change in the input and output intensity from a level to the next,
 * at the same times, as a share of each curve's peak. The next level has twice
 * the samples in the same band and the same t = 0, so with nothing folded its
 * sums are twice as large and its intensities four times.
 */
function intensityChange(coarse, fine) {
    const offset = coarse.points / 2;
    let change = 0;
    for (const key of ['inputIntensity', 'outputIntensity']) {
        const before = coarse[key];
        const after = fine[key];
        let peak = 0;
        let largest = 0;
        for (let m = 0; m < coarse.points; m++) {
            peak = Math.max(peak, after[m + offset]);
            largest = Math.max(largest, Math.abs(4 * before[m] - after[m + offset]));
        }
        change = Math.max(change, largest / peak);
    }
    return change;
}

/** Whether a level holds the whole pulse: nothing at its edges, nothing folded in. */
function fits({ model }, level) {
    return level.guard <= GUARD_ENERGY
        && Math.abs(level.delayMismatchFs) <= DELAY_AGREEMENT * model.resolutionFs;
}

/** One evaluation of every signal on a grid of `points` samples. */
function evaluateLevel(context, points, previous) {
    const { model, responses, passes, dt } = context;
    const step = 2 * Math.PI / (points * dt);
    const indices = bandIndices(context, step);
    const values = sampleBand({ responses, omega0: model.omega0, step, ...indices }, previous);
    const input = inputBand(model, step, indices);
    // Every level keeps the first level's reference delay, so their samples
    // fall at the same times and can be compared one for one.
    const delay = previous ? previous.delay : referenceDelay(input, values, passes);
    const outputs = values.map(channel => outputBand({ input, points: channel, passes, step, delay }));
    const inputIntensity = bandToIntensity(input, points);
    const channelIntensities = outputs.map(band => bandToIntensity(band, points));
    const outputIntensity = averageIntensity(channelIntensities);
    const level = {
        points, step, first: indices.first, values, input, outputs, delay,
        inputIntensity, outputIntensity,
        guard: Math.max(guardEnergy(inputIntensity), ...channelIntensities.map(guardEnergy)),
        missing: missingResponse(input, values),
    };
    const before = centroidInSamples(inputIntensity);
    const after = centroidInSamples(outputIntensity);
    level.outputEnergy = after.total;
    level.delayMismatchFs = analyticDelay({ model, passes, level })
        - (delay + (after.centroid - before.centroid) * dt);
    return level;
}

/**
 * @param {object} options
 * @param {object} options.pulse  the input pulse, as pulseSpectrum.js reads it:
 *   shape, centerWavelengthNm, durationFs (Gaussian, sech²: transform-limited
 *   intensity FWHM), bandwidthNm and order (super-Gaussian), table (a measured
 *   spectrum, intensity per unit frequency), and gddFs2, todFs3 added on top of
 *   any of them
 * @param {Array<(wavelengthNm:number) => {valid:boolean, re:number, im:number,
 *          gdFs:number, gddFs2:number, todFs3:number, reason?:string}>} options.responses
 *   one pass of the element, one function per polarization channel: the
 *   complex coefficient and its analytic phase derivatives
 * @param {number} [options.passes=1]  number of passes (bounces)
 * @param {number} [options.maxPoints] largest transform allowed
 */
export function propagatePulse({ pulse, responses, passes = 1, maxPoints = DEFAULT_MAX_POINTS }) {
    const problem = pulseProblem(pulse);
    if (problem) return { valid: false, reason: problem };
    const model = pulseSpectrumModel(pulse, SPECTRAL_FLOOR);
    const dt = Math.min(
        model.resolutionFs / SAMPLES_PER_DURATION,
        2 * Math.PI * BAND_SHARE / (model.high - model.low),
    );
    const context = { model, responses, passes, dt };

    const start = startLevel(context, maxPoints);
    if (start.refused) return start.refused;
    let { level } = start;
    // A level counts only when the next one, twice as long, fits as well and
    // draws the same curves; that one, the finer in frequency, is the result.
    let confirmed = false;
    while (!confirmed && level.points * 2 <= maxPoints) {
        const next = evaluateLevel(context, level.points * 2, level);
        confirmed = fits(context, level) && fits(context, next)
            && intensityChange(level, next) <= INTENSITY_AGREEMENT;
        level = next;
    }
    return assembleResult(context, level, confirmed);
}

/** The first evaluation, or why the pulse is refused before or at it. */
function startLevel(context, maxPoints) {
    const { model, dt } = context;
    const share = zeroFrequencyShare(model);
    if (share > CUT_ENERGY) {
        return { refused: { valid: false, reason: 'spectrumReachesZeroFrequency', removedEnergy: share } };
    }
    // Sized to hold the input's own spread of arrival times clear of the guard
    // band; the response's spread is found by growing it.
    const points = Math.min(maxPoints,
        nextPowerOfTwo(inputTimeExtent(model) / (1 - 2 * GUARD_FRACTION) / dt));
    const level = evaluateLevel(context, points, null);
    return { level, refused: levelRefusal(level) };
}

function levelRefusal(level) {
    if (level.missing.energy > CUT_ENERGY) {
        return { valid: false, reason: 'responseUnavailable', detail: level.missing.reason };
    }
    // Nothing comes out at all, as behind total internal reflection: there is
    // no pulse to describe, and every number would be noise.
    return level.outputEnergy > 0 ? null : { valid: false, reason: 'noOutput' };
}

function assembleResult(context, level, converged) {
    const { model, responses, passes, dt } = context;
    const { points, step, first } = level;
    const time = Float64Array.from({ length: points }, (_, index) => (index - points / 2) * dt);
    const omega = Float64Array.from({ length: level.input.re.length },
        (_, index) => model.omega0 + (index + first) * step);
    const spectralAt = deltaOmega => spectrumAt(context, wavelengthAt(model.omega0 + deltaOmega));
    const flpBand = flatPhase(level.input);
    const flpIntensity = bandToIntensity(flpBand, points);
    return {
        valid: true,
        converged,
        guardEnergy: level.guard,
        delayMismatchFs: level.delayMismatchFs,
        missingEnergy: level.missing.energy,
        points,
        timeStepFs: dt,
        windowFs: points * dt,
        carrierOmega: model.omega0,
        referenceDelayFs: level.delay,
        time,
        flpIntensity,
        inputIntensity: level.inputIntensity,
        outputIntensity: level.outputIntensity,
        band: {
            omega,
            wavelengthNm: Float64Array.from(omega, wavelengthAt),
            input: level.input,
            inputGddFs2: Float64Array.from(omega, value => model.phaseDerivatives(value - model.omega0).gddFs2),
            outputs: level.outputs,
            responses: level.values,
        },
        metrics: pulseMetrics({
            model, passes, level, time, omega, spectralAt,
            flp: { band: flpBand, intensity: flpIntensity },
        }),
        spectrumAt: wavelengthNm => spectrumAt(context, wavelengthNm),
    };
}

/**
 * The spectra at any vacuum wavelength, evaluated there rather than read off
 * the band's samples, on the band's scale: input and output spectral
 * intensity, the output averaged over the channels as the intensities are;
 * the response's GDD over all passes, averaged over the channels that have a
 * value; and the input's own GDD.
 */
function spectrumAt({ model, responses, passes }, wavelengthNm) {
    const deltaOmega = carrierOmegaOf(wavelengthNm) - model.omega0;
    const input = model.amplitude(deltaOmega) ** 2;
    const points = responses.map(response => checkedPoint(response(wavelengthNm)));
    const transfer = points.reduce((sum, point) => sum + transferPower(point, passes), 0) / points.length;
    const valid = points.filter(point => point.valid && Number.isFinite(point.gddFs2));
    return {
        input,
        output: input * transfer,
        responseGddFs2: valid.length
            ? passes * valid.reduce((sum, point) => sum + point.gddFs2, 0) / valid.length
            : NaN,
        inputGddFs2: model.phaseDerivatives(deltaOmega).gddFs2,
    };
}