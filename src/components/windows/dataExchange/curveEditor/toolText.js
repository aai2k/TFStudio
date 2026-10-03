/**
 * What the curve editor's tool panels say: which cells a tool will act on, a
 * preview of what it will write, why it cannot run yet, and the count its
 * button names. Each function returns
 *
 *   { title, preview, problem, run, ready }
 *
 *   title    the sentence over the panel, naming the cells
 *   preview  what the tool will write, or null
 *   problem  { text, tone } or null; tone 'hint' for a number not typed yet,
 *            'error' for one the tool cannot use
 *   run      the button's label
 *   ready    false while the button would do nothing
 *
 * Each takes `ce` (t.curveEditor), `labels` (editorLabels.js), the table and
 * the selected cells in table order (editorActions.js selectedOf) with the
 * tool's numbers as its panel holds them.
 */
import { changeProblem, changedValue, fillProblem, fillSeries } from './cellOps.js';
import { MAX_RESAMPLED_ROWS, resamplePlan, smoothingProblem } from './curveOps.js';
import { X_KEY, cellText, columnIndex, columnKeys, tidy } from './curveTable.js';

/** The fill tool's numbers as cellOps.js fillCells takes them. */
export function fillOptions(fill) {
    if (fill.mode === 'constant') return { mode: fill.mode, a: fill.value };
    return { mode: fill.mode, a: fill.first, b: fill.mode === 'step' ? fill.step : fill.last };
}

/** The change tool's numbers as cellOps.js changeCells takes them. */
export function changeOptions(change) {
    if (change.mode === 'percent') return { mode: 'percent', a: change.percent };
    return { mode: 'linear', a: change.a, b: change.b };
}

// The numbers each fill takes, so that a field left empty reads as a hint and
// not as a number the fill cannot use: an empty log step is not yet wrong.
const FILL_NUMBERS = { constant: ['a'], step: ['a', 'b'], log: ['a', 'b'], wavenumber: ['a', 'b'] };
const fillIncomplete = options => FILL_NUMBERS[options.mode].some(key => options[key] == null);

// The keys of the columns the cells lie in, in table order.
function coveredKeys(table, cells) {
    const keys = new Set(cells.map(cell => cell.colKey));
    return columnKeys(table).filter(key => keys.has(key));
}

const namesOf = (labels, keys) => keys.map(labels.columnTitle).join(', ');

/**
 * Values as a short line: all of them up to four, else the first three, an
 * ellipsis and the last, 400, 410, 420 … 450.
 */
export function seriesText(values) {
    const texts = values.map(cellText);
    if (texts.length <= 4) return texts.join(', ');
    return `${texts.slice(0, 3).join(', ')} … ${texts[texts.length - 1]}`;
}

function waiting(title, run, problem = null) {
    return { title, preview: null, problem, run, ready: false };
}

/** The Fill panel. The preview is what the first selected column will hold. */
export function fillText(ce, labels, table, cells, fill) {
    const text = ce.panels.fill;
    const run = text.run(cells.length);
    if (!cells.length) return waiting(ce.panels.selectFirst, run);
    const keys = coveredKeys(table, cells);
    const title = text.title(cells.length, namesOf(labels, keys));
    const options = fillOptions(fill);
    if (fillIncomplete(options)) return waiting(title, run, { text: ce.fillProblems.number, tone: 'hint' });
    const problem = fillProblem(options);
    if (problem) return waiting(title, run, { text: ce.fillProblems[problem], tone: 'error' });
    const count = cells.filter(cell => cell.colKey === keys[0]).length;
    return { title, preview: seriesText(fillSeries(options, count)), problem: null, run, ready: true };
}

/** The Change panel. Empty cells stay empty, so it counts the numbers; the preview is the first one changed. */
export function changeText(ce, labels, table, cells, change) {
    const text = ce.panels.change;
    const numberAt = cell => table.rows[cell.rowIdx]?.[columnIndex(cell.colKey)];
    const valued = cells.filter(cell => Number.isFinite(numberAt(cell)));
    const run = text.run(valued.length);
    if (!cells.length) return waiting(ce.panels.selectFirst, run);
    if (!valued.length) return waiting(text.noValues, run);
    const title = text.title(valued.length, namesOf(labels, coveredKeys(table, cells)));
    const options = changeOptions(change);
    if (changeProblem(options)) return waiting(title, run, { text: ce.changeProblem, tone: 'hint' });
    const first = numberAt(valued[0]);
    const preview = text.preview(cellText(first), cellText(changedValue(options, first)));
    return { title, preview, problem: null, run, ready: true };
}

// What the Smooth panel says it smooths: one cell stands for its whole
// column, and the wavelength column is never smoothed (curveOps.js).
function smoothTitle(text, labels, table, cells) {
    const values = cells.filter(cell => cell.colKey !== X_KEY);
    if (cells.length === 1) return text.whole(labels.columnTitle(values[0].colKey));
    const rows = values.map(cell => cell.rowIdx + 1);
    return text.title(namesOf(labels, coveredKeys(table, values)), Math.min(...rows), Math.max(...rows));
}

/** The Smooth panel. */
export function smoothText(ce, labels, table, cells, smooth) {
    const text = ce.panels.smooth;
    if (!cells.length) return waiting(ce.panels.selectFirst, text.run);
    if (cells.every(cell => cell.colKey === X_KEY)) return waiting(text.wavelength, text.run);
    const title = smoothTitle(text, labels, table, cells);
    const problem = smoothingProblem(table, cells, smooth);
    if (!problem) return { title, preview: null, problem: null, run: text.run, ready: true };
    const reason = problem === 'points' ? text.tooFew(smooth.window) : ce.smoothProblems[problem];
    return waiting(title, text.run, { text: reason, tone: 'error' });
}

function resampleProblemText(ce, problem) {
    return problem === 'rows' ? ce.resampleProblems.rows(MAX_RESAMPLED_ROWS) : ce.resampleProblems[problem];
}

/**
 * The Resample panel: the grid `step` makes, in the wavelength column's unit.
 * It acts on every column, so it takes no cells and has no title.
 */
export function resampleText(ce, labels, table, step) {
    const text = ce.panels.resample;
    const plan = resamplePlan(table, step);
    if (plan.problem) return waiting(null, text.idle, { text: resampleProblemText(ce, plan.problem), tone: 'error' });
    const first = cellText(tidy(plan.first * step));
    const last = cellText(tidy((plan.first + plan.rowCount - 1) * step));
    const preview = text.plan(first, last, labels.xUnit(table.xUnit), plan.rowCount);
    return { title: null, preview, problem: null, run: text.run(plan.rowCount), ready: true };
}
