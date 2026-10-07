/**
 * What the Pulse Analysis window draws and reports, computed from a design and
 * the window's settings. Pure and free of the DOM, so it runs in the analysis
 * worker; it returns plain arrays and numbers that cross to the window as they
 * are.
 *
 * Intensities in time are scaled so the Fourier-limited pulse peaks at 1, which
 * makes a lost peak read directly. Spectral
 * intensities are scaled so the input peaks at 1, so the output spectrum shows
 * the reflectance or transmittance it lost.
 */

import { createCoatingResponses, propagatePulse } from '../../../../utils/physics/pulsePropagation.js';
import { evaluateSubstratePropagation } from '../../../../utils/physics/phaseDispersion.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';

// The spectrum view draws, and the material-range notice checks, the band where
// the input carries at least this fraction of its peak spectral intensity:
// below it nothing shows on a linear plot or moves a reported number.
const DISPLAY_FLOOR = 1e-3;
// The time view keeps the samples where a curve is above this fraction of the
// Fourier-limited peak, which is below the plot's line width.
const TIME_FLOOR = 1e-4;
// Most samples one drawn curve carries. A transform can hold a million; the
// plot needs a few thousand, and the readout is computed on the full set.
const MAX_DRAWN_POINTS = 4000;

/** The pulse the core reads, from the window's settings. */
export function pulseFromSettings(settings) {
    const fromFile = settings.source === 'file';
    return {
        shape: fromFile ? 'table' : settings.shape,
        centerWavelengthNm: settings.centerWavelength,
        durationFs: settings.duration,
        bandwidthNm: settings.bandwidth,
        order: settings.order,
        table: fromFile ? settings.spectrumFile?.table : undefined,
        gddFs2: settings.gdd || 0,
        todFs3: settings.tod || 0,
    };
}

function strided(length, keep) {
    const indices = [];
    for (let index = 0; index < length; index++) if (keep(index)) indices.push(index);
    const stride = Math.max(1, Math.ceil(indices.length / MAX_DRAWN_POINTS));
    return indices.filter((_, position) => position % stride === 0);
}

/** One curve in time: the samples above the floor, thinned for drawing. */
function timeCurve(time, intensity, scale, offset) {
    let first = 0;
    let last = intensity.length - 1;
    while (first < last && intensity[first] * scale < TIME_FLOOR) first++;
    while (last > first && intensity[last] * scale < TIME_FLOOR) last--;
    const indices = strided(intensity.length, index => index >= first && index <= last);
    return {
        t: indices.map(index => time[index] + offset),
        y: indices.map(index => intensity[index] * scale),
    };
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

function spectrumCurves(band, passes) {
    const inputPower = Array.from(band.input.re, (re, index) => re * re + band.input.im[index] ** 2);
    const peak = Math.max(...inputPower);
    const indices = strided(inputPower.length, index => inputPower[index] >= DISPLAY_FLOOR * peak);
    const outputPower = index => meanOverChannels(band.outputs, index,
        (channel, at) => channel.re[at] ** 2 + channel.im[at] ** 2);
    const coatingGdd = index => meanOverChannels(band.responses, index,
        (channel, at) => (channel[at].valid ? passes * channel[at].gddFs2 : NaN));
    const wavelengthNm = indices.map(index => band.wavelengthNm[index]);
    return {
        wavelengthNm,
        input: indices.map(index => inputPower[index] / peak),
        output: indices.map(index => outputPower(index) / peak),
        coatingGddFs2: indices.map(coatingGdd),
        // The GDD that would undo the input's own chirp, to read against the
        // coating's: where the two curves meet, the pulse comes out compressed.
        compensatingGddFs2: indices.map(index => -band.inputGddFs2[index]),
        bandNm: wavelengthNm.length
            ? [Math.min(...wavelengthNm), Math.max(...wavelengthNm)]
            : null,
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

/** Whether the pulse carries a phase of its own, so its input differs from its FLP. */
function isChirped(pulse) {
    return Boolean(pulse.gddFs2 || pulse.todFs3)
        || (pulse.shape === 'table' && (pulse.table.phaseRad || []).some(Boolean));
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
        guardEnergy: result.guardEnergy,
        windowFs: result.windowFs,
        chirped: isChirped(pulse),
        time: {
            flp: timeCurve(result.time, result.flpIntensity, scale, 0),
            input: timeCurve(result.time, result.inputIntensity, scale, 0),
            // At its absolute delay; the window subtracts the delay to overlay it.
            output: timeCurve(result.time, result.outputIntensity, scale, result.referenceDelayFs),
        },
        spectrum: spectrumCurves(result.band, passes),
        metrics: plainMetrics(metrics),
        echoDelayFs: side === 'whole' ? echoDelayFs(design, request, pulse.centerWavelengthNm) : null,
    };
}
