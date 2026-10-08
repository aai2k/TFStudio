/**
 * What the Pulse Analysis window draws and reports, computed from a design and
 * the window's settings. Pure and free of the DOM, so it runs in the analysis
 * worker; it returns plain arrays and numbers that cross to the window as they
 * are.
 *
 * Intensities in time are scaled so the Fourier-limited pulse peaks at 1, which
 * makes a lost peak read directly. Spectral intensities are scaled so the input
 * peaks at 1, so the output spectrum shows what reflection or transmission
 * took away.
 */

import {
    createCoatingResponses, propagatePulse, spectrumCentroidOmega, wavelengthFromOmega,
} from '../../../../utils/physics/pulsePropagation.js';
import { X_UNITS, xToNm } from '../../../../utils/io/spectrumTable.js';
import { evaluateSubstratePropagation } from '../../../../utils/physics/phaseDispersion.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';

// The spectrum view draws, and the material-range notice checks, the band where
// the input carries at least this fraction of its peak spectral intensity:
// below it nothing shows on a linear plot.
const DISPLAY_FLOOR = 1e-3;
// The time view keeps the samples where a curve is above this fraction of the
// Fourier-limited peak, which is below the plot's line width. It is also how
// far the input may stray from the Fourier-limited pulse and still be drawn as
// the same curve.
const TIME_FLOOR = 1e-4;
// Most samples one drawn curve carries. A transform can hold a million. Past
// this many, each run of samples is drawn by its lowest and highest in order,
// so a narrow peak keeps its height and fast fringes keep their envelope; the
// readout is computed on the full set.
const MAX_DRAWN_POINTS = 4000;
// Fewest frequencies the spectrum view is drawn on. A short pulse has a short
// time window and so a coarse step in frequency, a few dozen samples across
// its band, which drawn with straight lines between them look like a polygon.
// With fewer transform samples than this across the drawn band, the view is
// evaluated afresh on the transform's step divided by a whole number, so every
// transform sample is kept and nothing is drawn coarser than the transform.
// Six hundred is about one per pixel of the plot. Each is a fresh evaluation
// of the spectrum and the response, not an interpolation.
const SPECTRUM_POINTS = 600;
const EMPTY_CURVE = { x: [], y: [] };

// Units of the first column against which an intensity is per unit wavelength,
// as a spectrometer records it. Wavenumber and photon energy are proportional
// to frequency, so an intensity against either is per unit frequency already.
const WAVELENGTH_UNITS = new Set([X_UNITS.NM, X_UNITS.UM]);

/**
 * A spectrum kept on the design, { xUnit, rows: [[x, intensity, phase]] } as
 * it was typed or read, as the pulse code reads a table: wavelength in nm,
 * intensity per unit frequency, phase in rad or none. Against wavelength the
 * intensity is per unit wavelength and becomes per unit frequency by
 * |dλ/dω| = λ²/2πc, the constant dropping out with the normalisation.
 * Undefined when there is no spectrum.
 */
export function spectrumTable(spectrum) {
    if (!spectrum?.rows?.length) return undefined;
    const xUnit = spectrum.xUnit || X_UNITS.NM;
    const wavelengthNm = spectrum.rows.map(row => xToNm(row[0], xUnit));
    const perWavelength = WAVELENGTH_UNITS.has(xUnit);
    const phased = spectrum.rows.some(row => Number.isFinite(row[2]));
    return {
        wavelengthNm,
        intensity: spectrum.rows.map((row, index) => (perWavelength ? row[1] * wavelengthNm[index] ** 2 : row[1])),
        phaseRad: phased ? spectrum.rows.map(row => row[2]) : undefined,
    };
}

/** The centroid in frequency of a spectrum kept on the design, as a vacuum wavelength in nm, or NaN. */
export function spectrumCentroidNm(spectrum) {
    const table = spectrumTable(spectrum);
    return table ? wavelengthFromOmega(spectrumCentroidOmega(table)) : NaN;
}

/** That centroid as the centre wavelength field takes it, to the hundredth of a nanometre. */
export function spectrumCentreField(spectrum) {
    return Math.round(spectrumCentroidNm(spectrum) * 100) / 100;
}

/** The pulse the core reads, from the window's settings and the design's spectrum. */
export function pulseFromSettings(settings) {
    const fromFile = settings.source === 'file';
    return {
        shape: fromFile ? 'table' : settings.shape,
        centerWavelengthNm: settings.centerWavelength,
        durationFs: settings.duration,
        bandwidthNm: settings.bandwidth,
        order: settings.order,
        table: fromFile ? spectrumTable(settings.spectrum) : undefined,
        gddFs2: settings.gdd || 0,
        todFs3: settings.tod || 0,
    };
}

function largest(values) {
    let peak = -Infinity;
    for (const value of values) if (value > peak) peak = value;
    return peak;
}

/**
 * The positions in `indices` to draw for `values`: all of them up to
 * MAX_DRAWN_POINTS, otherwise the lowest and highest of each run, in order.
 */
function thinned(indices, values) {
    if (indices.length <= MAX_DRAWN_POINTS) return indices;
    const run = Math.ceil(2 * indices.length / MAX_DRAWN_POINTS);
    const kept = [];
    for (let start = 0; start < indices.length; start += run) {
        let low = indices[start];
        let high = low;
        for (let position = start + 1; position < Math.min(start + run, indices.length); position++) {
            const index = indices[position];
            if (values[index] < values[low]) low = index;
            if (values[index] > values[high]) high = index;
        }
        kept.push(...(low === high ? [low] : [Math.min(low, high), Math.max(low, high)]));
    }
    return kept;
}

/** One curve against `x`: the samples at `indices`, thinned for drawing. */
function curve(x, values, indices, scaleX = value => value, scaleY = value => value) {
    const drawn = thinned(indices, values);
    return { x: drawn.map(index => scaleX(x[index])), y: drawn.map(index => scaleY(values[index])) };
}

/** One curve in time: the samples above the floor, thinned for drawing. */
function timeCurve(time, intensity, scale, offset) {
    let first = 0;
    let last = intensity.length - 1;
    while (first < last && intensity[first] * scale < TIME_FLOOR) first++;
    while (last > first && intensity[last] * scale < TIME_FLOOR) last--;
    const indices = Array.from({ length: last - first + 1 }, (_, position) => first + position);
    return curve(time, intensity, indices, value => value + offset, value => value * scale);
}

function meanOverChannels(channels, index, read) {
    let sum = 0;
    let count = 0;
    for (const channel of channels) {
        const value = read(channel, index);
        if (Number.isFinite(value)) {
            sum += value;
            count++;
        }
    }
    return count ? sum / count : NaN;
}

/**
 * The spectrum view's curves. The input spectrum is on its model's scale,
 * which peaks at 1. Where the transform has fewer samples across the drawn band
 * than SPECTRUM_POINTS, which happens for a short time window, the curves are
 * evaluated afresh on a finer step; otherwise the transform's own samples are
 * drawn, thinned.
 */
function spectrumCurves(result, passes) {
    const { band } = result;
    const inputPower = Array.from(band.input.re, (re, index) => re * re + band.input.im[index] ** 2);
    const peak = largest(inputPower);
    const indices = [];
    inputPower.forEach((power, index) => { if (power >= DISPLAY_FLOOR * peak) indices.push(index); });
    if (!indices.length) return { input: EMPTY_CURVE, output: EMPTY_CURVE, coatingGddFs2: EMPTY_CURVE, compensatingGddFs2: EMPTY_CURVE, bandNm: null };
    const [first, last] = [indices[0], indices[indices.length - 1]];
    // The band runs up in frequency, so down in wavelength.
    const bandNm = [band.wavelengthNm[last], band.wavelengthNm[first]];
    const steps = last - first;
    if (steps > 0 && steps + 1 < SPECTRUM_POINTS) {
        const intervals = Math.ceil((SPECTRUM_POINTS - 1) / steps) * steps;
        return evaluatedCurves(result.spectrumAt, [band.omega[first], band.omega[last]], intervals, bandNm);
    }
    const outputPower = Array.from(inputPower, (_, index) => meanOverChannels(band.outputs, index,
        (channel, at) => channel.re[at] ** 2 + channel.im[at] ** 2));
    const coatingGdd = Array.from(inputPower, (_, index) => meanOverChannels(band.responses, index,
        (channel, at) => (channel[at].valid ? passes * channel[at].gddFs2 : NaN)));
    return {
        input: curve(band.wavelengthNm, inputPower, indices),
        output: curve(band.wavelengthNm, outputPower, indices),
        coatingGddFs2: curve(band.wavelengthNm, coatingGdd, indices),
        compensatingGddFs2: curve(band.wavelengthNm, Array.from(band.inputGddFs2, value => -value), indices),
        bandNm,
    };
}

/**
 * The spectrum view's curves evaluated at `intervals` + 1 frequencies even
 * from `lowOmega` to `highOmega`, rad/fs, drawn against wavelength.
 */
function evaluatedCurves(spectrumAt, [lowOmega, highOmega], intervals, bandNm) {
    const x = Array.from({ length: intervals + 1 },
        (_, index) => wavelengthFromOmega(lowOmega + (highOmega - lowOmega) * index / intervals));
    const points = x.map(spectrumAt);
    const of = read => ({ x, y: points.map(read) });
    return {
        input: of(point => point.input),
        output: of(point => point.output),
        coatingGddFs2: of(point => point.responseGddFs2),
        // The GDD that would undo the input's own chirp, to read against the
        // response's: where the two lie on each other across the spectrum, the
        // net GDD is zero and the pulse comes out compressed.
        compensatingGddFs2: of(point => -point.inputGddFs2),
        bandNm,
    };
}

function plainMetrics(metrics) {
    return {
        flpFwhmFs: metrics.flp.fwhmFs,
        inputFwhmFs: metrics.input.fwhmFs,
        outputFwhmFs: metrics.output.fwhmFs,
        outputRmsFs: metrics.output.rmsFs,
        peakVsFlp: metrics.peakVsFlp,
        transformLimitedRatio: metrics.output.transformLimitedRatio,
        energyRatio: metrics.energyRatio,
        delayFs: metrics.delayFs,
        residualGddFs2: metrics.output.residual.gddFs2,
        residualTodFs3: metrics.output.residual.todFs3,
        inputBandwidthNm: metrics.input.bandwidth.fwhmNm,
        outputBandwidthNm: metrics.output.bandwidth.fwhmNm,
        outputTimeBandwidth: metrics.output.timeBandwidth,
    };
}

/**
 * Time between the pulse and its first echo through the whole part: the
 * substrate's group delay there and back, at the carrier.
 */
function echoDelayFs(design, { thetaDeg }, centerWavelengthNm) {
    const resolve = designMaterialLookup(design);
    const transit = evaluateSubstratePropagation({
        wavelengthNm: centerWavelengthNm,
        thicknessMm: design.substrate?.thickness ?? 1,
        thetaDeg,
        incidentMaterial: resolve(design.incidentMedium),
        substrateMaterial: resolve(design.substrate?.material),
    });
    return transit.valid ? 2 * transit.gdFs : NaN;
}

/**
 * Whether the input's own chirp changes its shape: whether, anywhere, it
 * departs from the Fourier-limited pulse by more than TIME_FLOOR of that
 * pulse's peak. A phase that is constant or linear in ω only sets the pulse's
 * phase and time origin and leaves it on the Fourier-limited pulse.
 */
function isChirped(result, scale) {
    for (let index = 0; index < result.time.length; index++) {
        if (Math.abs(result.inputIntensity[index] - result.flpIntensity[index]) * scale > TIME_FLOOR) return true;
    }
    return false;
}

/**
 * @param {object} design
 * @param {object} request  { pulse, side, target, polarization, thetaDeg, passes }
 */
export function computePulseAnalysis(design, request) {
    const { pulse, side, target, polarization, thetaDeg, passes } = request;
    const responses = createCoatingResponses(design, { side, target, polarization, thetaDeg });
    const result = propagatePulse({ pulse, responses, passes });
    if (!result.valid) return { valid: false, reason: result.reason, detail: result.detail ?? null };
    const metrics = result.metrics;
    const scale = 1 / metrics.flp.peak;
    return {
        valid: true,
        converged: result.converged,
        chirped: isChirped(result, scale),
        time: {
            flp: timeCurve(result.time, result.flpIntensity, scale, 0),
            input: timeCurve(result.time, result.inputIntensity, scale, 0),
            // At its absolute delay; the window subtracts the delay to overlay it.
            output: timeCurve(result.time, result.outputIntensity, scale, result.referenceDelayFs),
        },
        spectrum: spectrumCurves(result, passes),
        metrics: plainMetrics(metrics),
        echoDelayFs: side === 'whole' ? echoDelayFs(design, request, pulse.centerWavelengthNm) : null,
    };
}
