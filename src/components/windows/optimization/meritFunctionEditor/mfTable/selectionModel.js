import { isBlank, isDmfs } from '../../../../../utils/physics/optimizer.js';
import {
    createGridModel, navigationTarget as gridNavigationTarget,
} from '../../../../ui/grid/gridModel.js';
import { COLS, editableColsForRow } from './operandViewModel.js';

/**
 * A DMFS header or a comment row: a row with no value cells, selected as a row
 * whenever the focus lands on it.
 */
export function isHeaderOrComment(op) {
    return isDmfs(op.type) || isBlank(op.type);
}

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
    .filter(key => ['type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'flag', 'target', 'weight'].includes(key));

/**
 * The operand table's grid. A cell the operand type does not carry shows a
 * dash: it can be reached and selected, copies as nothing and takes no paste.
 */
export const MF_GRID = createGridModel(RANGE_COLUMNS, {
    carries: (op, colKey) => editableColsForRow(op).includes(colKey),
});

export const { cellRange, selectedCells, selectedColumnsForRow } = MF_GRID;

/**
 * The rows Delete, Cut and Duplicate act on, from the keys, the right-click
 * menu or the toolbar: the rows selected as rows, or else every row holding a
 * selected cell, the focused one included. A header or comment row has no
 * cells, so a rectangle drawn across one leaves it out.
 */
export function rowsOfSelection(operands, { selectedIds, focusCell, range, extraCells }) {
    if (selectedIds.size > 0) return [...selectedIds];
    const ids = selectedCells({ range, extraCells, focus: focusCell })
        .map(cell => operands[cell.rowIdx])
        .filter(op => op && !isHeaderOrComment(op))
        .map(op => op.id);
    return [...new Set(ids)];
}

// A comment row's Type, then its comment. The comment spans every column right
// of Type and is reached as the first of them.
const COMMENT_ROW_COLUMNS = ['type', 'lambdaStart'];

/**
 * The cells an arrow key walks through on a row. Every value column counts,
 * a dash included, the way an empty spreadsheet cell can still be reached; a
 * header row has only its enable mark, a comment row its Type and comment.
 */
export function navigationColumns(op) {
    if (isBlank(op.type)) return COMMENT_ROW_COLUMNS;
    const editable = editableColsForRow(op);
    return editable.length === 1 ? editable : ['enabled', ...RANGE_COLUMNS];
}

/** The row-number column. The focus there selects its whole row. */
export const ROW_HEADER = 'num';

// On a comment row every column but Type is the comment, so a step sideways
// from any of them is a step from the comment. Up and down keep the column.
function sidewaysFrom(op, colKey, direction) {
    const sideways = direction === 'left' || direction === 'right';
    return sideways && isBlank(op.type) && colKey !== 'type' ? COMMENT_ROW_COLUMNS[1] : colKey;
}

// From the row number, Right goes to the row's first cell and Up and Down keep
// to the row numbers. There is nothing to its left.
function fromRowHeader(grid, rowIdx, direction) {
    if (direction === 'left') return null;
    if (direction === 'right') return { rowIdx, colKey: grid.columnsOf(rowIdx)[0], focus: true };
    return gridNavigationTarget(grid, rowIdx, ROW_HEADER, direction);
}

/**
 * The cell an arrow or Tab moves to; see gridModel.js. Left from a row's first
 * cell goes on to its row number, which selects the whole row, rather than
 * back to the row above.
 */
export function navigationTarget(operands, fromRowIdx, fromColKey, direction) {
    const op = operands[fromRowIdx];
    if (!op) return null;
    const grid = { rowCount: operands.length, columnsOf: rowIdx => navigationColumns(operands[rowIdx]) };
    if (fromColKey === ROW_HEADER) return fromRowHeader(grid, fromRowIdx, direction);
    const from = sidewaysFrom(op, fromColKey, direction);
    if (direction === 'left' && grid.columnsOf(fromRowIdx)[0] === from) {
        return { rowIdx: fromRowIdx, colKey: ROW_HEADER, focus: true };
    }
    return gridNavigationTarget(grid, fromRowIdx, from, direction);
}

/** The cells a pasted grid of text lands on; see gridModel.js. */
export function pasteTargets({ grid, range, focus, operands }) {
    return MF_GRID.pasteTargets({ grid, range, focus, rows: operands });
}
