import {
    beginEdit, collapseRange, isPrintableEditKey, isTextControl, moveHorizontal, moveTab, moveVertical,
} from '../../../../ui/grid/gridKeys.js';
import {
    cellText, clipboardScope, copyCellText, pasteIntoCell, rangeText, selectionText,
} from './cellClipboard.js';
import { copySelectedOperands, pasteOperands } from './operandClipboard.js';
import { RANGE_COLUMNS, navigationTarget, rowsOfSelection } from './selectionModel.js';

export function keyComboOf(event) {
    const key = event.key;
    if (event.ctrlKey && !event.shiftKey && (key === 'd' || key === 'D')) return 'Ctrl+d';
    const ctrlKey = event.ctrlKey ? { c: 'Ctrl+c', v: 'Ctrl+v', x: 'Ctrl+x' }[key] : null;
    return ctrlKey || (key === 'F2' ? 'Enter' : key);
}

/*
 * The row actions, from the keys, the right-click menu or the toolbar, each on
 * the rows rowsOfSelection names. The cell selection goes with them, so no
 * cell stays lit on rows that the action moves up or the copies push down.
 *
 *   table  { operands, selectedIds, focusCell, range, extraCells,
 *            onDelete, onDuplicate, setSelIds, clearCells, focusAfterRemoval }
 */

/**
 * Delete removes rows, never a value: a number cell cannot be left empty.
 * A focused cell's column keeps the focus, on the row that moves up into the
 * first removed row's place. Returns whether there was anything to delete.
 */
export function deleteSelectedRows(table) {
    const { operands, focusCell } = table;
    const ids = rowsOfSelection(operands, table);
    if (ids.length === 0) return false;
    const removed = new Set(ids);
    const first = operands.findIndex(op => removed.has(op.id));
    table.onDelete(ids);
    table.setSelIds(new Set());
    table.clearCells();
    if (focusCell) table.focusAfterRemoval(first, focusCell.colKey);
    return true;
}

/** Cut copies the rows Delete would remove as operands, then removes them. */
export function cutSelectedRows(table) {
    const ids = rowsOfSelection(table.operands, table);
    if (ids.length > 0) copySelectedOperands(table.operands, new Set(ids));
    deleteSelectedRows(table);
}

/** Duplicate puts a copy after each row. */
export function duplicateSelectedRows(table) {
    const ids = rowsOfSelection(table.operands, table);
    if (ids.length === 0 || !table.onDuplicate) return;
    table.onDuplicate(ids);
    table.clearCells();
}

function deleteRows(ctx) {
    if (deleteSelectedRows(ctx)) ctx.event.preventDefault();
}

// Backspace opens the focused value cell's editor with its text cleared, as a
// spreadsheet does: Type opens its picker with an empty search, a cell holding
// a value out of a list, such as Pol, opens its list, and a dash opens
// nothing. A row selection has no cell to clear, and the on/off mark is not a
// value.
function clearAndEdit(ctx) {
    if (!ctx.focusCell || !RANGE_COLUMNS.includes(ctx.colKey)) return;
    ctx.event.preventDefault();
    ctx.startEdit(ctx.rowIdx, ctx.colKey, '');
}

function insertRow(ctx) {
    ctx.event.preventDefault();
    if (ctx.onInsertAt) {
        const index = ctx.event.shiftKey ? ctx.rowIdx + 1 : ctx.rowIdx;
        ctx.onInsertAt(index, ctx.operands[ctx.rowIdx] || null);
    }
}

function duplicateRows(ctx) {
    ctx.event.preventDefault();
    duplicateSelectedRows(ctx);
}

// The operand list as gridKeys.js reads a table.
function gridMoves(ctx) {
    return {
        ...ctx,
        rowCount: ctx.operands.length,
        stepTarget: direction => navigationTarget(ctx.operands, ctx.rowIdx, ctx.colKey, direction),
    };
}

// Rows to copy: the selection, or the focused row when nothing is selected.
function rowsToCopy(ctx) {
    if (ctx.selectedIds.size > 0) return ctx.selectedIds;
    const focused = ctx.operands[ctx.rowIdx];
    return new Set(focused ? [focused.id] : []);
}

// The scope a key press acts on. The focused row is what decides whether its
// column carries a value at all, so it goes in with the focus.
function scopeOf(ctx) {
    return clipboardScope({
        op: ctx.operands[ctx.rowIdx], focusCell: ctx.focusCell, selectedIds: ctx.selectedIds,
    });
}

// Whether more than the focused cell is selected: a rectangle, or cells
// gathered with Ctrl.
function hasCellSelection(ctx) {
    return !!ctx.range || !!(ctx.extraCells && ctx.extraCells.size);
}

function copyRows(ctx) {
    ctx.event.preventDefault();
    const { operands, integralPresets, isMathPct } = ctx;
    if (ctx.extraCells?.size) {
        const focus = { rowIdx: ctx.rowIdx, colKey: ctx.colKey };
        copyCellText(selectionText(operands, { range: ctx.range, extraCells: ctx.extraCells, focus }, isMathPct, integralPresets));
        return;
    }
    if (ctx.range) {
        copyCellText(rangeText(operands, ctx.range, isMathPct, integralPresets));
        return;
    }
    if (scopeOf(ctx) === 'cell') {
        const op = operands[ctx.rowIdx];
        copyCellText(cellText(op, ctx.colKey, isMathPct(op), { operands, integralPresets }));
        return;
    }
    copySelectedOperands(operands, rowsToCopy(ctx));
}

function pasteRows(ctx) {
    ctx.event.preventDefault();
    if (hasCellSelection(ctx) || scopeOf(ctx) === 'cell') {
        pasteIntoCell(ctx);
        return;
    }
    pasteOperands(ctx.onAdd, ctx.rowIdx + 1);
}

function cutRows(ctx) {
    ctx.event.preventDefault();
    cutSelectedRows(ctx);
}

const KEY_ACTIONS = {
    Delete: deleteRows,
    Backspace: clearAndEdit,
    Insert: insertRow,
    'Ctrl+d': duplicateRows,
    ArrowDown: ctx => moveVertical(gridMoves(ctx), 1),
    ArrowUp: ctx => moveVertical(gridMoves(ctx), -1),
    ArrowRight: ctx => moveHorizontal(gridMoves(ctx), 'right'),
    ArrowLeft: ctx => moveHorizontal(gridMoves(ctx), 'left'),
    Enter: beginEdit,
    Tab: moveTab,
    Escape: collapseRange,
    'Ctrl+c': copyRows,
    'Ctrl+v': pasteRows,
    'Ctrl+x': cutRows,
};

export function runKeyAction(actionKey, ctx) {
    const action = KEY_ACTIONS[actionKey];
    if (action) {
        action(ctx);
        return true;
    }
    return false;
}

export function doKeyDown(ctx, event) {
    const { editCell, focusCell, selectedIds, operands, startEdit } = ctx;
    // A box that takes typing, a cell's editor or a comment, takes every key.
    if (isTextControl(event.target)) return;
    if (editCell || (!focusCell && selectedIds.size === 0)) return;
    const rowIdx = focusCell?.rowIdx ?? operands.findIndex(op => selectedIds.has(op.id));
    if (rowIdx < 0) return;
    const colKey = focusCell?.colKey ?? 'type';
    const handled = runKeyAction(keyComboOf(event), { ...ctx, event, rowIdx, colKey });
    if (!handled && isPrintableEditKey(event)) {
        startEdit(rowIdx, colKey, event.key);
    }
}
