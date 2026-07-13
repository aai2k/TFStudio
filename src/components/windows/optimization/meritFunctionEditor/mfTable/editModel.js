import {
    isArgwave, isConstraint, isMath, isRangeTarget, isTotalThickness,
} from '../../../../../utils/physics/optimizer.js';
import { RANGE_TARGET_TYPES } from './operandViewModel.js';

export function targetInitialValue(op, mathPercent) {
    if (isRangeTarget(op.type)) {
        const end = op.targetEnd != null ? op.targetEnd : op.target;
        return `${(op.target * 100).toFixed(1)}→${(end * 100).toFixed(1)}`;
    }
    if (isMath(op.type) && mathPercent) return (op.target * 100).toFixed(2);
    if (isConstraint(op.type) || isTotalThickness(op.type) || isArgwave(op.type) || isMath(op.type)) {
        return String(op.target ?? 0);
    }
    return (op.target * 100).toFixed(2);
}

export function parseRampTarget(op, draft) {
    const raw = (draft ?? '').toString().trim();
    const arrow = raw.includes('→') ? '→' : raw.includes('->') ? '->' : null;
    if (arrow === null || !RANGE_TARGET_TYPES.has(op.type)) return null;
    const pivot = raw.indexOf(arrow);
    const start = parseFloat(raw.slice(0, pivot));
    const end = parseFloat(raw.slice(pivot + arrow.length));
    if (isNaN(start) || isNaN(end)) return null;
    const patch = { target: start / 100, targetEnd: end / 100 };
    if (Number.isFinite(op.rampPoints)) patch.rampPoints = op.rampPoints;
    return patch;
}

export function commitTarget(op, draft, onEdit) {
    const raw = (draft ?? '').toString().trim();
    const patch = parseRampTarget(op, draft);
    if (RANGE_TARGET_TYPES.has(op.type) && (raw.includes('→') || raw.includes('->'))) {
        if (patch) onEdit(op.id, '_patch', patch);
        return;
    }
    const value = parseFloat(raw);
    if (!isNaN(value)) onEdit(op.id, 'target', value);
}

export function startEdit(ctx, rowIdx, colKey, initChar) {
    const { operands, onEdit, isMathPct, setFocusCell, setEditCell } = ctx;
    const op = operands[rowIdx];
    if (!op || colKey === 'num' || colKey === 'current' || colKey === 'delta') return;
    if (colKey === 'enabled') {
        onEdit(op.id, 'enabled', !op.enabled);
        return;
    }
    if (colKey === 'type' || colKey === 'pol') {
        setFocusCell({ rowIdx, colKey });
        return;
    }
    const value = colKey === 'target' ? targetInitialValue(op, isMathPct(op)) : String(op[colKey] ?? '');
    setEditCell({ rowIdx, colKey, initValue: initChar != null ? initChar : value });
}

export function commitEdit(ctx, rowIdx, colKey, draft) {
    const { operands, onEdit, setEditCell } = ctx;
    setEditCell(null);
    const op = operands[rowIdx];
    if (!op) return;
    if (colKey === 'target') {
        commitTarget(op, draft, onEdit);
        return;
    }
    const value = parseFloat(draft);
    if (!isNaN(value)) onEdit(op.id, colKey, value);
}
