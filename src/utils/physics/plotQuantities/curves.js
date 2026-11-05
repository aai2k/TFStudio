/**
 * 2D curves: two quantities read along one sweep, one on x and one on y.
 *
 * The sweep runs the wavelength, the angle of incidence, or one front layer's
 * thickness (axisVars.js tokens) over a range, the other parameters held at the
 * curve's fixed λ and AOI. Each axis is a quantity (quantities.js) with the
 * polarization and side it is read in. The swept value itself on x
 * draws the ordinary curve against λ, AOI or the layer thickness; a quantity on
 * x draws one quantity against another, as a Ψ-Δ trajectory over a thickness.
 * See the Curve spec in plotQuantities.js.
 */

import { buildLambdaGrid } from '../thinFilmMath.js';
import { parseAxisVar } from './axisVars.js';
import { CurveError, curveReader } from './curveFamilies.js';
import { SWEEP } from './quantities.js';

export const POLARIZATIONS = ['avg', 's', 'p'];
export const SURFACE_MODES = ['front', 'back', 'total'];
export const DASHES = ['solid', 'dot', 'dash', 'dashdot'];

/** The step a curve along λ starts with, nm. */
export const LAMBDA_STEP_NM = 0.5;

const CURVE_COLORS = [
    '#4fc3f7', '#ef5350', '#66bb6a', '#ffb74d', '#ba68c8',
    '#81c784', '#ff8a65', '#7986cb', '#a1887f', '#90a4ae',
];

let _curveSeq = 1;

/**
 * A curve in the current shape. A curve kept from a version that drew T, R or
 * A against λ or AOI, { xAxis, yChannel, polarization, surfaceMode }, becomes
 * the same curve: the swept value on x and the channel on y, both in its
 * polarization and on its side. An axis already in the current shape is kept,
 * and a curve with both is returned as it is.
 */
export function normalizeCurve(curve) {
    if (!curve || (curve.x && curve.y)) return curve;
    const { xAxis, yChannel, polarization = 'avg', surfaceMode = 'front', ...rest } = curve;
    const axis = quantity => ({ quantity, polarization, side: surfaceMode });
    return {
        ...rest, sweep: xAxis || rest.sweep || 'wavelength',
        x: rest.x || axis(SWEEP), y: rest.y || axis(yChannel || 'T'),
    };
}

/**
 * Build a default new curve: T against wavelength, in a colour from the
 * rotating palette.
 *
 * @param {object}   [defaults]          fields to merge in, in either shape
 *                                       normalizeCurve reads; `surfaceMode`
 *                                       alone sets the side of both axes
 * @param {string[]} [defaults.palette]  colours to rotate through; consumed
 *                                       here rather than merged into the curve
 * @param {function} [defaults.nameCurve] (quantity, n) → the new curve's name,
 *                                       in the UI language; also consumed here
 */
export function makeDefaultCurve(defaults = {}) {
    const { palette = CURVE_COLORS, nameCurve = (quantity, n) => `${quantity} ${n}`, ...fields } = defaults;
    const idx = _curveSeq++;
    const curve = normalizeCurve({
        id: `curve_${idx}`,
        sweep: 'wavelength',
        lambdaFixed_nm: 550,
        aoiFixed_deg:   0,
        rangeFrom: 400,
        rangeTo:   800,
        rangeStep: LAMBDA_STEP_NM,
        color: palette[(idx - 1) % palette.length],
        dash: 'solid',
        width: 2,
        visible: true,
        ...fields,
    });
    return { label: nameCurve(curve.y.quantity, idx), ...curve };
}

/** The number makeDefaultCurve gave a curve, which its default name carries; NaN for any other id. */
export function curveNumber(curve) {
    return Number(/^curve_(\d+)$/.exec(curve.id)?.[1]);
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

/** The sample points of a curve's range, or none when it has no finite count. */
export function xSamples(curve) {
    const grid = sampling(curve);
    return grid ? Array.from({ length: grid.count }, (_, i) => sampleAt(grid, i)) : [];
}

/**
 * A curve's sweep: its token, the kind of value it sweeps ('lambda', 'aoi' or
 * 'thk'), and its values. A wavelength sweep's values are the grid
 * the spectrum computes on between the first and last sample, and it carries
 * that range. Null when the range has no finite count.
 */
export function curveSweep(curve) {
    const grid = sampling(curve);
    if (!grid) return null;
    const { kind } = parseAxisVar(curve.sweep);
    if (kind !== 'lambda') return { token: curve.sweep, kind, values: xSamples(curve) };
    const range = { lambdaStart: sampleAt(grid, 0), lambdaEnd: sampleAt(grid, grid.count - 1), lambdaStep: grid.step };
    return { token: curve.sweep, kind, range, values: buildLambdaGrid(range.lambdaStart, range.lambdaEnd, range.lambdaStep) };
}

/**
 * Compute one curve's (x, y) arrays.
 *
 * Caller supplies the design and its resolved stack so this helper stays pure
 * and testable. A curve along λ or AOI that reads T, R or A needs the stack
 * alone; the other quantities and a layer sweep read the design.
 *
 * @param {object} curve  in either shape normalizeCurve reads
 * @param {{ design, resolveMat, incMat, subMat, exitMat, frontLayers, backLayers, subThickness_mm, cone }} ctx
 * @returns {{ x:number[], y:number[], errorKey?:string }}  `errorKey`, a
 *          t.plotEngine key, says why a curve that cannot be drawn is empty
 */
export function computeCurve(curve, ctx) {
    const current = normalizeCurve(curve);
    const sweep = current && ctx ? curveSweep(current) : null;
    if (!sweep) return { x: [], y: [] };
    try {
        const read = curveReader(current, ctx, sweep);
        return { x: read(current.x), y: read(current.y) };
    } catch (error) {
        if (error instanceof CurveError) return { x: [], y: [], errorKey: error.errorKey };
        throw error;
    }
}

// ── Axis units / labels ──────────────────────────────────────────────────────

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
