import {
    GENERATED_ONLY_OPERAND_TYPES, OPERAND_POLS, OPERAND_TYPES,
    isFractionalUnit, isMath, isRangeTarget, isValidMeritWeight, polFromType,
} from '../../../../../utils/physics/optimizer.js';
import { RANGE_TARGET_TYPES, editableColsForRow } from './operandViewModel.js';

export function targetInitialValue(op, mathPercent) {
    if (isRangeTarget(op.type)) {
        const end = op.targetEnd != null ? op.targetEnd : op.target;
        return `${(op.target * 100).toFixed(1)}→${(end * 100).toFixed(1)}`;
    }
    if (isMath(op.type) && mathPercent) return (op.target * 100).toFixed(2);
    if (!isFractionalUnit(op.type) || isMath(op.type)) {
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

/** The polarization a typed letter stands for: a, s or p. */
export function polFromKey(char) {
    return { a: 'avg', s: 's', p: 'p' }[String(char ?? '').toLowerCase()] || null;
}

/**
 * The edit a typed or pasted text makes to one cell, as the `[key, value]`
 * pair `onEdit` takes, or null when the text is not a value the cell can hold.
 *
 * A type code is matched regardless of case; a generated-only type is refused,
 * since its rows carry data no text can supply. A polarization takes the full
 * word or its first letter. A target keeps the ramp syntax of a spectral
 * target; everything else is a number.
 */
export function cellEdit(op, colKey, draft) {
    const raw = (draft ?? '').toString().trim();
    if (colKey === 'type') {
        const code = raw.toUpperCase();
        const known = OPERAND_TYPES.includes(code) && !GENERATED_ONLY_OPERAND_TYPES.includes(code);
        return known ? ['type', code] : null;
    }
    if (colKey === 'pol') {
        const pol = OPERAND_POLS.includes(raw) ? raw : polFromKey(raw);
        return pol ? ['pol', pol] : null;
    }
    if (colKey === 'target') {
        if (RANGE_TARGET_TYPES.has(op.type) && (raw.includes('→') || raw.includes('->'))) {
            const patch = parseRampTarget(op, raw);
            return patch ? ['_patch', patch] : null;
        }
        const value = parseFloat(raw);
        return isNaN(value) ? null : ['target', value];
    }
    const value = parseFloat(raw);
    if (isNaN(value) || (colKey === 'weight' && !isValidMeritWeight(value))) return null;
    return [colKey, value];
}

export function commitTarget(op, draft, onEdit) {
    const edit = cellEdit(op, 'target', draft);
    if (edit) onEdit(op.id, edit[0], edit[1]);
}

/**
 * Begin editing a cell from the keyboard or a double-click. `initChar` is the
 * key that started it, or null for Enter.
 *
 * Type opens the operand picker in the cell, with the typed letter already in
 * its search box. Pol opens its list of three values; a typed a, s or p sets
 * it outright instead, with no list. Every other editable cell opens the text
 * editor, holding the typed character or the current value.
 */
export function startEdit(ctx, rowIdx, colKey, initChar) {
    const { operands, onEdit, isMathPct, setFocusCell, setEditCell } = ctx;
    const op = operands[rowIdx];
    if (!op || !editableColsForRow(op).includes(colKey)) return;
    if (colKey === 'enabled') {
        onEdit(op.id, 'enabled', !op.enabled);
        return;
    }
    if (colKey === 'type') {
        setFocusCell({ rowIdx, colKey });
        setEditCell({ rowIdx, colKey, initValue: initChar ?? '' });
        return;
    }
    if (colKey === 'pol') {
        if (polFromType(op.type)) return;
        if (initChar != null) {
            const pol = polFromKey(initChar);
            if (pol) onEdit(op.id, 'pol', pol);
            return;
        }
        setFocusCell({ rowIdx, colKey });
        setEditCell({ rowIdx, colKey, initValue: op.pol });
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
    const edit = cellEdit(op, colKey, draft);
    if (edit) onEdit(op.id, edit[0], edit[1]);
}
