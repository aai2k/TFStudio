import {
    GENERATED_ONLY_OPERAND_TYPES, OPERAND_POLS, OPERAND_TYPES,
    isFractionalUnit, isValidMeritWeight,
} from '../../../../../utils/physics/optimizer.js';
import { cellEdit, targetInitialValue } from './editModel.js';
import { editableColsForRow } from './operandViewModel.js';
import {
    RANGE_COLUMNS, navigationTarget, pasteTargets, selectedCells,
} from './selectionModel.js';

const CELL_TEXT_COLUMNS = new Set(RANGE_COLUMNS);

/**
 * What Ctrl+C and Ctrl+V act on: one cell, when a value cell has focus and no
 * more than its own row is selected; otherwise whole rows, as a click in the #
 * column or a multi-row selection asks for.
 *
 * Which columns a row actually carries depends on its operand type: a thickness
 * constraint has no angle, a measured curve no target, and those cells show a
 * dash. A dash holds nothing to copy and must not be pasted over, so the row
 * stays the unit there.
 */
export function clipboardScope({ op, focusCell, selectedIds }) {
    if (!focusCell || !CELL_TEXT_COLUMNS.has(focusCell.colKey)) return 'rows';
    if (op && !editableColsForRow(op).includes(focusCell.colKey)) return 'rows';
    return selectedIds.size > 1 ? 'rows' : 'cell';
}

/** The text a cell shows in its editor, which is also what it copies. */
export function cellText(op, colKey, mathPercent) {
    return colKey === 'target' ? targetInitialValue(op, mathPercent) : String(op[colKey] ?? '');
}

/**
 * A rectangle of cells as tab-separated lines, one per row. A cell the row does
 * not carry is left empty, so the columns stay aligned for whatever reads it.
 */
export function rangeText(operands, range, isMathPct) {
    const lines = [];
    for (let rowIdx = range.rowStart; rowIdx <= range.rowEnd; rowIdx++) {
        const op = operands[rowIdx];
        const columns = op ? editableColsForRow(op) : [];
        lines.push(range.colKeys
            .map(colKey => (columns.includes(colKey) ? cellText(op, colKey, isMathPct(op)) : ''))
            .join('\t'));
    }
    return lines.join('\n');
}

/**
 * The selected cells as text when they are not one rectangle: the cells of a
 * row tab-separated, rows on their own lines, in table order.
 */
export function selectionText(operands, selection, isMathPct) {
    const lines = new Map();
    for (const { rowIdx, colKey } of selectedCells(selection)) {
        const op = operands[rowIdx];
        if (!op || !editableColsForRow(op).includes(colKey)) continue;
        if (!lines.has(rowIdx)) lines.set(rowIdx, []);
        lines.get(rowIdx).push(cellText(op, colKey, isMathPct(op)));
    }
    return [...lines.values()].map(cells => cells.join('\t')).join('\n');
}

export function copyCellText(text, clipboard = navigator.clipboard) {
    clipboard?.writeText(text).catch(() => {});
}

/** Clipboard text as rows of cells: lines split on tabs. */
export function parseCellGrid(text) {
    return (text || '').replace(/\s+$/, '').split(/\r?\n/).map(line => line.split('\t'));
}

/**
 * Whether the clipboard holds operand rows, as Ctrl+C on rows writes them:
 * every line has the seven row fields and opens with a type code. Anything
 * else is a grid of cell values.
 */
export function looksLikeOperandRows(grid) {
    return grid.length > 0 && grid.every(line => line.length === 7 && OPERAND_TYPES.includes(line[0]));
}

/**
 * The edits a grid of text makes to the table: one entry per target cell, in
 * the form the window's edit callback takes. Text a cell cannot hold is skipped.
 */
export function gridEdits({ grid, range, focus, operands, cells, text }) {
    const edits = [];
    const targets = cells
        ? cells.map(cell => ({ ...cell, text }))
        : pasteTargets({ grid, range, focus, operands });
    for (const target of targets) {
        const op = operands[target.rowIdx];
        const edit = cellEdit(op, target.colKey, target.text);
        if (edit) edits.push({ id: op.id, key: edit[0], value: edit[1] });
    }
    return edits;
}

function applyEdits(ctx, edits) {
    if (edits.length === 0) return;
    if (ctx.onEditMany) ctx.onEditMany(edits);
    else edits.forEach(edit => ctx.onEdit(edit.id, edit.key, edit.value));
}

/**
 * Paste into the focused cell or over the selected range. A single value into
 * a single cell goes through the cell editor's own commit, so percent and ramp
 * syntax apply. Operand rows, as Ctrl+C on rows writes them, are inserted below
 * the focused row unless a range is selected. Any other grid of values is laid
 * over the range, or from the focused cell down and to the right.
 */
export function pasteIntoCell(ctx, clipboard = navigator.clipboard) {
    clipboard?.readText().then(raw => {
        const grid = parseCellGrid(raw);
        const single = grid.length === 1 && grid[0].length === 1;
        if (single && grid[0][0] === '') return;
        // Cells gathered with Ctrl take one value each, whatever their shape.
        if (single && ctx.extraCells?.size) {
            const cells = selectedCells({
                range: ctx.range, extraCells: ctx.extraCells, focus: { rowIdx: ctx.rowIdx, colKey: ctx.colKey },
            });
            applyEdits(ctx, gridEdits({ grid, range: null, focus: null, operands: ctx.operands, cells, text: grid[0][0] }));
            return;
        }
        if (!ctx.range && single) {
            ctx.commitEdit(ctx.rowIdx, ctx.colKey, grid[0][0]);
            return;
        }
        if (!ctx.range && looksLikeOperandRows(grid)) {
            const items = parseOperandsTsv(raw);
            if (items.length) ctx.onAdd(items, ctx.rowIdx + 1);
            return;
        }
        applyEdits(ctx, gridEdits({
            grid, range: ctx.range || null, focus: { rowIdx: ctx.rowIdx, colKey: ctx.colKey }, operands: ctx.operands,
        }));
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

// With Shift held an arrow stretches the range from the anchor instead of
// moving the focus; sideways it stays on the focused row.
function moveVertical(ctx, step) {
    ctx.event.preventDefault();
    const rowIdx = Math.max(0, Math.min(ctx.rowIdx + step, ctx.operands.length - 1));
    if (ctx.event.shiftKey && ctx.extendTo) ctx.extendTo(rowIdx, ctx.colKey);
    else ctx.focusAt(rowIdx, ctx.colKey);
}

function moveHorizontal(ctx, direction) {
    ctx.event.preventDefault();
    if (ctx.event.shiftKey && ctx.extendTo) {
        const target = navigationTarget(ctx.operands, ctx.rowIdx, ctx.colKey, direction);
        if (target && !target.focus) ctx.extendTo(ctx.rowIdx, target.colKey);
        return;
    }
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

function collapseRange(ctx) {
    if (!ctx.range || !ctx.collapseRange) return;
    ctx.event.preventDefault();
    ctx.collapseRange();
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
    ArrowDown: ctx => moveVertical(ctx, 1),
    ArrowUp: ctx => moveVertical(ctx, -1),
    ArrowRight: ctx => moveHorizontal(ctx, 'right'),
    ArrowLeft: ctx => moveHorizontal(ctx, 'left'),
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
