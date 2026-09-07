import {
    GENERATED_ONLY_OPERAND_TYPES, OPERAND_POLS, OPERAND_TYPES,
    isFractionalUnit, isValidMeritWeight,
} from '../../../../../utils/physics/optimizer.js';
import { targetInitialValue } from './editModel.js';

// Columns whose text a single cell can carry through the clipboard. Type and
// Pol are picked, not typed, and stay with the row.
const CELL_TEXT_COLUMNS = new Set(['lambdaStart', 'lambdaEnd', 'aoi', 'target', 'weight']);

/**
 * What Ctrl+C and Ctrl+V act on: one cell, when a text cell has focus and no
 * more than its own row is selected; otherwise whole rows, as a click in the #
 * column or a multi-row selection asks for.
 */
export function clipboardScope({ focusCell, selectedIds }) {
    if (!focusCell || !CELL_TEXT_COLUMNS.has(focusCell.colKey)) return 'rows';
    return selectedIds.size > 1 ? 'rows' : 'cell';
}

/** The text a cell shows in its editor, which is also what it copies. */
export function cellText(op, colKey, mathPercent) {
    return colKey === 'target' ? targetInitialValue(op, mathPercent) : String(op[colKey] ?? '');
}

export function copyCellText(text, clipboard = navigator.clipboard) {
    clipboard?.writeText(text).catch(() => {});
}

/**
 * Paste into the focused cell. A single value goes through the cell editor's
 * own commit, so percent and ramp syntax apply; text with tabs or newlines is
 * rows and is inserted below, as a row paste would.
 */
export function pasteIntoCell(ctx, clipboard = navigator.clipboard) {
    clipboard?.readText().then(raw => {
        const text = (raw || '').replace(/\s+$/, '');
        if (!text) return;
        if (/[\t\n]/.test(text)) {
            const items = parseOperandsTsv(text);
            if (items.length) ctx.onAdd(items, ctx.rowIdx + 1);
            return;
        }
        ctx.commitEdit(ctx.rowIdx, ctx.colKey, text);
    }).catch(() => {});
}

export function serializeOperandsTsv(operands, selectedIds) {
    return operands.filter(op => selectedIds.has(op.id)).map(op => {
        const target = op.target ?? 0;
        const targetText = (isFractionalUnit(op.type) ? target * 100 : target).toFixed(2);
        return [op.type, op.lambdaStart, op.lambdaEnd, op.aoi, op.pol, targetText, op.weight].join('\t');
    }).join('\n');
}

export function parseOperandsTsv(text) {
    const items = [];
    text.replace(/\s+$/, '').split(/\r?\n/).forEach(line => {
        if (!line.trim()) return;
        const [type, startText, endText, aoiText, pol, targetText, weightText] = line.split('\t');
        const start = parseFloat(startText);
        const end = parseFloat(endText);
        const aoi = parseFloat(aoiText);
        const target = parseFloat(targetText);
        const weight = parseFloat(weightText);
        // A generated row carries data the clipboard does not: a measured block
        // is its sampled curve. Retyping it would paste an unrelated operand
        // built from the block's range and its target of zero, so skip it.
        if (GENERATED_ONLY_OPERAND_TYPES.includes(type)) return;
        const safeType = OPERAND_TYPES.includes(type) ? type : 'RAV';
        items.push({
            type: safeType,
            lambdaStart: isFinite(start) ? start : 400,
            lambdaEnd: isFinite(end) ? end : 700,
            aoi: isFinite(aoi) ? aoi : 0,
            pol: OPERAND_POLS.includes(pol) ? pol : 'avg',
            target: isFinite(target) ? (isFractionalUnit(safeType) ? target / 100 : target) : 0,
            weight: isValidMeritWeight(weight) ? weight : 1,
        });
    });
    return items;
}

export function copySelectedOperands(operands, selectedIds, clipboard = navigator.clipboard) {
    clipboard?.writeText(serializeOperandsTsv(operands, selectedIds)).catch(() => {});
}

export function pasteOperands(onAdd, atIndex, clipboard = navigator.clipboard) {
    clipboard?.readText().then(text => {
        const items = parseOperandsTsv(text);
        if (items.length) onAdd(items, atIndex);
    }).catch(() => {});
}

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

function moveVertical(ctx, step) {
    ctx.event.preventDefault();
    const rowIdx = Math.max(0, Math.min(ctx.rowIdx + step, ctx.operands.length - 1));
    ctx.focusAt(rowIdx, ctx.colKey);
}

function moveHorizontal(ctx, direction) {
    ctx.event.preventDefault();
    ctx.navigate(ctx.rowIdx, ctx.colKey, direction);
}

function beginEdit(ctx) {
    ctx.event.preventDefault();
    ctx.startEdit(ctx.rowIdx, ctx.colKey, null);
}

function moveTab(ctx) {
    ctx.event.preventDefault();
    ctx.navigate(ctx.rowIdx, ctx.colKey, ctx.event.shiftKey ? 'left' : 'right');
}

// Rows to copy: the selection, or the focused row when nothing is selected.
function rowsToCopy(ctx) {
    if (ctx.selectedIds.size > 0) return ctx.selectedIds;
    const focused = ctx.operands[ctx.rowIdx];
    return new Set(focused ? [focused.id] : []);
}

function copyRows(ctx) {
    ctx.event.preventDefault();
    if (clipboardScope(ctx) === 'cell') {
        const op = ctx.operands[ctx.rowIdx];
        copyCellText(cellText(op, ctx.colKey, ctx.isMathPct(op)));
        return;
    }
    copySelectedOperands(ctx.operands, rowsToCopy(ctx));
}

function pasteRows(ctx) {
    ctx.event.preventDefault();
    if (clipboardScope(ctx) === 'cell') {
        pasteIntoCell(ctx);
        return;
    }
    pasteOperands(ctx.onAdd, ctx.rowIdx + 1);
}

// Cut always moves rows: a cell has nothing to cut, its value is replaced by
// typing over it.
function cutRows(ctx) {
    ctx.event.preventDefault();
    const ids = rowsToCopy(ctx);
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
    ArrowDown: ctx => moveVertical(ctx, 1),
    ArrowUp: ctx => moveVertical(ctx, -1),
    ArrowRight: ctx => moveHorizontal(ctx, 'right'),
    ArrowLeft: ctx => moveHorizontal(ctx, 'left'),
    Enter: beginEdit,
    Tab: moveTab,
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

function isPrintableEditKey(event) {
    const hasModifier = [event.ctrlKey, event.altKey, event.metaKey].some(Boolean);
    return !hasModifier && event.key.length === 1;
}

/**
 * Whether the event came from a control that takes typing itself: a comment
 * row's input, a select, the cell editor. Keys typed there belong to it, not to
 * the focused cell, or a comment would land in whichever cell was last focused.
 */
export function isTextControl(target) {
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function doKeyDown(ctx, event) {
    const { editCell, focusCell, selectedIds, operands, startEdit } = ctx;
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
