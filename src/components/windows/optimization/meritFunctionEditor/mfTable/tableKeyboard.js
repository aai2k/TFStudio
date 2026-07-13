import {
    OPERAND_POLS, OPERAND_TYPES, isFractionalUnit,
} from '../../../../../utils/physics/optimizer.js';

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
        const safeType = OPERAND_TYPES.includes(type) ? type : 'RAV';
        items.push({
            type: safeType,
            lambdaStart: isFinite(start) ? start : 400,
            lambdaEnd: isFinite(end) ? end : 700,
            aoi: isFinite(aoi) ? aoi : 0,
            pol: OPERAND_POLS.includes(pol) ? pol : 'avg',
            target: isFinite(target) ? (isFractionalUnit(safeType) ? target / 100 : target) : 0,
            weight: isFinite(weight) ? weight : 1,
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
    const ctrlKey = event.ctrlKey ? { c: 'Ctrl+c', v: 'Ctrl+v' }[key] : null;
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

function copyRows(ctx) {
    ctx.event.preventDefault();
    copySelectedOperands(ctx.operands, ctx.selectedIds);
}

function pasteRows(ctx) {
    ctx.event.preventDefault();
    pasteOperands(ctx.onAdd, ctx.rowIdx + 1);
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

export function doKeyDown(ctx, event) {
    const { editCell, focusCell, selectedIds, operands, startEdit } = ctx;
    if (editCell || (!focusCell && selectedIds.size === 0)) return;
    const rowIdx = focusCell?.rowIdx ?? operands.findIndex(op => selectedIds.has(op.id));
    if (rowIdx < 0) return;
    const colKey = focusCell?.colKey ?? 'type';
    const handled = runKeyAction(keyComboOf(event), { ...ctx, event, rowIdx, colKey });
    if (!handled && isPrintableEditKey(event)) {
        startEdit(rowIdx, colKey, event.key);
    }
}
