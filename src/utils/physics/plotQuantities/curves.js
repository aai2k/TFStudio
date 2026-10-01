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
 * @param {object}   [defaults]          optional fields to merge in (e.g.
 *                                       surfaceMode from the active design's
 *                                       evalMode)
 * @param {string[]} [defaults.palette]  colours to rotate through; consumed
 *                                       here rather than merged into the curve
 */
export function makeDefaultCurve(defaults = {}) {
    const { palette = CURVE_COLORS, ...fields } = defaults;
    const idx = _curveSeq++;
    const color = palette[(idx - 1) % palette.length];
    return {
        id: `curve_${idx}`,
        label: `${fields.yChannel || 'T'} curve ${idx}`,
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
        ...fields,
    };
}

// A curve's samples as their first value, step and count: from the lower end of
// its range to the upper in steps of `rangeStep`, every one of them. Counted
// rather than accumulated, so a step too small to move a large value still
// ends; null when the count is not finite.
function sampling(curve) {
    const { rangeFrom, rangeTo, rangeStep } = curve;
    const first = Math.min(rangeFrom, rangeTo);
    const step = Math.abs(rangeStep) || 1;
    const span = (Math.max(rangeFrom, rangeTo) - first) / step;
    if (!Number.isFinite(span)) return null;
    return { first, step, count: Math.floor(span + 1e-9 * Math.max(1, span)) + 1 };
}

// Twelve significant figures drop the binary noise of first + i·step and keep
// any step the range is typed with.
const sampleAt = ({ first, step }, i) => Number((first + i * step).toPrecision(12));

/** The x-axis sample points for a curve, or none when its range has no finite count. */
export function xSamples(curve) {
    const grid = sampling(curve);
    return grid ? Array.from({ length: grid.count }, (_, i) => sampleAt(grid, i)) : [];
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
    const grid = sampling(curve);
    // Without a range the spectrum would fall back to its default one.
    if (!grid) return { x: [], y: [] };

    if (curve.xAxis === 'wavelength') {
        // Sweep λ; AOI fixed. The spectrum builds its own grid between the ends.
        const params = {
            lambdaStart: sampleAt(grid, 0),
            lambdaEnd:   sampleAt(grid, grid.count - 1),
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
        const x = xSamples(curve);
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
