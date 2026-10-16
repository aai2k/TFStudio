// Pure merit-operand list transforms used by the Refinement window's edit
// handlers. Each takes the current operand array and returns the next array, plus
// the id to select where relevant, with no React and no refs, so the component's
// handlers stay thin wrappers. The table is the Merit Function Editor's, so a row
// is edited, added and copied by the editor's own transforms.

import { makeOperand, removeOperandsAndDependents } from '../../../../utils/physics/optimizer.js';
import {
    addOperands as addRows, duplicateOperands as duplicateRows, makeRowOperand,
} from '../meritFunctionEditor/meritOperandModel.js';

export { editOperand } from '../meritFunctionEditor/meritOperandModel.js';

// A new row is a comment, as in the Merit Function Editor: it scores nothing
// until a type is picked, so adding one does not change the merit.
const NEW_ROW = { type: 'BLNK', comment: '' };

// Returns { next, selectId } or null when nothing was added.
export function addOperands(ops, data, atIndex) {
    const added = addRows(ops, data ?? NEW_ROW, atIndex);
    return added && { next: added.operands, selectId: added.selectedId };
}

// A copy of `source`, or a new comment row, at `insertIdx`. Returns { next, selectId }.
export function insertOperandAt(ops, insertIdx, source) {
    const op = source
        ? { ...source, id: makeOperand().id, enabled: source.enabled !== false }
        : makeRowOperand(NEW_ROW);
    const pos = Math.max(0, Math.min(insertIdx, ops.length));
    return { next: [...ops.slice(0, pos), op, ...ops.slice(pos)], selectId: op.id };
}

// Returns { next, selectId } or null when nothing was selected to duplicate.
export function duplicateOperands(ops, ids) {
    const copied = duplicateRows(ops, ids);
    return copied && { next: copied.operands, selectId: copied.selectedId };
}

export function deleteOperands(ops, ids) {
    return removeOperandsAndDependents(ops, ids);
}

// Move the selected operand by `dir` (-1 up, +1 down). Returns the reordered
// array, or null if the move is a no-op (nothing selected / already at an edge).
export function moveOperand(ops, selectedId, dir) {
    if (!selectedId) return null;
    const i = ops.findIndex(op => op.id === selectedId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ops.length) return null;
    const a = ops.slice();
    [a[i], a[j]] = [a[j], a[i]];
    return a;
}
