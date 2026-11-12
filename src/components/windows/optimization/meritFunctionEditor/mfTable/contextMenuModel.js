import { isDmfs } from '../../../../../utils/physics/optimizer.js';
import { clipboardScope } from './cellClipboard.js';

/**
 * Which row and column a right-click landed on, read from the table's own DOM:
 * the cell's index in its row is the column, the row's index in the body is
 * the operand. A click outside a cell (the empty area below the rows) has no
 * target. Neither has a right-click inside a typed control, which keeps the
 * browser's own copy and paste menu; the one exception is a comment row's
 * input, marked `data-row-menu`, since it covers the whole row.
 */
export function menuTargetFromEvent(event, columns) {
    const target = event.target;
    const tag = target?.tagName;
    const textControl = tag === 'INPUT' || tag === 'TEXTAREA';
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
 * What the menu acts on: 'cell', 'rows' or 'none', as clipboardScope in
 * cellClipboard.js says. A DMFS header has no cell to copy on its own,
 * whichever column was under the pointer; every other row follows the
 * keyboard's rule, which gives a comment row its Type cell and the row
 * everywhere else. `environments` is the table's (tableEnvironments.js).
 */
export function menuScope(op, colKey, selectedIds, environments = null) {
    if (!op || isDmfs(op.type)) return 'rows';
    return clipboardScope({ op, focusCell: { rowIdx: 0, colKey }, selectedIds, environments });
}

/**
 * The right-click menu of the operand table. Cell entries appear only when the
 * click landed on a text cell with no wider selection; the rest act on the
 * `selectedCount` rows the keys act on: the selected rows, or the rows holding
 * the selected cells.
 */
export function contextMenuItems({ te, scope, rowIdx, selectedCount, cellCount = 1, actions }) {
    const cm = te.contextMenu;
    const count = Math.max(1, selectedCount);
    const items = [];
    // Ctrl+C and Ctrl+V follow the same scope rule as the menu, so they are
    // shown on the cell entries when those are offered, on the row entries when
    // the keys act on rows, and on neither where the keys do nothing.
    const cell = scope === 'cell';
    const rows = scope === 'rows';
    if (cell) {
        const many = cellCount > 1;
        items.push(
            { id: 'copyCell', label: many ? cm.copyCells : cm.copyCell, shortcut: 'Ctrl+C', onClick: actions.copyCell },
            { id: 'pasteCell', label: many ? cm.pasteCells : cm.pasteCell, shortcut: 'Ctrl+V', onClick: actions.pasteCell },
            { separator: true },
        );
    }
    items.push(
        { id: 'cut', label: cm.cutOperand(count), shortcut: 'Ctrl+X', onClick: actions.cutRows },
        { id: 'copy', label: cm.copyOperand(count), shortcut: rows ? 'Ctrl+C' : undefined, onClick: actions.copyRows },
        { id: 'paste', label: cm.pasteOperand, shortcut: rows ? 'Ctrl+V' : undefined, onClick: actions.pasteRows },
        { separator: true },
        { id: 'insert', label: cm.insertOperand, shortcut: 'Insert', onClick: () => actions.insertAt(rowIdx) },
        { id: 'insertAfter', label: cm.insertOperandAfter, shortcut: 'Shift+Insert', onClick: () => actions.insertAt(rowIdx + 1) },
        { id: 'duplicate', label: cm.duplicateOperand(count), shortcut: 'Ctrl+D', onClick: actions.duplicate },
        { separator: true },
        { id: 'delete', label: cm.deleteOperand(count), shortcut: 'Del', danger: true, onClick: actions.deleteRows },
    );
    return items;
}
