/**
 * The spreadsheet model a data table selects, copies and pastes with, keyed by
 * the list of its value columns.
 *
 * A table names the columns a rectangle of cells can span, in table order, and
 * says which of them a row carries: a merit operand has no angle on a
 * thickness row and shows a dash there, while every row of a curve carries
 * every column. The rest is the same for every table: the rectangle between
 * two cells, the cells added with Ctrl, the order cells are copied in, and
 * where a pasted block lands (gridClipboard.js).
 */
import { cellsTextIn, pasteTargetsIn, rangeTextIn } from './gridClipboard.js';

export { parseCellGrid } from './gridClipboard.js';

/** The empty set of cells added with Ctrl. */
export const NO_CELLS = new Set();

/** The key a cell is held under in the set of cells added with Ctrl. */
export function cellKey(rowIdx, colKey) {
    return `${rowIdx}:${colKey}`;
}

function cellFromKey(key) {
    const [row, colKey] = key.split(':');
    return { rowIdx: Number(row), colKey };
}

/** The range's columns when the row lies inside it, otherwise null. */
export function rangeColumnsForRow(range, rowIdx) {
    if (!range || rowIdx < range.rowStart || rowIdx > range.rowEnd) return null;
    return range.colKeys;
}

/**
 * The cell an arrow or Tab moves to from a cell, or null at the table's edge.
 *
 * Up and down keep the column. Left and right walk the columns `columnsOf`
 * gives the row and wrap onto the row above or below; `focus` says whether the
 * move left the row, which a table may treat as a fresh selection.
 */
export function navigationTarget({ rowCount, columnsOf }, fromRowIdx, fromColKey, direction) {
    if (!(fromRowIdx >= 0 && fromRowIdx < rowCount)) return null;
    if (direction === 'down' || direction === 'up') {
        const rowIdx = fromRowIdx + (direction === 'down' ? 1 : -1);
        return rowIdx >= 0 && rowIdx < rowCount ? { rowIdx, colKey: fromColKey, focus: true } : null;
    }
    const columns = columnsOf(fromRowIdx);
    const delta = direction === 'right' ? 1 : -1;
    const columnIndex = columns.indexOf(fromColKey) + delta;
    if (columnIndex >= 0 && columnIndex < columns.length) {
        return { rowIdx: fromRowIdx, colKey: columns[columnIndex], focus: false };
    }
    const rowIdx = fromRowIdx + delta;
    if (rowIdx < 0 || rowIdx >= rowCount) return null;
    const nextColumns = columnsOf(rowIdx);
    const colKey = delta > 0 ? nextColumns[0] : nextColumns[nextColumns.length - 1];
    return { rowIdx, colKey, focus: true };
}

/**
 * The rectangle between the anchor cell and the focused cell, as a row span
 * and the column keys it covers in table order. Null when the two are one and
 * the same cell, or when either lies outside the value columns.
 */
function cellRangeIn(columns, anchor, focus) {
    if (!anchor || !focus) return null;
    if (anchor.rowIdx === focus.rowIdx && anchor.colKey === focus.colKey) return null;
    const a = columns.indexOf(anchor.colKey);
    const f = columns.indexOf(focus.colKey);
    if (a < 0 || f < 0) return null;
    return {
        rowStart: Math.min(anchor.rowIdx, focus.rowIdx),
        rowEnd: Math.max(anchor.rowIdx, focus.rowIdx),
        colKeys: columns.slice(Math.min(a, f), Math.max(a, f) + 1),
    };
}

/**
 * Every selected cell in table order: the rectangle, the cells added with
 * Ctrl, and the focused cell on its own when there is no rectangle. Rows come
 * in order and cells within a row in column order, so copying them writes them
 * the way the table shows them.
 */
function selectedCellsIn(columns, { range, extraCells, focus }) {
    const keys = new Set(extraCells || []);
    if (range) {
        for (let rowIdx = range.rowStart; rowIdx <= range.rowEnd; rowIdx++) {
            for (const colKey of range.colKeys) keys.add(cellKey(rowIdx, colKey));
        }
    } else if (focus) {
        keys.add(cellKey(focus.rowIdx, focus.colKey));
    }
    return [...keys]
        .map(cellFromKey)
        .sort((a, b) => a.rowIdx - b.rowIdx || columns.indexOf(a.colKey) - columns.indexOf(b.colKey));
}

/** The selected columns of one row, or null when it holds none. */
function selectedColumnsIn(columns, { range, extraCells }, rowIdx) {
    const fromRange = rangeColumnsForRow(range, rowIdx) || [];
    if (!extraCells || extraCells.size === 0) return fromRange.length ? fromRange : null;
    const keys = new Set(fromRange);
    for (const key of extraCells) {
        const cell = cellFromKey(key);
        if (cell.rowIdx === rowIdx) keys.add(cell.colKey);
    }
    return keys.size ? columns.filter(colKey => keys.has(colKey)) : null;
}

const carriesEvery = () => true;

/**
 * The selection and clipboard functions of a table whose value columns are
 * `columns`.
 *
 *   carries(row, colKey)  whether a row holds a value in that column; a cell
 *                         it does not hold copies as nothing and takes no paste
 */
export function createGridModel(columns, { carries = carriesEvery } = {}) {
    const spec = { columns, holds: (row, colKey) => !!row && carries(row, colKey) };
    const selectedCells = selection => selectedCellsIn(columns, selection);
    return {
        columns,
        cellRange: (anchor, focus) => cellRangeIn(columns, anchor, focus),
        selectedCells,
        selectedColumnsForRow: (selection, rowIdx) => selectedColumnsIn(columns, selection, rowIdx),
        pasteTargets: paste => pasteTargetsIn(spec, paste),
        rangeText: (rows, range, cellText) => rangeTextIn(spec, rows, range, cellText),
        selectionText: (rows, selection, cellText) =>
            cellsTextIn(spec, rows, selectedCells(selection), cellText),
    };
}
