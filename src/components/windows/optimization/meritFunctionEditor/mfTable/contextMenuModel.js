import { isBlank, isDmfs } from '../../../../../utils/physics/optimizer.js';
import { clipboardScope } from './tableKeyboard.js';

/**
 * Which row and column a right-click landed on, read from the table's own DOM:
 * the cell's index in its row is the column, the row's index in the body is
 * the operand. A click outside a cell (the empty area below the rows) has no
 * target. Neither has a right-click inside a text control, which keeps the
 * browser's own copy and paste menu; the one exception is a comment row's
 * input, marked `data-row-menu`, since it covers the whole row.
 */
export function menuTargetFromEvent(event, columns) {
    const target = event.target;
    const tag = target?.tagName;
    const textControl = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (textControl && !target.dataset?.rowMenu) return null;
    const cell = target?.closest?.('td');
    const row = cell?.parentElement;
    // The row carries which operand it is. Only the rows on screen are built,
    // with spacers standing in for the rest, so a row's position among the
    // built ones says nothing about where it is in the table.
    const rowIdx = Number(row?.dataset?.row);
    if (!cell || !Number.isInteger(rowIdx) || rowIdx < 0) return null;
    return {
        rowIdx,
        colKey: columns[cell.cellIndex]?.key || 'type',
        // Set when the click was inside a comment input, which must keep the
        // caret it has while its row is selected.
        rowInput: textControl,
    };
}

/**
 * What the menu acts on. A DMFS header or a comment row has no cell to copy
 * on its own, whichever column was under the pointer; every other row follows
 * the keyboard's rule.
 */
export function menuScope(op, colKey, selectedIds) {
    if (!op || isDmfs(op.type) || isBlank(op.type)) return 'rows';
    return clipboardScope({ focusCell: { rowIdx: 0, colKey }, selectedIds });
}

/**
 * The right-click menu of the operand table. Cell entries appear only when the
 * click landed on a text cell with no wider selection; the rest act on the
 * selected rows, or on the clicked row when nothing is selected.
 */
export function contextMenuItems({ te, scope, rowIdx, selectedCount, actions }) {
    const cm = te.contextMenu;
    const count = Math.max(1, selectedCount);
    const items = [];
    // Ctrl+C and Ctrl+V follow the same scope rule as the menu, so they are
    // shown on the cell entries when those are offered and on the row entries
    // otherwise.
    const cell = scope === 'cell';
    if (cell) {
        items.push(
            { id: 'copyCell', label: cm.copyCell, shortcut: 'Ctrl+C', onClick: actions.copyCell },
            { id: 'pasteCell', label: cm.pasteCell, shortcut: 'Ctrl+V', onClick: actions.pasteCell },
            { separator: true },
        );
    }
    items.push(
        { id: 'cut', label: cm.cutOperand(count), shortcut: 'Ctrl+X', onClick: actions.cutRows },
        { id: 'copy', label: cm.copyOperand(count), shortcut: cell ? undefined : 'Ctrl+C', onClick: actions.copyRows },
        { id: 'paste', label: cm.pasteOperand, shortcut: cell ? undefined : 'Ctrl+V', onClick: actions.pasteRows },
        { separator: true },
        { id: 'insert', label: cm.insertOperand, shortcut: 'Insert', onClick: () => actions.insertAt(rowIdx) },
        { id: 'insertAfter', label: cm.insertOperandAfter, shortcut: 'Shift+Insert', onClick: () => actions.insertAt(rowIdx + 1) },
        { id: 'duplicate', label: cm.duplicateOperand(count), shortcut: 'Ctrl+D', onClick: actions.duplicate },
        { separator: true },
        { id: 'delete', label: cm.deleteOperand(count), shortcut: 'Del', danger: true, onClick: actions.deleteRows },
    );
    return items;
}
