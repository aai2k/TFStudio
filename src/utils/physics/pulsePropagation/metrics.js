/**
 * Numbers that describe a pulse before and after the element.
 *
 * Durations and peaks are read off the band-limited interpolant of the sampled
 * envelope, A(t) = Σ_j Ã_j exp(−i·j·δω·t), which is exact for the spectrum the
 * transform was given, rather than off straight lines between samples. A
 * spectral width is read off the spectral intensity itself, evaluated at any
 * frequency the search asks for. So a reported width does not depend on how
 * finely the curve is drawn.
 *
 * Definitions:
 *   FWHM        distance between the outermost half-maximum crossings of the
 *               intensity, so a satellite above half the peak counts
 *   RMS width   square root of the second central moment of the intensity
 *   delay       shift of the intensity centroid from input to output
 *   peak ratio  output peak intensity over input peak intensity, losses included
 *   TL ratio    output peak over the peak the same output spectrum would reach
 *               with a flat phase; 1 when nothing is left to compress
 *   TBP         intensity FWHM in time times intensity FWHM in frequency (Hz)
 *   residual GDD and TOD
 *               the output's GDD and TOD averaged over its spectrum, weighted by
 *               spectral intensity
 *
 * Delay, GDD and TOD come from analytic phase derivatives, never from
 * differences between neighbouring samples or a fit to an unwrapped phase.
 */

import { wavelengthFromOmega } from './pulseSpectrum.js';

const SEARCH_ITERATIONS = 60;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** |A(t)|² of one band spectrum at an arbitrary time, by direct summation. */
function bandIntensityAt(band, step, time) {
    const cosine = Math.cos(step * time);
    const sine = -Math.sin(step * time);
    // exp(−i·j·δω·t), stepped by rotation from the band's first index.
    let wr = Math.cos(band.first * step * time);
    let wi = -Math.sin(band.first * step * time);
    let sumRe = 0;
    let sumIm = 0;
    for (let index = 0; index < band.re.length; index++) {
        sumRe += band.re[index] * wr - band.im[index] * wi;
        sumIm += band.re[index] * wi + band.im[index] * wr;
        const next = wr * cosine - wi * sine;
        wi = wr * sine + wi * cosine;
        wr = next;
    }
    return sumRe * sumRe + sumIm * sumIm;
}

function signalIntensityAt(signal, time) {
    let sum = 0;
    for (const band of signal.bands) sum += bandIntensityAt(band, signal.step, time);
    return sum / signal.bands.length;
}

function goldenMaximum(evaluate, low, high) {
    let a = low;
    let b = high;
    for (let iteration = 0; iteration < SEARCH_ITERATIONS; iteration++) {
        const left = b - GOLDEN * (b - a);
        const right = a + GOLDEN * (b - a);
        if (evaluate(left) < evaluate(right)) a = left;
        else b = right;
    }
    const at = (a + b) / 2;
    return { at, value: evaluate(at) };
}

/** Where `evaluate` falls through `level` between `inside` (above) and `outside`. */
function bisectCrossing(evaluate, level, inside, outside) {
    let a = inside;
    let b = outside;
    for (let iteration = 0; iteration < SEARCH_ITERATIONS; iteration++) {
        const middle = (a + b) / 2;
        if (evaluate(middle) >= level) a = middle;
        else b = middle;
    }
    return (a + b) / 2;
}

function maximumIndex(values) {
    let best = 0;
    for (let index = 1; index < values.length; index++) {
        if (values[index] > values[best]) best = index;
    }
    return best;
}

/**
 * Peak and half-maximum width of a sampled curve whose exact value anywhere is
 * `evaluate(x)`. The width is NaN when a crossing falls outside the samples.
 */
function peakAndWidth(axis, samples, evaluate) {
    const top = maximumIndex(samples);
    const peak = goldenMaximum(evaluate,
        axis[Math.max(0, top - 1)], axis[Math.min(axis.length - 1, top + 1)]);
    const half = peak.value / 2;
    let first = 0;
    while (first < samples.length && samples[first] < half) first++;
    let last = samples.length - 1;
    while (last >= 0 && samples[last] < half) last--;
    if (first === 0 || last === samples.length - 1) {
        return { peak: peak.value, peakAt: peak.at, width: NaN };
    }
    const from = bisectCrossing(evaluate, half, axis[first], axis[first - 1]);
    const to = bisectCrossing(evaluate, half, axis[last], axis[last + 1]);
    return { peak: peak.value, peakAt: peak.at, width: to - from, from, to };
}

function moments(time, intensity) {
    let energy = 0;
    let first = 0;
    let second = 0;
    for (let index = 0; index < time.length; index++) {
        energy += intensity[index];
        first += intensity[index] * time[index];
        second += intensity[index] * time[index] * time[index];
    }
    const centroid = first / energy;
    return {
        energy,
        centroid,
        rms: Math.sqrt(Math.max(0, second / energy - centroid * centroid)),
    };
}

function temporalMetrics(signal, intensity, time) {
    const shape = peakAndWidth(time, intensity, at => signalIntensityAt(signal, at));
    const { energy, centroid, rms } = moments(time, intensity);
    return {
        fwhmFs: shape.width, rmsFs: rms, peak: shape.peak, peakAtFs: shape.peakAt,
        centroidFs: centroid, energy,
    };
}

function spectralWidth({ omega, carrier, samples, evaluate }) {
    const deltas = Array.from(omega, value => value - carrier);
    const shape = peakAndWidth(deltas, samples, evaluate);
    if (!Number.isFinite(shape.width)) return { fwhmRadPerFs: NaN, fwhmNm: NaN, peakNm: NaN };
    return {
        fwhmRadPerFs: shape.width,
        fwhmNm: wavelengthFromOmega(carrier + shape.from) - wavelengthFromOmega(carrier + shape.to),
        peakNm: wavelengthFromOmega(carrier + shape.peakAt),
    };
}

/**
 * Delay and mean GDD and TOD of the output, from the analytic derivatives of
 * its total spectral phase: the input's own polynomial plus N times the
 * response's GD, GDD and TOD. Each is a mean over the spectrum weighted by its
 * intensity. For the delay this is exact rather than a convention: t·A(t) and
 * −i·dÃ/dω are a Fourier pair, so by Parseval's theorem the intensity centroid
 * is ∫|Ã|²·(dΦ/dω) dω / ∫|Ã|² dω for any spectrum. Channels are pooled by the
 * energy each carries, as their intensities are.
 */
function phaseMeans({ model, passes, level }) {
    const totals = { weight: 0, gdFs: 0, gddFs2: 0, todFs3: 0 };
    let inputWeight = 0;
    let inputDelay = 0;
    for (let index = 0; index < level.input.re.length; index++) {
        const own = model.phaseDerivatives((index + level.first) * level.step);
        const power = level.input.re[index] ** 2 + level.input.im[index] ** 2;
        inputWeight += power;
        inputDelay += power * own.gdFs;
        level.outputs.forEach((band, channel) => {
            const point = level.values[channel][index];
            const weight = band.re[index] ** 2 + band.im[index] ** 2;
            if (!(weight > 0) || !point.valid) return;
            totals.weight += weight;
            totals.gdFs += weight * (own.gdFs + passes * point.gdFs);
            totals.gddFs2 += weight * (own.gddFs2 + passes * point.gddFs2);
            totals.todFs3 += weight * (own.todFs3 + passes * point.todFs3);
        });
    }
    return {
        inputDelayFs: inputDelay / inputWeight,
        outputDelayFs: totals.gdFs / totals.weight,
        gddFs2: totals.gddFs2 / totals.weight,
        todFs3: totals.todFs3 / totals.weight,
    };
}

/** Peak intensity the bands would reach with a flat phase, on the same scale. */
function transformLimitedPeak(bands) {
    let sum = 0;
    for (const band of bands) {
        let amplitude = 0;
        for (let index = 0; index < band.re.length; index++) {
            amplitude += Math.hypot(band.re[index], band.im[index]);
        }
        sum += amplitude * amplitude;
    }
    return sum / bands.length;
}

function bandPower(bands) {
    return Float64Array.from(bands[0].re, (_, index) => bands.reduce(
        (sum, band) => sum + band.re[index] ** 2 + band.im[index] ** 2, 0) / bands.length);
}

/**
 * @param {object} options
 * @param {object} options.model      the input spectrum model (pulseSpectrum.js)
 * @param {number} options.passes     number of passes
 * @param {object} options.level      the converged evaluation from propagate.js
 * @param {{band:object, intensity:Float64Array}} options.flp  the transform-limited input
 * @param {Float64Array} options.time time grid, fs
 * @param {Float64Array} options.omega band frequencies, rad/fs
 * @param {(deltaOmega:number) => {input:number, output:number}} options.spectralAt
 *   exact input and output spectral intensity at ω0 + Δω, on the band's scale
 */
export function pulseMetrics({ model, passes, level, flp, time, omega, spectralAt }) {
    const { step } = level;
    const carrier = model.omega0;
    const inputBands = [level.input];
    const flpPulse = temporalMetrics({ bands: [flp.band], step }, flp.intensity, time);
    const input = temporalMetrics({ bands: inputBands, step }, level.inputIntensity, time);
    const output = temporalMetrics({ bands: level.outputs, step }, level.outputIntensity, time);
    input.bandwidth = spectralWidth({
        omega, carrier, samples: bandPower(inputBands), evaluate: delta => spectralAt(delta).input,
    });
    output.bandwidth = spectralWidth({
        omega, carrier, samples: bandPower(level.outputs), evaluate: delta => spectralAt(delta).output,
    });
    for (const pulse of [input, output]) {
        pulse.timeBandwidth = pulse.fwhmFs * pulse.bandwidth.fwhmRadPerFs / (2 * Math.PI);
    }
    const phase = phaseMeans({ model, passes, level });
    output.residual = { gddFs2: phase.gddFs2, todFs3: phase.todFs3 };
    output.transformLimitedRatio = output.peak / transformLimitedPeak(level.outputs);
    return {
        flp: flpPulse,
        input,
        output,
        broadening: output.fwhmFs / input.fwhmFs,
        peakRatio: output.peak / input.peak,
        peakVsFlp: output.peak / flpPulse.peak,
        energyRatio: output.energy / input.energy,
        delayFs: phase.outputDelayFs - phase.inputDelayFs,
    };
}