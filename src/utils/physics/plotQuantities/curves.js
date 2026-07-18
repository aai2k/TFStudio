/**
 * 2D curve family — maps an x-axis quantity (wavelength or angle of
 * incidence) to a y-axis quantity (T, R, A — for any polarization) at fixed
 * values of the non-axis parameters. See the Curve spec in plotQuantities.js.
 */

import { pickChannel, runSpectrum } from './spectrumRunner.js';

export const X_AXES = ['wavelength', 'aoi'];
export const Y_CHANNELS = ['T', 'R', 'A'];
export const POLARIZATIONS = ['avg', 's', 'p'];
export const SURFACE_MODES = ['front', 'back', 'total'];
export const DASHES = ['solid', 'dot', 'dash', 'dashdot'];

const CURVE_COLORS = [
    '#4fc3f7', '#ef5350', '#66bb6a', '#ffb74d', '#ba68c8',
    '#81c784', '#ff8a65', '#7986cb', '#a1887f', '#90a4ae',
];

let _curveSeq = 1;

/**
 * Build a default new curve, populating with sensible defaults and a unique
 * color from the rotating palette.
 *
 * @param {object} [defaults]  optional fields to merge in (e.g. surfaceMode
 *                             from the active design's evalMode)
 */
export function makeDefaultCurve(defaults = {}) {
    const idx = _curveSeq++;
    const color = CURVE_COLORS[(idx - 1) % CURVE_COLORS.length];
    return {
        id: `curve_${idx}`,
        label: `${defaults.yChannel || 'T'} curve ${idx}`,
        xAxis: 'wavelength',
        yChannel: 'T',
        polarization: 'avg',
        surfaceMode: 'front',
        lambdaFixed_nm: 550,
        aoiFixed_deg:   0,
        rangeFrom: 400,
        rangeTo:   800,
        rangeStep: 5,
        color,
        dash: 'solid',
        width: 2,
        visible: true,
        ...defaults,
    };
}

/**
 * Generate the x-axis sample points for a curve (clamped & validated).
 */
export function xSamples(curve) {
    const { rangeFrom, rangeTo, rangeStep } = curve;
    const a = Math.min(rangeFrom, rangeTo);
    const b = Math.max(rangeFrom, rangeTo);
    const s = Math.max(1e-6, Math.abs(rangeStep || 1));
    const out = [];
    for (let v = a; v <= b + 1e-9; v += s) {
        out.push(Math.round(v * 1000) / 1000);
        if (out.length > 50000) break;  // safety cap
    }
    return out;
}

/**
 * Compute one curve's (x, y) arrays.
 *
 * Caller supplies the design state (already resolved materials) so this
 * helper stays pure and testable.
 *
 * @param {object} curve
 * @param {{ incMat, subMat, exitMat, frontLayers, backLayers, subThickness_mm }} ctx
 * @returns {{ x:number[], y:number[] }}
 */
export function computeCurve(curve, ctx) {
    if (!curve || !ctx) return { x: [], y: [] };
    const xs = xSamples(curve);

    if (curve.xAxis === 'wavelength') {
        // Sweep λ; AOI fixed.
        const params = {
            lambdaStart: xs[0],
            lambdaEnd:   xs[xs.length - 1],
            lambdaStep:  curve.rangeStep,
            theta:        curve.aoiFixed_deg,
            polarization: curve.polarization,
        };
        const out = runSpectrum(curve.surfaceMode, params, ctx);
        const y = pickChannel(out, curve.polarization, curve.yChannel);
        return { x: out.lambda, y };
    }

    if (curve.xAxis === 'aoi') {
        // Sweep AOI at fixed λ. We have to call the TMM per-AOI.
        const lam = curve.lambdaFixed_nm;
        const x = xs;
        const y = new Array(x.length);
        for (let i = 0; i < x.length; i++) {
            const params = {
                lambdaStart: lam,
                lambdaEnd:   lam,
                lambdaStep:  1,
                theta:       x[i],
                polarization: curve.polarization,
            };
            const out = runSpectrum(curve.surfaceMode, params, ctx);
            const channel = pickChannel(out, curve.polarization, curve.yChannel);
            y[i] = channel[0];
        }
        return { x, y };
    }

    return { x: [], y: [] };
}

// ── Axis units / labels ──────────────────────────────────────────────────────

export function xAxisLabel(xAxis) {
    if (xAxis === 'aoi') return 'AOI (°)';
    return 'λ (nm)';
}

export function yAxisLabel(yChannels) {
    // Single channel → unit; mixed → generic "Intensity"
    if (!yChannels || yChannels.length === 0) return 'Value';
    const u = yChannels[0];
    if (yChannels.every(c => c === u)) {
        return { T: 'Transmittance', R: 'Reflectance', A: 'Absorptance' }[u] || 'Value';
    }
    return 'T / R / A';
}

/**
 * Suggested numeric formatter for a curve's y values (hover tooltip).
 */
export function yFormatter(yChannel) {
    return (v) => Number.isFinite(v) ? v.toFixed(4) : '—';
}
