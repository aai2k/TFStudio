import {
    GENERATED_ONLY_OPERAND_TYPES, OPERAND_POLS, OPERAND_TYPES,
    flagStepNm, isBandGridRow, isFractionalUnit, isMath, isRangeTarget, isValidMeritWeight, polFromType,
} from '../../../../../utils/physics/optimizer.js';
import { parseNumberStrict } from '../../../../../utils/misc/numberParsing.js';
import { listKind, listPaste, listText } from './listValues.js';
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

/**
 * The Flag cell's text: the row's Step (operandModel.js flagStepNm), or the
 * Step it reads without one, 0 on a band row, its automatic grid, and 1 on a
 * row that looks for a peak, its 1 nm search.
 */
export function flagCellText(op) {
    if (flagStepNm(op.flag) != null) return String(op.flag);
    return isBandGridRow(op.type) ? '0' : '1';
}

/**
 * The text a cell copies, which for a cell that takes text is also what its
 * editor opens with. A cell holding a value out of a list copies that value's
 * name in the list, or nothing when it holds none of its entries; `table`
 * ({ operands, integralPresets }) holds what those lists are made of
 * (listValues.js).
 */
export function cellInitialText(op, colKey, mathPercent, table) {
    if (listKind(op, colKey)) return listText(op, colKey, table);
    if (colKey === 'target') return targetInitialValue(op, mathPercent);
    if (colKey === 'flag') return flagCellText(op);
    return String(op[colKey] ?? '');
}

// How the text typed into a cell becomes its edit, for the cells that hold
// something other than a plain number.
const CELL_PARSERS = {
    // A Step the row reads (operandModel.js flagStepNm): 1 to 4, a negative
    // step in nm, or on a band row 0, its automatic grid. The cell is never
    // empty, so an empty entry is refused like any other the row cannot take.
    flag(op, raw) {
        const level = parseNumberStrict(raw);
        if (level === 0) return isBandGridRow(op.type) ? ['flag', 0] : null;
        return flagStepNm(level) != null ? ['flag', level] : null;
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
 * target; a flag is a Step the row reads, never empty; everything else is a
 * number, with a comma or a dot as the decimal mark. Text that is not a
 * number from start to end, such as '94abc', is refused rather than read up to
 * the first letter.
 *
 * A cell holding a value out of a list, such as a math row's reference, takes
 * the name of one of its entries, as it copies, and refuses anything else, a
 * number included, so a paste never reaches the λ Start the cell hides.
 * `table` is cellInitialText's.
 */
export function cellEdit(op, colKey, draft, table) {
    const raw = (draft ?? '').toString().trim();
    if (listKind(op, colKey)) return listPaste(op, colKey, raw, table);
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

// Pol: a typed a, s or p sets it outright; Enter, Backspace or a double-click
// opens the list of three. A type that carries its own polarization takes no
// edit.
function startPolEdit(ctx, op, rowIdx, initChar) {
    if (polFromType(op.type)) return;
    if (initChar) {
        const pol = polFromKey(initChar);
        if (pol) ctx.onEdit(op.id, 'pol', pol);
        return;
    }
    ctx.setFocusCell({ rowIdx, colKey: 'pol' });
    ctx.setEditCell({ rowIdx, colKey: 'pol', initValue: op.pol });
}

// A cell holding one value out of a list opens the list. A typed character
// does nothing: none of these cells takes text.
function startListEdit(ctx, op, rowIdx, initChar, colKey) {
    if (initChar) return;
    ctx.setFocusCell({ rowIdx, colKey });
    ctx.setEditCell({ rowIdx, colKey, initValue: '' });
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

function starterFor(op, colKey) {
    return listKind(op, colKey) ? startListEdit : EDIT_STARTERS[colKey];
}

/**
 * Begin editing a cell from the keyboard or a double-click. `initChar` is the
 * character typed to start it, '' for Backspace, or null for Enter.
 *
 * Type opens the operand picker in the cell, with the typed letter already in
 * its search box. Pol opens its list of three values; a typed a, s or p sets
 * it outright instead, with no list. A math row's references, a thickness or
 * force row's comparison, an integral's preset and a PPEF row's curve block
 * open their lists. Every other editable cell opens the text editor, holding
 * the typed character, nothing after Backspace, or the current value.
 */
export function startEdit(ctx, rowIdx, colKey, initChar) {
    const op = ctx.operands[rowIdx];
    if (!op || !editableColsForRow(op).includes(colKey)) return;
    const starter = starterFor(op, colKey);
    if (starter) {
        starter(ctx, op, rowIdx, initChar, colKey);
        return;
    }
    const value = cellInitialText(op, colKey, ctx.isMathPct(op));
    ctx.setEditCell({ rowIdx, colKey, initValue: initChar != null ? initChar : value });
}
export function commitEdit(ctx, rowIdx, colKey, draft) {
    const { operands, integralPresets, onEdit, setEditCell } = ctx;
    setEditCell(null);
    const op = operands[rowIdx];
    if (!op) return;
    const edit = cellEdit(op, colKey, draft, { operands, integralPresets });
    if (edit) onEdit(op.id, edit[0], edit[1]);
}
