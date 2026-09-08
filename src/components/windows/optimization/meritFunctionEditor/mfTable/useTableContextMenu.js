import { COLS } from './operandViewModel.js';
import { contextMenuItems, menuScope, menuTargetFromEvent } from './contextMenuModel.js';
import { selectedCells } from './selectionModel.js';
import {
    cellText, copyCellText, copySelectedOperands, pasteIntoCell, pasteOperands, rangeText, selectionText,
} from './tableKeyboard.js';

const { useState, useCallback } = React;

// The rows a row action applies to: the selection when the clicked row is part
// of it, otherwise the clicked row alone.
function rowsFor(operands, selectedIds, rowIdx) {
    const op = operands[rowIdx];
    if (!op) return [];
    return selectedIds.has(op.id) && selectedIds.size > 0 ? [...selectedIds] : [op.id];
}

// Whether the clicked cell is part of the cell selection, so a right-click on
// it keeps the selection instead of moving the focus.
function inCellSelection({ range, extraCells, focusCell }, rowIdx, colKey) {
    return selectedCells({ range, extraCells, focus: focusCell })
        .some(cell => cell.rowIdx === rowIdx && cell.colKey === colKey);
}

/**
 * Right-click menu state and actions for the operand table. The actions are
 * the keyboard's: the same clipboard scope, the same insert and delete calls,
 * so a menu entry and its shortcut never disagree.
 */
export function useTableContextMenu(table) {
    const {
        operands, selIds, focusCell, range, extraCells, focusAt, selectRow, setFocusCell,
        onAdd, onInsertAt, onDuplicate, onDelete, onEdit, onEditMany, commitEdit, isMathPct, te,
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
        const keep = selIds.has(op.id) || inCellSelection({ range, extraCells, focusCell }, target.rowIdx, target.colKey);
        if (!keep) {
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
    }, [operands, selIds, range, extraCells, focusCell, focusAt, selectRow, setFocusCell]);

    const closeMenu = useCallback(() => setMenu(null), []);

    if (!menu) return { menu: null, items: [], onContextMenu, closeMenu };

    const { rowIdx, colKey } = menu;
    const op = operands[rowIdx];
    const ids = rowsFor(operands, selIds, rowIdx);
    const scope = menuScope(op, colKey, new Set(ids));
    const cells = selectedCells({ range, extraCells, focus: { rowIdx, colKey } });
    const cellCount = scope === 'cell' ? cells.length : 0;
    const pasteCtx = { rowIdx, colKey, operands, range, extraCells, commitEdit, onAdd, onEdit, onEditMany };
    const copyCells = () => {
        if (extraCells?.size) copyCellText(selectionText(operands, { range, extraCells, focus: { rowIdx, colKey } }, isMathPct));
        else if (range) copyCellText(rangeText(operands, range, isMathPct));
        else copyCellText(cellText(op, colKey, isMathPct(op)));
    };
    const actions = {
        copyCell: copyCells,
        pasteCell: () => pasteIntoCell(pasteCtx),
        copyRows: () => copySelectedOperands(operands, new Set(ids)),
        cutRows: () => { copySelectedOperands(operands, new Set(ids)); onDelete(ids); },
        pasteRows: () => pasteOperands(onAdd, rowIdx + 1),
        insertAt: index => onInsertAt(index, op),
        duplicate: () => onDuplicate(ids),
        deleteRows: () => onDelete(ids),
    };
    return {
        menu, onContextMenu, closeMenu,
        items: contextMenuItems({ te, scope, rowIdx, selectedCount: ids.length, cellCount, actions }),
    };
}
