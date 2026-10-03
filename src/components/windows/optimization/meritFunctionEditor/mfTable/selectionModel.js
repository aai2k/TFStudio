import {
    createGridModel, navigationTarget as gridNavigationTarget,
} from '../../../../ui/grid/gridModel.js';
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
 * The operand table's grid. A cell the operand type does not carry shows a
 * dash: it can be reached and selected, copies as nothing and takes no paste.
 */
export const MF_GRID = createGridModel(RANGE_COLUMNS, {
    carries: (op, colKey) => editableColsForRow(op).includes(colKey),
});

export const { cellRange, selectedCells, selectedColumnsForRow } = MF_GRID;

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
    return gridNavigationTarget({
        rowCount: operands.length,
        columnsOf: rowIdx => navigationColumns(operands[rowIdx]),
    }, fromRowIdx, fromColKey, direction);
}

/** The cells a pasted grid of text lands on; see gridModel.js. */
export function pasteTargets({ grid, range, focus, operands }) {
    return MF_GRID.pasteTargets({ grid, range, focus, rows: operands });
}
