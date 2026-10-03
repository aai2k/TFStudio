/**
 * Filling and changing selected cells, as OptiLayer's Column Editor and Grid
 * Generator do it.
 *
 * Fill writes a series down each selected column, top to bottom:
 *   constant    every cell a
 *   step        a, a + b, a + 2b, ...
 *   log         from a to b in equal ratios
 *   wavenumber  from a to b in equal steps of 1/V, so a wavelength column is
 *               spaced evenly in wavenumber
 * Change rewrites the values already there: by a percentage, V' = V(1 + p/100),
 * or by V' = a·V + b. An empty cell stays empty. Results go through `tidy`.
 */
import { columnIndex, setCells, tidy } from './curveTable.js';

const FILLS = {
    constant: a => () => a,
    step: (a, b) => index => a + index * b,
    log: (a, b, count) => index => (count > 1 ? a * (b / a) ** (index / (count - 1)) : a),
    wavenumber: (a, b, count) => index =>
        (count > 1 ? 1 / (1 / a + (index / (count - 1)) * (1 / b - 1 / a)) : a),
};

const bothPositive = (a, b) => a > 0 && b > 0;
const FILL_CHECKS = {
    constant: a => Number.isFinite(a),
    step: (a, b) => Number.isFinite(a) && Number.isFinite(b),
    log: bothPositive,
    wavenumber: bothPositive,
};

/** Why a fill cannot run with these numbers, or null. Log and wavenumber steps need a and b above zero. */
export function fillProblem({ mode, a, b }) {
    const check = FILL_CHECKS[mode];
    if (!check) return 'mode';
    return check(a, b) ? null : (mode === 'log' || mode === 'wavenumber' ? 'positive' : 'number');
}

// The selected cells grouped by column, each column's rows in table order.
function cellsByColumn(cells) {
    const columns = new Map();
    for (const cell of cells) {
        if (!columns.has(cell.colKey)) columns.set(cell.colKey, []);
        columns.get(cell.colKey).push(cell.rowIdx);
    }
    for (const rows of columns.values()) rows.sort((x, y) => x - y);
    return columns;
}

/** The table with each selected column filled by `mode`; see the top of the file. */
export function fillCells(table, cells, options) {
    if (fillProblem(options)) return table;
    const edits = [];
    for (const [colKey, rows] of cellsByColumn(cells)) {
        const valueAt = FILLS[options.mode](options.a, options.b, rows.length);
        rows.forEach((rowIdx, index) => edits.push({ rowIdx, colKey, value: tidy(valueAt(index)) }));
    }
    return setCells(table, edits);
}

const CHANGES = {
    percent: a => value => value * (1 + a / 100),
    linear: (a, b) => value => a * value + b,
};

/** Why a change cannot run with these numbers, or null. */
export function changeProblem({ mode, a, b }) {
    if (!CHANGES[mode]) return 'mode';
    const numbers = mode === 'percent' ? [a] : [a, b];
    return numbers.every(Number.isFinite) ? null : 'number';
}

/** The table with the values in the selected cells changed; empty cells stay empty. */
export function changeCells(table, cells, options) {
    if (changeProblem(options)) return table;
    const change = CHANGES[options.mode](options.a, options.b);
    const edits = [];
    for (const { rowIdx, colKey } of cells) {
        const value = table.rows[rowIdx]?.[columnIndex(colKey)];
        if (Number.isFinite(value)) edits.push({ rowIdx, colKey, value: tidy(change(value)) });
    }
    return setCells(table, edits);
}
