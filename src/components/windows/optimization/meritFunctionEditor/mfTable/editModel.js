import {
    EXTREMUM_FLAG_MAX, GENERATED_ONLY_OPERAND_TYPES, OPERAND_POLS, OPERAND_TYPES,
    extremumFlag, isFractionalUnit, isMath, isRangeTarget, isValidMeritWeight, polFromType,
} from '../../../../../utils/physics/optimizer.js';
import { parseNumberStrict } from '../../../../../utils/misc/numberParsing.js';
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
    const start = parseNumberStrict(raw.slice(0, pivot));
    const end = parseNumberStrict(raw.slice(pivot + arrow.length));
    if (isNaN(start) || isNaN(end)) return null;
    const patch = { target: start / 100, targetEnd: end / 100 };
    if (Number.isFinite(op.rampPoints)) patch.rampPoints = op.rampPoints;
    return patch;
}

/** The polarization a typed letter stands for: a, s or p. */
export function polFromKey(char) {
    return { a: 'avg', s: 's', p: 'p' }[String(char ?? '').toLowerCase()] || null;
}

/** The text a cell shows in its editor, which is also what it copies. */
export function cellInitialText(op, colKey, mathPercent) {
    if (colKey === 'target') return targetInitialValue(op, mathPercent);
    if (colKey === 'flag') return String(extremumFlag(op));
    return String(op[colKey] ?? '');
}

// How the text typed into a cell becomes its edit, for the cells that hold
// something other than a plain number.
const CELL_PARSERS = {
    // A flag is a whole number from 1 to EXTREMUM_FLAG_MAX.
    flag(op, raw) {
        const level = parseNumberStrict(raw);
        return Number.isInteger(level) && level >= 1 && level <= EXTREMUM_FLAG_MAX ? ['flag', level] : null;
    },
    type(op, raw) {
        const code = raw.toUpperCase();
        const known = OPERAND_TYPES.includes(code) && !GENERATED_ONLY_OPERAND_TYPES.includes(code);
        return known ? ['type', code] : null;
    },
    pol(op, raw) {
        const pol = OPERAND_POLS.includes(raw) ? raw : polFromKey(raw);
        return pol ? ['pol', pol] : null;
    },
    target(op, raw) {
        if (RANGE_TARGET_TYPES.has(op.type) && (raw.includes('→') || raw.includes('->'))) {
            const patch = parseRampTarget(op, raw);
            return patch ? ['_patch', patch] : null;
        }
        const value = parseNumberStrict(raw);
        return isNaN(value) ? null : ['target', value];
    },
};

/**
 * The edit a typed or pasted text makes to one cell, as the `[key, value]`
 * pair `onEdit` takes, or null when the text is not a value the cell can hold.
 *
 * A type code is matched regardless of case; a generated-only type is refused,
 * since its rows carry data no text can supply. A polarization takes the full
 * word or its first letter. A target keeps the ramp syntax of a spectral
 * target; a flag is a whole number from 1 to the finest level; everything else
 * is a number, with a comma or a dot as the decimal mark. Text that is not a
 * number from start to end, such as '94abc', is refused rather than read up to
 * the first letter.
 */
export function cellEdit(op, colKey, draft) {
    const raw = (draft ?? '').toString().trim();
    const parse = CELL_PARSERS[colKey];
    if (parse) return parse(op, raw);
    const value = parseNumberStrict(raw);
    if (isNaN(value) || (colKey === 'weight' && !isValidMeritWeight(value))) return null;
    return [colKey, value];
}

export function commitTarget(op, draft, onEdit) {
    const edit = cellEdit(op, 'target', draft);
    if (edit) onEdit(op.id, edit[0], edit[1]);
}

// Pol: a typed a, s or p sets it outright; Enter or a double-click opens the
// list of three. A type that carries its own polarization takes no edit.
function startPolEdit(ctx, op, rowIdx, initChar) {
    if (polFromType(op.type)) return;
    if (initChar != null) {
        const pol = polFromKey(initChar);
        if (pol) ctx.onEdit(op.id, 'pol', pol);
        return;
    }
    ctx.setFocusCell({ rowIdx, colKey: 'pol' });
    ctx.setEditCell({ rowIdx, colKey: 'pol', initValue: op.pol });
}

// How editing starts in the cells that open something other than the text
// editor.
const EDIT_STARTERS = {
    enabled: (ctx, op) => ctx.onEdit(op.id, 'enabled', !op.enabled),
    type(ctx, op, rowIdx, initChar) {
        ctx.setFocusCell({ rowIdx, colKey: 'type' });
        ctx.setEditCell({ rowIdx, colKey: 'type', initValue: initChar ?? '' });
    },
    pol: startPolEdit,
};

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
    const op = ctx.operands[rowIdx];
    if (!op || !editableColsForRow(op).includes(colKey)) return;
    const starter = EDIT_STARTERS[colKey];
    if (starter) {
        starter(ctx, op, rowIdx, initChar);
        return;
    }
    const value = cellInitialText(op, colKey, ctx.isMathPct(op));
    ctx.setEditCell({ rowIdx, colKey, initValue: initChar != null ? initChar : value });
}
export function commitEdit(ctx, rowIdx, colKey, draft) {
    const { operands, onEdit, setEditCell } = ctx;
    setEditCell(null);
    const op = operands[rowIdx];
    if (!op) return;
    const edit = cellEdit(op, colKey, draft);
    if (edit) onEdit(op.id, edit[0], edit[1]);
}
