import { COLS } from './operandViewModel.js';
import { contextMenuItems, menuScope, menuTargetFromEvent } from './contextMenuModel.js';
import { copySelectedOperands, pasteOperands } from './operandClipboard.js';
import { isHeaderOrComment, rowsOfSelection, selectedCells } from './selectionModel.js';
import { cutSelectedRows, deleteSelectedRows, duplicateSelectedRows } from './tableKeyboard.js';
import {
    cellText, copyCellText, pasteIntoCell, rangeText, selectionText,
} from './cellClipboard.js';

const { useState, useCallback } = React;

// Whether the clicked cell is part of the cell selection, so a right-click on
// it keeps the selection instead of moving the focus.
function inCellSelection({ range, extraCells, focusCell }, rowIdx, colKey) {
    return selectedCells({ range, extraCells, focus: focusCell })
        .some(cell => cell.rowIdx === rowIdx && cell.colKey === colKey);
}

/**
 * Right-click menu state and actions for the operand table. The actions are
 * the keyboard's: the same clipboard scope, the same rows for Cut, Copy,
 * Duplicate and Delete, so a menu entry and its shortcut never disagree. A
 * click inside a rectangle of cells keeps it, and those entries then take
 * every row it holds a cell in.
 */
export function useTableContextMenu(table) {
    const {
        operands, integralPresets, selIds, setSelIds, focusCell, range, extraCells, clearCells, focusAfterRemoval,
        focusAt, selectRow, setFocusCell,
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
        // a left click would; a click inside the selection keeps it. A header
        // or comment row is never inside a rectangle of cells, having none.
        const keep = selIds.has(op.id)
            || (!isHeaderOrComment(op) && inCellSelection({ range, extraCells, focusCell }, target.rowIdx, target.colKey));
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
    const scope = menuScope(op, colKey, selIds);
    const cells = selectedCells({ range, extraCells, focus: { rowIdx, colKey } });
    const cellCount = scope === 'cell' ? cells.length : 0;
    const rowTable = {
        operands, selectedIds: selIds, focusCell, range, extraCells,
        onDelete, onDuplicate, setSelIds, clearCells, focusAfterRemoval,
    };
    const ids = rowsOfSelection(operands, rowTable);
    const pasteCtx = { rowIdx, colKey, operands, integralPresets, range, extraCells, commitEdit, onAdd, onEdit, onEditMany };
    const copyCells = () => {
        const focus = { rowIdx, colKey };
        if (extraCells?.size) copyCellText(selectionText(operands, { range, extraCells, focus }, isMathPct, integralPresets));
        else if (range) copyCellText(rangeText(operands, range, isMathPct, integralPresets));
        else copyCellText(cellText(op, colKey, isMathPct(op), { operands, integralPresets }));
    };
    const actions = {
        copyCell: copyCells,
        pasteCell: () => pasteIntoCell(pasteCtx),
        copyRows: () => copySelectedOperands(operands, new Set(ids)),
        cutRows: () => cutSelectedRows(rowTable),
        pasteRows: () => pasteOperands(onAdd, rowIdx + 1),
        insertAt: index => onInsertAt(index, op),
        duplicate: () => duplicateSelectedRows(rowTable),
        deleteRows: () => deleteSelectedRows(rowTable),
    };
    return {
        menu, onContextMenu, closeMenu,
        items: contextMenuItems({ te, scope, rowIdx, selectedCount: ids.length, cellCount, actions }),
    };
}
