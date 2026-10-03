/**
 * The table a curve editor holds: a wavelength column and one or more value
 * columns, as typed.
 *
 *   {
 *     kind:    'spectrum' | 'ellipsometry' | 'weight'
 *     xUnit:   the wavelength column's unit, an X_UNITS id
 *     columns: [{ quantity, unit, name }], one per value column
 *     rows:    [[x, v0, v1, ...]], numbers, NaN for an empty cell
 *     fixed:   true when the columns cannot be added, removed or retyped:
 *              an existing curve, or an Integral Values weighting
 *     source:  the file the table was read from, if it was
 *   }
 *
 * A cell is addressed by its row index and a column key: 'x' for the
 * wavelength, 'v0', 'v1', ... for the value columns. Every function here
 * returns a new table and leaves the one it was given alone; rows that are
 * not changed are shared between the two, so an undo history of a long table
 * costs one row array per edit rather than a copy of the table.
 */
import { X_UNITS } from '../../../../utils/io/spectrumTable.js';
import { createGridModel } from '../../../ui/grid/gridModel.js';
import { KIND_QUANTITIES, fromStored, unitForQuantity, unitsFor } from './units.js';

// The rows a new table opens with, enough to type a short curve into without
// first adding any.
const NEW_TABLE_ROWS = 10;

export const X_KEY = 'x';

/** The key of value column `index`. */
export function valueKey(index) {
    return `v${index}`;
}

/** The position of a column key in a row. */
export function columnIndex(colKey) {
    return colKey === X_KEY ? 0 : Number(colKey.slice(1)) + 1;
}

/** The keys of every column, wavelength first. */
export function columnKeys(table) {
    return [X_KEY, ...table.columns.map((_, index) => valueKey(index))];
}

// The grid model for each column count; the keys depend on nothing else.
const GRIDS = new Map();

/** The shared spreadsheet model (ui/grid/gridModel.js) over a table's columns. */
export function gridFor(table) {
    const count = table.columns.length;
    if (!GRIDS.has(count)) GRIDS.set(count, createGridModel(columnKeys(table)));
    return GRIDS.get(count);
}

/** The value column a key names, or null for the wavelength column. */
export function columnOf(table, colKey) {
    return colKey === X_KEY ? null : table.columns[columnIndex(colKey) - 1] || null;
}

export function emptyRow(table) {
    return new Array(table.columns.length + 1).fill(NaN);
}

/** A column of the kind's first quantity in its default unit. */
export function newColumn(kind, quantity = KIND_QUANTITIES[kind][0]) {
    return { quantity, unit: unitsFor(quantity)[0], name: '' };
}

/** An empty table for a new curve of `kind`; Ψ and Δ come as a pair. */
export function emptyTable(kind) {
    const quantities = kind === 'ellipsometry' ? KIND_QUANTITIES.ellipsometry : [KIND_QUANTITIES[kind][0]];
    const table = {
        kind, xUnit: X_UNITS.NM, columns: quantities.map(quantity => newColumn(kind, quantity)),
        rows: [], fixed: kind === 'weight',
    };
    return { ...table, rows: Array.from({ length: NEW_TABLE_ROWS }, () => emptyRow(table)) };
}

// A stored value in a unit that rescales it, cut to fifteen significant digits
// so the binary rounding of the rescale does not show: a value read from a file
// as 12.3 % is stored as 12.3/100 and comes back as 12.3.
function shownValue(value, unit) {
    const shown = fromStored(value, unit);
    return unit === '%' && Number.isFinite(shown) ? Number(shown.toPrecision(15)) : shown;
}

/**
 * The table an existing curve opens as: its wavelengths in nm, which is how
 * they are stored, and its values in the scale it was read in, percent for a
 * curve whose file held percent. Opening and applying with no edit gives the
 * curve back as it was.
 */
export function tableFromCurve(curve, kind) {
    const unit = kind === 'ellipsometry' ? 'deg' : (curve.yWasPercent ? '%' : 'fraction');
    const column = { quantity: curve.quantity, unit, name: curve.name || '' };
    const count = Math.min(curve.x?.length || 0, curve.y?.length || 0);
    const rows = [];
    for (let index = 0; index < count; index++) rows.push([curve.x[index], shownValue(curve.y[index], unit)]);
    return { kind, xUnit: X_UNITS.NM, columns: [column], rows, fixed: true, source: curve.source };
}

/** An Integral Values source or detector table, [[λ nm, weight]], as an editor table. */
export function tableFromWeights(weights) {
    const rows = (weights || []).map(row => [Number(row[0]), Number(row[1])]);
    const table = { kind: 'weight', xUnit: X_UNITS.NM, columns: [newColumn('weight')], rows, fixed: true };
    return rows.length ? table : emptyTable('weight');
}

function withRows(table, rows) {
    return rows === table.rows ? table : { ...table, rows };
}

/**
 * Set cells to numbers: `cells` is [{ rowIdx, colKey, value }]. A cell past
 * the last row is skipped. Each changed row is copied once however many of
 * its cells change.
 */
export function setCells(table, cells) {
    if (!cells.length) return table;
    const rows = table.rows.slice();
    const copied = new Set();
    for (const { rowIdx, colKey, value } of cells) {
        if (!rows[rowIdx]) continue;
        if (!copied.has(rowIdx)) { rows[rowIdx] = rows[rowIdx].slice(); copied.add(rowIdx); }
        rows[rowIdx][columnIndex(colKey)] = value;
    }
    return withRows(table, rows);
}

/** Empty the given cells, [{ rowIdx, colKey }]. */
export function clearCells(table, cells) {
    return setCells(table, cells.map(cell => ({ ...cell, value: NaN })));
}

/** `count` empty rows inserted before row `at`. */
export function insertRows(table, at, count = 1) {
    const rows = table.rows.slice();
    const index = Math.max(0, Math.min(at, rows.length));
    rows.splice(index, 0, ...Array.from({ length: Math.max(1, count) }, () => emptyRow(table)));
    return withRows(table, rows);
}

/** The table without the rows whose indices are in `rowIdxs`. */
export function deleteRows(table, rowIdxs) {
    const drop = new Set(rowIdxs);
    return withRows(table, table.rows.filter((_, index) => !drop.has(index)));
}

/** The table grown with empty rows until it has `count` of them. */
export function withRowCount(table, count) {
    if (table.rows.length >= count) return table;
    const added = Array.from({ length: count - table.rows.length }, () => emptyRow(table));
    return withRows(table, [...table.rows, ...added]);
}

/** A value column added after the last, of the last column's quantity and unit. */
export function addColumn(table) {
    const last = table.columns[table.columns.length - 1];
    const column = last ? { ...last, name: '' } : newColumn(table.kind);
    return {
        ...table,
        columns: [...table.columns, column],
        rows: table.rows.map(row => [...row, NaN]),
    };
}

/** The table without value column `index`; the last one stays. */
export function removeColumn(table, index) {
    if (table.columns.length <= 1) return table;
    return {
        ...table,
        columns: table.columns.filter((_, at) => at !== index),
        rows: table.rows.map(row => row.filter((_, at) => at !== index + 1)),
    };
}

/** Value column `index` with `patch` applied; a new quantity keeps the unit it can. */
export function setColumn(table, index, patch) {
    const columns = table.columns.map((column, at) => {
        if (at !== index) return column;
        const next = { ...column, ...patch };
        return { ...next, unit: unitForQuantity(next.quantity, next.unit) };
    });
    return { ...table, columns };
}

export function setXUnit(table, xUnit) {
    return { ...table, xUnit };
}

/**
 * The rows in ascending wavelength. A row with no wavelength goes last, and
 * rows of equal wavelength keep their order.
 */
export function sortedRows(rows) {
    const keyed = rows.map((row, index) => ({ row, index, x: Number.isFinite(row[0]) ? row[0] : Infinity }));
    keyed.sort((a, b) => a.x - b.x || a.index - b.index);
    return keyed.map(entry => entry.row);
}

/**
 * A computed value kept to twelve significant digits, so a step of 0.1 writes
 * 0.3 and not the 0.30000000000000004 binary arithmetic produces.
 */
export function tidy(value) {
    return Number(value.toPrecision(12));
}

/** The text a cell shows and copies: the number as typed, or nothing. */
export function cellText(value) {
    return Number.isFinite(value) ? String(value) : '';
}

/**
 * The rows of value column `index` that hold both a wavelength and a value,
 * as { x, y, rows } in table order; `rows` are their indices in the table.
 */
export function columnSeries(table, index) {
    const series = { x: [], y: [], rows: [] };
    table.rows.forEach((row, rowIdx) => {
        if (!Number.isFinite(row[0]) || !Number.isFinite(row[index + 1])) return;
        series.x.push(row[0]);
        series.y.push(row[index + 1]);
        series.rows.push(rowIdx);
    });
    return series;
}
