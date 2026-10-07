/**
 * The band of frequencies a pulse is evaluated on, and the spectra built on it.
 *
 * A band is the run of indices j, frequencies ω0 + jδω, where the input pulse
 * carries energy. Each spectrum on it is `{ first, re, im }`, `first` being the
 * j of its first sample, and each response is one point per sample:
 * `{ valid, re, im, gdFs, gddFs2, todFs3 }`, as coatingResponse.js returns it.
 *
 * Units: angular frequency rad/fs, time fs.
 */

import { wavelengthFromOmega as wavelengthAt } from './pulseSpectrum.js';

const NO_VALUE = { valid: false, re: 0, im: 0 };
// Simpson intervals for each piece of the zero-frequency share. A piece is a
// few spectral widths long, or one carrier frequency, so this puts dozens of
// intervals across the spectrum's width, and the rule's error falls as the
// fourth power of the interval.
const SHARE_INTERVALS = 4096;

function complexPower(point, power) {
    const magnitude = Math.hypot(point.re, point.im) ** power;
    const phase = Math.atan2(point.im, point.re) * power;
    return [magnitude * Math.cos(phase), magnitude * Math.sin(phase)];
}

export function transferPower(point, passes) {
    return (point.re * point.re + point.im * point.im) ** passes;
}

/**
 * Band indices j, frequencies ω0 + jδω, from `first` to `last`: the pulse's own
 * band, except that the low edge stops short of zero frequency.
 */
export function bandIndices({ model }, step) {
    const lowestPositive = Math.floor(-model.omega0 / step) + 1;
    return { first: Math.max(Math.ceil(model.low / step), lowestPositive), last: Math.floor(model.high / step) };
}

function simpson(f, from, to, intervals) {
    const h = (to - from) / intervals;
    let sum = f(from) + f(to);
    for (let k = 1; k < intervals; k++) sum += (k % 2 ? 4 : 2) * f(from + k * h);
    return sum * h / 3;
}

/**
 * Share of the input spectral energy at or below zero frequency, Δω ≤ −ω0. The
 * part above is split at the carrier, where a model spectrum peaks.
 */
export function zeroFrequencyShare(model) {
    const zero = -model.omega0;
    if (!(model.low < zero)) return 0;
    const power = deltaOmega => model.amplitude(deltaOmega) ** 2;
    const below = simpson(power, model.low, zero, SHARE_INTERVALS);
    const above = simpson(power, zero, 0, SHARE_INTERVALS) + simpson(power, 0, model.high, SHARE_INTERVALS);
    return below / (below + above);
}

export function checkedPoint(point) {
    if (!point.valid) return { ...NO_VALUE, reason: point.reason };
    return Number.isFinite(point.re) && Number.isFinite(point.im) ? point : NO_VALUE;
}

/**
 * The response at ω0 + jδω for every channel. A previous evaluation at twice
 * the step supplies every even j, since ω0 + 2j·(δω/2) is the same
 * floating-point number as ω0 + j·δω. A point with no value is kept as zero, so
 * one bad sample cannot turn the whole transform into NaN; how much input
 * energy such points cover is measured afterwards.
 */
export function sampleBand({ responses, omega0, step, first, last }, previous) {
    return responses.map((response, channel) => {
        const points = new Array(last - first + 1);
        for (let j = first; j <= last; j++) {
            const reused = previous && j % 2 === 0
                ? previous.values[channel][j / 2 - previous.first]
                : undefined;
            points[j - first] = reused ?? checkedPoint(response(wavelengthAt(omega0 + j * step)));
        }
        return points;
    });
}

export function inputBand(model, step, { first, last }) {
    const re = new Float64Array(last - first + 1);
    const im = new Float64Array(last - first + 1);
    for (let j = first; j <= last; j++) {
        const deltaOmega = j * step;
        const magnitude = model.amplitude(deltaOmega);
        const phase = model.phase(deltaOmega);
        re[j - first] = magnitude * Math.cos(phase);
        im[j - first] = magnitude * Math.sin(phase);
    }
    return { first, re, im };
}

function bandPowerAt(band, index) {
    return band.re[index] ** 2 + band.im[index] ** 2;
}

/** Share of the input energy where some channel has no value, and why. */
export function missingResponse(input, values) {
    let missing = 0;
    let total = 0;
    let reason = null;
    for (let index = 0; index < input.re.length; index++) {
        total += bandPowerAt(input, index);
        const absent = values.find(channel => !channel[index].valid);
        if (absent) {
            missing += bandPowerAt(input, index);
            reason ??= absent[index].reason ?? null;
        }
    }
    return { energy: total > 0 ? missing / total : 0, reason };
}

/**
 * Group delay of H^passes at the band's strongest output frequency, the
 * channels weighted by the power each carries there.
 */
export function referenceDelay(input, values, passes) {
    let best = -1;
    let bestPower = -1;
    for (let index = 0; index < input.re.length; index++) {
        const power = bandPowerAt(input, index)
            * values.reduce((sum, channel) => sum + transferPower(channel[index], passes), 0);
        if (power > bestPower) {
            bestPower = power;
            best = index;
        }
    }
    let delay = 0;
    let weight = 0;
    for (const channel of values) {
        const point = channel[best];
        if (!point?.valid || !Number.isFinite(point.gdFs)) continue;
        const power = transferPower(point, passes);
        delay += power * passes * point.gdFs;
        weight += power;
    }
    return weight > 0 ? delay / weight : 0;
}

/** Output spectrum of one channel on the band, the reference delay removed. */
export function outputBand({ input, points, passes, step, delay }) {
    const re = new Float64Array(input.re.length);
    const im = new Float64Array(input.re.length);
    for (let index = 0; index < input.re.length; index++) {
        const [hr, hi] = complexPower(points[index], passes);
        const shift = -delay * (index + input.first) * step;
        const cr = hr * Math.cos(shift) - hi * Math.sin(shift);
        const ci = hr * Math.sin(shift) + hi * Math.cos(shift);
        re[index] = input.re[index] * cr - input.im[index] * ci;
        im[index] = input.re[index] * ci + input.im[index] * cr;
    }
    return { first: input.first, re, im };
}

/** The transform-limited spectrum: the input's amplitude with no phase. */
export function flatPhase(input) {
    return {
        first: input.first,
        re: Float64Array.from(input.re, (re, index) => Math.hypot(re, input.im[index])),
        im: new Float64Array(input.re.length),
    };
}