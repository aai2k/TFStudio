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
 * set by the pulse and fixes the span in frequency, 2π/dt, which is far wider
 * than the pulse spectrum; H is evaluated only inside the band where the input
 * spectral intensity is above SPECTRAL_FLOOR and the rest is zero. The time
 * window is 2π/δω. A transform is periodic, so a pulse longer than the window
 * wraps onto itself and still looks like a pulse. The window is therefore
 * doubled until the energy in its outer edges is negligible, and a result that
 * never fits is returned marked unconverged rather than drawn as if it were
 * right.
 *
 * Zero frequency. A pulse of a few optical cycles has a spectrum whose far
 * tail reaches ω = 0. The band stops there. The part of the input spectrum the
 * cut removes is measured, and a pulse that loses more than a negligible share
 * of its energy to it is refused: its envelope no longer describes a field.
 *
 * Reference delay. The output is computed with the group delay at the band's
 * strongest frequency removed, so a mirror stack that delays the pulse by
 * picoseconds does not need a window picoseconds long. That delay is the
 * response's own analytic group delay there, and it is added back to every
 * reported time.
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
    inputTimeExtent, pulseProblem, pulseSpectrumModel, wavelengthFromOmega as wavelengthAt,
} from './pulseSpectrum.js';
import { pulseMetrics } from './metrics.js';
import {
    bandIndices, checkedPoint, cutEnergy, flatPhase, inputBand, missingResponse, outputBand,
    referenceDelay, sampleBand, transferPower,
} from './bandSampling.js';

// The band outside which the input spectral intensity is below this fraction
// of its peak is left unevaluated. Cutting the spectrum there moves a reported
// duration by a few parts in 1e7 for a Gaussian and in 1e6 for sech², far
// below what a plot or a four-digit readout can show.
const SPECTRAL_FLOOR = 1e-12;
// Samples per transform-limited intensity FWHM. The shortest feature a band of
// the width above can carry is about a third of that FWHM, so it still spans
// more than a dozen samples and the drawn curve needs no interpolation.
const SAMPLES_PER_DURATION = 48;
// First time window, in units of the input pulse's own extent.
const INITIAL_WINDOW_PER_EXTENT = 16;
// The outer eighth of the window on each side is the guard band: energy there
// is energy about to wrap round from the other end. A share of the energy
// below NEGLIGIBLE_ENERGY changes no drawn curve and no reported digit. It is
// also the most of the input spectrum the zero-frequency cut may remove, and
// the most that may fall where the response has no value.
const GUARD_FRACTION = 0.125;
const NEGLIGIBLE_ENERGY = 1e-8;
// Largest transform. Its window is about 4800 transform-limited durations, 0.2 ns
// for a 10 fs pulse, and its working arrays take some tens of MB.
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
        re[slot] = band.re[index];
        im[slot] = band.im[index];
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

/** One evaluation of every signal on a grid of `points` samples. */
function evaluateLevel(context, points, previous) {
    const { model, responses, passes, dt } = context;
    const step = 2 * Math.PI / (points * dt);
    const indices = bandIndices(context, step);
    const values = sampleBand({ responses, omega0: model.omega0, step, ...indices }, previous);
    const input = inputBand(model, step, indices);
    const delay = referenceDelay(input, values, passes);
    const outputs = values.map(channel => outputBand({ input, points: channel, passes, step, delay }));
    const inputIntensity = bandToIntensity(input, points);
    const channelIntensities = outputs.map(band => bandToIntensity(band, points));
    return {
        points, step, first: indices.first, values, input, outputs, delay,
        inputIntensity,
        outputIntensity: averageIntensity(channelIntensities),
        guard: Math.max(guardEnergy(inputIntensity), ...channelIntensities.map(guardEnergy)),
        missing: missingResponse(input, values),
    };
}

/**
 * @param {object} options
 * @param {object} options.pulse  the input pulse, as pulseSpectrum.js reads it:
 *   shape, centerWavelengthNm, durationFs (Gaussian, sech²: transform-limited
 *   intensity FWHM), bandwidthNm and order (super-Gaussian), table (a measured
 *   spectrum), and gddFs2, todFs3 added on top of any of them
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
    const dt = model.resolutionFs / SAMPLES_PER_DURATION;
    const context = { model, responses, passes, dt };

    let points = nextPowerOfTwo(INITIAL_WINDOW_PER_EXTENT * inputTimeExtent(model) / dt);
    const step = 2 * Math.PI / (points * dt);
    const removed = cutEnergy(context, step, bandIndices(context, step));
    if (removed > NEGLIGIBLE_ENERGY) {
        return { valid: false, reason: 'spectrumReachesZeroFrequency', removedEnergy: removed };
    }

    let level = evaluateLevel(context, points, null);
    if (level.missing.energy > NEGLIGIBLE_ENERGY) {
        return { valid: false, reason: 'responseUnavailable', detail: level.missing.reason };
    }
    while (level.guard > NEGLIGIBLE_ENERGY && points * 2 <= maxPoints) {
        points *= 2;
        level = evaluateLevel(context, points, level);
    }
    return assembleResult(context, level);
}

function assembleResult(context, level) {
    const { model, responses, passes, dt } = context;
    const { points, step, first } = level;
    const time = Float64Array.from({ length: points }, (_, index) => (index - points / 2) * dt);
    const omega = Float64Array.from({ length: level.input.re.length },
        (_, index) => model.omega0 + (index + first) * step);
    const spectralAt = deltaOmega => {
        const input = model.amplitude(deltaOmega) ** 2;
        const wavelengthNm = wavelengthAt(model.omega0 + deltaOmega);
        const transfer = responses.reduce((sum, response) =>
            sum + transferPower(checkedPoint(response(wavelengthNm)), passes), 0) / responses.length;
        return { input, output: input * transfer };
    };
    const flpBand = flatPhase(level.input);
    const flpIntensity = bandToIntensity(flpBand, points);
    return {
        valid: true,
        converged: level.guard <= NEGLIGIBLE_ENERGY,
        guardEnergy: level.guard,
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
    };
}