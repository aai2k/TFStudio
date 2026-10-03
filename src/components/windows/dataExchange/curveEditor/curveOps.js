/**
 * Operations on whole curves of a curve editor table: resampling every column
 * onto an even step, and smoothing selected values.
 *
 * Both work in the units the table is typed in. Resampling is the Fit
 * dialogs' own (measuredSampling.js, shape-preserving PCHIP), with Δ
 * interpolated as an unwrapped angle as its fit does (measuredEllipsometry/
 * fitModel.js); it adds no information, and a step finer than the points'
 * spacing is reported the way the Fit dialogs report it. Smoothing is
 * Savitzky-Golay (utils/math/savitzkyGolay.js).
 */
import { measuredCurveSpacing, sampleMeasuredCurve } from '../../../../utils/io/spectrumTable.js';
import { savitzkyGolayProblem, smoothSavitzkyGolay } from '../../../../utils/math/savitzkyGolay.js';
import { sampleDeltaCurve, unwrappedDegrees } from '../measuredEllipsometry/fitModel.js';
import { X_KEY, columnIndex, columnSeries, setCells, tidy } from './curveTable.js';

// Every row of a table is an array of its own, and a table of tens of millions
// of rows takes gigabytes before it can be drawn. A million rows is a 0.01 nm
// grid over 200-10000 nm, finer than any spectrophotometer reads.
export const MAX_RESAMPLED_ROWS = 1000000;

// A column's complete rows in ascending wavelength.
function sortedSeries(table, index) {
    const series = columnSeries(table, index);
    const order = series.x.map((_, at) => at).sort((a, b) => series.x[a] - series.x[b]);
    return {
        x: order.map(at => series.x[at]),
        y: order.map(at => series.y[at]),
        rows: order.map(at => series.rows[at]),
    };
}

// Grid points are whole multiples of the step, so a 1 nm grid lands on whole
// nanometres whatever wavelength the first point was typed at.
const firstMultiple = (value, step) => Math.ceil(value / step - 1e-9);
const lastMultiple = (value, step) => Math.floor(value / step + 1e-9);

function finerThan(step, spacings) {
    const finer = spacings.filter(spacing => Number.isFinite(spacing) && step < spacing - 1e-9);
    return finer.length ? Math.min(...finer) : null;
}

/**
 * What resampling onto `step` would make: the grid's rows, the spacing of the
 * points it is finer than (null when it is not), and why it cannot run, or
 * null. 'step' is a step that is not above zero, 'points' a table with no
 * column of two points, 'rows' a grid of more than MAX_RESAMPLED_ROWS.
 */
export function resamplePlan(table, step) {
    if (!(Number.isFinite(step) && step > 0)) return { problem: 'step' };
    const series = table.columns.map((_, index) => sortedSeries(table, index)).filter(s => s.x.length >= 2);
    if (!series.length) return { problem: 'points' };
    const first = firstMultiple(Math.min(...series.map(s => s.x[0])), step);
    const last = lastMultiple(Math.max(...series.map(s => s.x[s.x.length - 1])), step);
    const rowCount = last - first + 1;
    const spacing = finerThan(step, series.map(s => measuredCurveSpacing({ x: s.x, y: s.y })));
    const problem = rowCount > MAX_RESAMPLED_ROWS ? 'rows' : (rowCount < 1 ? 'points' : null);
    return { problem, first, rowCount, spacing };
}

/** The table resampled onto `step`, every column on one grid; see resamplePlan. */
export function resampleTable(table, step) {
    const plan = resamplePlan(table, step);
    if (plan.problem) return { table, problem: plan.problem };
    const rows = Array.from({ length: plan.rowCount }, (_, index) => {
        const row = new Array(table.columns.length + 1).fill(NaN);
        row[0] = tidy((plan.first + index) * step);
        return row;
    });
    table.columns.forEach((column, index) => {
        const series = sortedSeries(table, index);
        if (series.x.length < 2) return;
        const sample = column.quantity === 'DEL' ? sampleDeltaCurve : sampleMeasuredCurve;
        const sampled = sample({ x: series.x, y: series.y }, {
            mode: 'uniform', stepNm: step,
            rangeMin: firstMultiple(series.x[0], step) * step,
            rangeMax: series.x[series.x.length - 1],
        });
        sampled.lambdas.forEach((lambda, at) => {
            const row = rows[Math.round(lambda / step) - plan.first];
            if (row) row[index + 1] = sampled.targets[at];
        });
    });
    return { table: { ...table, rows }, problem: null };
}

// Δ is smoothed as an unwrapped angle, and each point put back on the turn it
// was written on, so a run crossing 360° is not pulled through 180°.
function smoothedValues(series, quantity, window, order) {
    if (quantity !== 'DEL') return smoothSavitzkyGolay(series.x, series.y, window, order);
    const unwrapped = unwrappedDegrees(series.y);
    const smoothed = smoothSavitzkyGolay(series.x, unwrapped, window, order);
    return smoothed.map((value, at) => value - (unwrapped[at] - series.y[at]));
}

// The selected rows of each value column. One cell on its own stands for its
// whole column, there being nothing to smooth in a single point.
function smoothingRows(table, cells) {
    const byColumn = new Map();
    const whole = cells.length === 1;
    for (const { rowIdx, colKey } of cells) {
        if (colKey === X_KEY) continue;
        if (!byColumn.has(colKey)) byColumn.set(colKey, new Set());
        byColumn.get(colKey).add(rowIdx);
    }
    if (whole) for (const rows of byColumn.values()) table.rows.forEach((_, rowIdx) => rows.add(rowIdx));
    return byColumn;
}

/**
 * The selected values smoothed, each column fitted along its own wavelengths.
 * `problem` names the first reason a column was left as it was; see
 * savitzkyGolayProblem.
 */
export function smoothCells(table, cells, { window, order }) {
    let problem = null;
    const edits = [];
    for (const [colKey, rowSet] of smoothingRows(table, cells)) {
        const index = columnIndex(colKey) - 1;
        const all = sortedSeries(table, index);
        const keep = all.rows.map(rowIdx => rowSet.has(rowIdx));
        const series = {
            x: all.x.filter((_, at) => keep[at]), y: all.y.filter((_, at) => keep[at]),
            rows: all.rows.filter((_, at) => keep[at]),
        };
        const reason = savitzkyGolayProblem(series.x.length, window, order);
        if (reason) { problem = problem || reason; continue; }
        const values = smoothedValues(series, table.columns[index].quantity, window, order);
        series.rows.forEach((rowIdx, at) => edits.push({ rowIdx, colKey, value: tidy(values[at]) }));
    }
    return { table: setCells(table, edits), problem };
}
