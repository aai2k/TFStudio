import {
    beginEdit, collapseRange, isPrintableEditKey, isTextControl, moveHorizontal, moveTab, moveVertical,
} from '../../../../ui/grid/gridKeys.js';
import {
    cellText, clipboardScope, copyCellText, pasteIntoCell, rangeText, selectionText,
} from './cellClipboard.js';
import { copySelectedOperands, pasteOperands } from './operandClipboard.js';
import { navigationTarget } from './selectionModel.js';

export function keyComboOf(event) {
    const key = event.key;
    if (event.ctrlKey && !event.shiftKey && (key === 'd' || key === 'D')) return 'Ctrl+d';
    const ctrlKey = event.ctrlKey ? { c: 'Ctrl+c', v: 'Ctrl+v', x: 'Ctrl+x' }[key] : null;
    return ctrlKey || (key === 'F2' ? 'Enter' : key);
}

function deleteRows(ctx) {
    if (ctx.selectedIds.size > 0) {
        ctx.event.preventDefault();
        ctx.onDelete([...ctx.selectedIds]);
        ctx.setSelIds(new Set());
        ctx.setFocusCell(null);
    }
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
    if (!ctx.onDuplicate) return;
    const focused = ctx.operands[ctx.rowIdx];
    const ids = ctx.selectedIds.size > 0 ? [...ctx.selectedIds] : (focused ? [focused.id] : []);
    if (ids.length) ctx.onDuplicate(ids);
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
    if (ctx.extraCells?.size) {
        const focus = { rowIdx: ctx.rowIdx, colKey: ctx.colKey };
        copyCellText(selectionText(ctx.operands, { range: ctx.range, extraCells: ctx.extraCells, focus }, ctx.isMathPct));
        return;
    }
    if (ctx.range) {
        copyCellText(rangeText(ctx.operands, ctx.range, ctx.isMathPct));
        return;
    }
    if (scopeOf(ctx) === 'cell') {
        const op = ctx.operands[ctx.rowIdx];
        copyCellText(cellText(op, ctx.colKey, ctx.isMathPct(op)));
        return;
    }
    copySelectedOperands(ctx.operands, rowsToCopy(ctx));
}

function pasteRows(ctx) {
    ctx.event.preventDefault();
    if (hasCellSelection(ctx) || scopeOf(ctx) === 'cell') {
        pasteIntoCell(ctx);
        return;
    }
    pasteOperands(ctx.onAdd, ctx.rowIdx + 1);
}

// Cut moves rows, and only rows selected as rows: a cell has nothing to cut,
// its value is replaced by typing over it, and a focused cell alone must not
// take its row with it.
function cutRows(ctx) {
    ctx.event.preventDefault();
    const ids = ctx.selectedIds;
    if (ids.size === 0) return;
    copySelectedOperands(ctx.operands, ids);
    ctx.onDelete([...ids]);
    ctx.setSelIds(new Set());
    ctx.setFocusCell(null);
}

const KEY_ACTIONS = {
    Delete: deleteRows,
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

// A closed dropdown answers arrows, Enter, Tab and typing itself, but makes no
// use of these, so the table keeps them while a Pol or comparison cell holds
// focus. An input or a textarea takes every key it is sent.
const SELECT_LEAVES_TO_TABLE = new Set(['Delete', 'Insert', 'Ctrl+c', 'Ctrl+v', 'Ctrl+x', 'Ctrl+d']);

function belongsToControl(target, combo) {
    if (!isTextControl(target)) return false;
    return target.tagName !== 'SELECT' || !SELECT_LEAVES_TO_TABLE.has(combo);
}

export function doKeyDown(ctx, event) {
    const { editCell, focusCell, selectedIds, operands, startEdit } = ctx;
    const combo = keyComboOf(event);
    if (belongsToControl(event.target, combo)) return;
    if (editCell || (!focusCell && selectedIds.size === 0)) return;
    const rowIdx = focusCell?.rowIdx ?? operands.findIndex(op => selectedIds.has(op.id));
    if (rowIdx < 0) return;
    const colKey = focusCell?.colKey ?? 'type';
    const handled = runKeyAction(combo, { ...ctx, event, rowIdx, colKey });
    if (!handled && isPrintableEditKey(event)) {
        startEdit(rowIdx, colKey, event.key);
    }
}
