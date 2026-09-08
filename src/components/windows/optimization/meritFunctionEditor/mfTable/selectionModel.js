import { COLS, editableColsForRow } from './operandViewModel.js';

export function selectionAfterRowClick(options) {
    const { operands, previous, anchor, id, shift, ctrl } = options;
    if (shift && anchor) {
        const anchorIndex = operands.findIndex(op => op.id === anchor);
        const currentIndex = operands.findIndex(op => op.id === id);
        const low = Math.min(anchorIndex, currentIndex);
        const high = Math.max(anchorIndex, currentIndex);
        const next = new Set(operands.slice(low, high + 1).map(op => op.id));
        if (ctrl) previous.forEach(selectedId => next.add(selectedId));
        return { selectedIds: next, anchor };
    }
    if (ctrl) {
        const next = new Set(previous);
        next.has(id) ? next.delete(id) : next.add(id);
        return { selectedIds: next, anchor: id };
    }
    return { selectedIds: new Set([id]), anchor: id };
}

// The columns a rectangle of cells can span: the ones that hold a value a cell
// can carry through the clipboard, in table order.
export const RANGE_COLUMNS = COLS
    .map(col => col.key)
    .filter(key => ['type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'weight'].includes(key));

/**
 * The cells an arrow key walks through on a row. Every value column counts,
 * a dash included, the way an empty spreadsheet cell can still be reached;
 * a header or comment row has only its enable mark.
 */
export function navigationColumns(op) {
    const editable = editableColsForRow(op);
    return editable.length === 1 ? editable : ['enabled', ...RANGE_COLUMNS];
}

export function navigationTarget(operands, fromRowIdx, fromColKey, direction) {
    const op = operands[fromRowIdx];
    if (!op) return null;
    if (direction === 'down' || direction === 'up') {
        const rowIdx = fromRowIdx + (direction === 'down' ? 1 : -1);
        return rowIdx >= 0 && rowIdx < operands.length ? { rowIdx, colKey: fromColKey, focus: true } : null;
    }
    const columns = navigationColumns(op);
    const delta = direction === 'right' ? 1 : -1;
    const columnIndex = columns.indexOf(fromColKey) + delta;
    if (columnIndex >= 0 && columnIndex < columns.length) {
        return { rowIdx: fromRowIdx, colKey: columns[columnIndex], focus: false };
    }
    const rowIdx = fromRowIdx + delta;
    if (rowIdx < 0 || rowIdx >= operands.length) return null;
    const nextColumns = navigationColumns(operands[rowIdx]);
    const colKey = delta > 0 ? nextColumns[0] : nextColumns[nextColumns.length - 1];
    return { rowIdx, colKey, focus: true };
}

/**
 * The rectangle between the anchor cell and the focused cell, as a row span
 * and the column keys it covers in table order. Null when the two are one and
 * the same cell, or when either lies outside the value columns.
 */
export function cellRange(anchor, focus) {
    if (!anchor || !focus) return null;
    if (anchor.rowIdx === focus.rowIdx && anchor.colKey === focus.colKey) return null;
    const a = RANGE_COLUMNS.indexOf(anchor.colKey);
    const f = RANGE_COLUMNS.indexOf(focus.colKey);
    if (a < 0 || f < 0) return null;
    return {
        rowStart: Math.min(anchor.rowIdx, focus.rowIdx),
        rowEnd: Math.max(anchor.rowIdx, focus.rowIdx),
        colKeys: RANGE_COLUMNS.slice(Math.min(a, f), Math.max(a, f) + 1),
    };
}

/** The range's columns when the row lies inside it, otherwise null. */
export function rangeColumnsForRow(range, rowIdx) {
    if (!range || rowIdx < range.rowStart || rowIdx > range.rowEnd) return null;
    return range.colKeys;
}

/** The key a cell is held under in the set of cells added with Ctrl. */
export function cellKey(rowIdx, colKey) {
    return `${rowIdx}:${colKey}`;
}

/**
 * Every selected cell in table order: the rectangle, the cells added with
 * Ctrl, and the focused cell on its own when there is no rectangle. Rows come
 * in order and cells within a row in column order, so copying them writes
 * them the way the table shows them.
 */
export function selectedCells({ range, extraCells, focus }) {
    const keys = new Set(extraCells || []);
    if (range) {
        for (let rowIdx = range.rowStart; rowIdx <= range.rowEnd; rowIdx++) {
            for (const colKey of range.colKeys) keys.add(cellKey(rowIdx, colKey));
        }
    } else if (focus) {
        keys.add(cellKey(focus.rowIdx, focus.colKey));
    }
    return [...keys]
        .map(key => { const [row, colKey] = key.split(':'); return { rowIdx: Number(row), colKey }; })
        .sort((a, b) => a.rowIdx - b.rowIdx || RANGE_COLUMNS.indexOf(a.colKey) - RANGE_COLUMNS.indexOf(b.colKey));
}

/** The selected columns of one row, or null when it holds none. */
export function selectedColumnsForRow({ range, extraCells }, rowIdx) {
    const fromRange = rangeColumnsForRow(range, rowIdx) || [];
    if (!extraCells || extraCells.size === 0) return fromRange.length ? fromRange : null;
    const keys = new Set(fromRange);
    for (const key of extraCells) {
        const [row, colKey] = key.split(':');
        if (Number(row) === rowIdx) keys.add(colKey);
    }
    return keys.size ? RANGE_COLUMNS.filter(colKey => keys.has(colKey)) : null;
}

/**
 * The cells a pasted grid of text lands on, each with its text.
 *
 * Over a range the grid repeats to fill it, the way a spreadsheet fills a
 * selection: one value fills every cell, one row fills every row. From a single
 * cell the grid is laid out from that cell down and to the right, and what
 * falls off the table's edge is dropped. Cells a row does not carry, a dash in
 * the table, are skipped either way, as is empty text.
 */
export function pasteTargets({ grid, range, focus, operands }) {
    const targets = [];
    const put = (rowIdx, colKey, text) => {
        const op = operands[rowIdx];
        if (!op || text === '' || !editableColsForRow(op).includes(colKey)) return;
        targets.push({ rowIdx, colKey, text });
    };
    if (range) {
        for (let rowIdx = range.rowStart; rowIdx <= range.rowEnd; rowIdx++) {
            const line = grid[(rowIdx - range.rowStart) % grid.length];
            range.colKeys.forEach((colKey, index) => put(rowIdx, colKey, line[index % line.length]));
        }
        return targets;
    }
    const start = RANGE_COLUMNS.indexOf(focus.colKey);
    if (start < 0) return targets;
    grid.forEach((line, rowOffset) => {
        line.forEach((text, colOffset) => {
            const colKey = RANGE_COLUMNS[start + colOffset];
            if (colKey) put(focus.rowIdx + rowOffset, colKey, text);
        });
    });
    return targets;
}
