import { editableColsForRow } from './operandViewModel.js';

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

export function navigationTarget(operands, fromRowIdx, fromColKey, direction) {
    const op = operands[fromRowIdx];
    if (!op) return null;
    if (direction === 'down' || direction === 'up') {
        const rowIdx = fromRowIdx + (direction === 'down' ? 1 : -1);
        return rowIdx >= 0 && rowIdx < operands.length ? { rowIdx, colKey: fromColKey, focus: true } : null;
    }
    const columns = editableColsForRow(op);
    const delta = direction === 'right' ? 1 : -1;
    const columnIndex = columns.indexOf(fromColKey) + delta;
    if (columnIndex >= 0 && columnIndex < columns.length) {
        return { rowIdx: fromRowIdx, colKey: columns[columnIndex], focus: false };
    }
    const rowIdx = fromRowIdx + delta;
    if (rowIdx < 0 || rowIdx >= operands.length) return null;
    const nextColumns = editableColsForRow(operands[rowIdx]);
    const colKey = delta > 0 ? nextColumns[0] : nextColumns[nextColumns.length - 1];
    return { rowIdx, colKey, focus: true };
}
