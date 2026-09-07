import { COLS } from './operandViewModel.js';
import { contextMenuItems, menuScope, menuTargetFromEvent } from './contextMenuModel.js';
import {
    cellText, copyCellText, copySelectedOperands, pasteIntoCell, pasteOperands,
} from './tableKeyboard.js';

const { useState, useCallback } = React;

// The rows a row action applies to: the selection when the clicked row is part
// of it, otherwise the clicked row alone.
function rowsFor(operands, selectedIds, rowIdx) {
    const op = operands[rowIdx];
    if (!op) return [];
    return selectedIds.has(op.id) && selectedIds.size > 0 ? [...selectedIds] : [op.id];
}

/**
 * Right-click menu state and actions for the operand table. The actions are
 * the keyboard's: the same clipboard scope, the same insert and delete calls,
 * so a menu entry and its shortcut never disagree.
 */
export function useTableContextMenu(table) {
    const {
        operands, selIds, focusAt, selectRow, setFocusCell, onAdd, onInsertAt, onDuplicate, onDelete,
        commitEdit, isMathPct, te,
    } = table;
    const [menu, setMenu] = useState(null);

    const onContextMenu = useCallback(event => {
        const target = menuTargetFromEvent(event, COLS);
        if (!target) return;
        event.preventDefault();
        const op = operands[target.rowIdx];
        if (!op) return;
        // A click on a row outside the selection moves the focus there, the way
        // a left click would; a click inside the selection keeps it.
        if (!selIds.has(op.id)) {
            // A comment or header row is selected as a row; a text cell takes
            // the focus, the way a left click gives it.
            if (target.colKey === 'num' || menuScope(op, target.colKey, new Set()) === 'rows') {
                selectRow(op.id, false, false, target.rowInput);
                setFocusCell(null);
            } else {
                focusAt(target.rowIdx, target.colKey);
            }
        }
        setMenu({ x: event.clientX, y: event.clientY, rowIdx: target.rowIdx, colKey: target.colKey });
    }, [operands, selIds, focusAt, selectRow, setFocusCell]);

    const closeMenu = useCallback(() => setMenu(null), []);

    if (!menu) return { menu: null, items: [], onContextMenu, closeMenu };

    const { rowIdx, colKey } = menu;
    const op = operands[rowIdx];
    const ids = rowsFor(operands, selIds, rowIdx);
    const scope = menuScope(op, colKey, new Set(ids));
    const actions = {
        copyCell: () => copyCellText(cellText(op, colKey, isMathPct(op))),
        pasteCell: () => pasteIntoCell({ rowIdx, colKey, commitEdit, onAdd }),
        copyRows: () => copySelectedOperands(operands, new Set(ids)),
        cutRows: () => { copySelectedOperands(operands, new Set(ids)); onDelete(ids); },
        pasteRows: () => pasteOperands(onAdd, rowIdx + 1),
        insertAt: index => onInsertAt(index, op),
        duplicate: () => onDuplicate(ids),
        deleteRows: () => onDelete(ids),
    };
    return {
        menu, onContextMenu, closeMenu,
        items: contextMenuItems({ te, scope, rowIdx, selectedCount: ids.length, actions }),
    };
}
