/**
 * The cells that hold a value out of a list: in the λ columns, in place of a
 * wavelength, a math row's references, a thickness or force row's comparison,
 * an integral's preset and a PPEF row's curve block; and on a design with
 * environments, the Env cell, the environment a row is scored in. For each,
 * the entries its list offers, the one the row holds, and the edit a pick
 * makes. The cells draw these (OperandCells.js); the clipboard copies a cell
 * as the name of the entry it holds and takes a pasted name as a pick
 * (cellClipboard.js).
 *
 * `table` is { operands, integralPresets, environments }: the rows a
 * reference or a curve block is picked from, the presets an integral can take,
 * and the environments a row can be scored in (tableEnvironments.js).
 */
import {
    isEllipsometricMeasuredCurve, isIntegral, isLinearThickness, isMath, isMathPairRef, isMeasuredCurve, isPPEF,
} from '../../../../../utils/physics/optimizer.js';
import { takesEnvironment } from './operandViewModel.js';

// The ≤ / ≥ / = a thickness or force row carries in place of a wavelength: the
// total thickness in nm (TT) or the film force in N/m (STR) held against the
// row's target. The evaluation reads anything but ≤ or ≥ as =.
const COMPARISONS = [
    { value: 'le', label: '≤' },
    { value: 'ge', label: '≥' },
    { value: 'eq', label: '=' },
];

const INTEGRAL_TYPES = { T: 'TIW', R: 'RIW', A: 'AIW' };

// The field a math row's reference is kept in. A pair row reads its first row
// in λ Start and its second in λ End.
function referenceKey(op, colKey) {
    if (!isMathPairRef(op.type)) return 'refId';
    return colKey === 'lambdaEnd' ? 'refId2' : 'refId1';
}

// Each list: the entries it offers, the value the row keeps for it, and the
// edit picking a value makes, as the [key, value] pair onEdit takes. A pick
// of null empties a reference or a curve block; an integral takes only a
// preset.
const LISTS = {
    // The table's other rows, by number and type, such as #4 TMN.
    reference: {
        options: (op, colKey, { operands }) => operands.flatMap((row, index) => (
            row.id === op.id ? [] : [{ value: row.id, label: `#${index + 1} ${row.type}` }])),
        held: (op, colKey) => op[referenceKey(op, colKey)],
        edit: (op, colKey, refId) => ['_patch', { [referenceKey(op, colKey)]: refId }],
    },
    comparison: {
        options: () => COMPARISONS,
        held: op => (op.cmp === 'le' || op.cmp === 'ge' ? op.cmp : 'eq'),
        edit: (op, colKey, cmp) => ['cmp', cmp],
    },
    // A preset brings its channel, source, detector and band with it.
    integral: {
        options: (op, colKey, { integralPresets }) =>
            integralPresets.map(preset => ({ value: preset.key, label: preset.label })),
        held: op => op.presetKey,
        edit(op, colKey, key, { integralPresets }) {
            const preset = integralPresets.find(item => item.key === key);
            if (!preset) return null;
            return ['_patch', {
                type: INTEGRAL_TYPES[preset.char] || op.type,
                presetKey: preset.key,
                source: { ...preset.sourceSpec },
                detector: { ...preset.detectorSpec },
                lambdaStart: preset.band[0],
                lambdaEnd: preset.band[1],
            }];
        },
    },
    // The table's T, R and A curve blocks, by number and curve name.
    curve: {
        options: (op, colKey, { operands }) => operands.flatMap((row, index) => (
            isMeasuredCurve(row.type) && !isEllipsometricMeasuredCurve(row)
                ? [{ value: row.id, label: `#${index + 1} ${row.curveName || 'MCURVE'}` }]
                : [])),
        held: op => op.refId,
        edit: (op, colKey, refId) => ['_patch', { refId }],
    },
    // Every environment, the null entry, then each one by number and name.
    environment: {
        options: (op, colKey, { environments }) => [{ value: null, label: environments.all }, ...environments.list],
        held: op => op.env ?? null,
        edit: (op, colKey, env) => ['env', env],
    },
};

// The rows whose λ Start holds a value out of a list, and which list.
const LIST_IN_LAMBDA_START = [
    [isMath, 'reference'], [isLinearThickness, 'comparison'], [isIntegral, 'integral'], [isPPEF, 'curve'],
];

/** Which list a cell picks from, or null for a cell that takes text. */
export function listKind(op, colKey) {
    if (colKey === 'env') return takesEnvironment(op) ? 'environment' : null;
    if (colKey === 'lambdaEnd') return isMathPairRef(op.type) ? 'reference' : null;
    if (colKey !== 'lambdaStart') return null;
    return LIST_IN_LAMBDA_START.find(([test]) => test(op.type))?.[1] ?? null;
}

/**
 * A list cell's list: its entries, [{ value, label }] in list order; the value
 * the row holds, or null when it holds none of them; and `gone`, set when the
 * row names an entry the list no longer has, such as a row since deleted.
 */
export function listOf(op, colKey, table) {
    const list = LISTS[listKind(op, colKey)];
    const options = list.options(op, colKey, table);
    const held = list.held(op, colKey);
    const found = options.some(option => option.value === held);
    return { options, value: found ? held : null, gone: !!held && !found };
}

/** The edit picking `value` makes, or null for a pick that changes nothing. */
export function listEdit(op, colKey, value, table) {
    return LISTS[listKind(op, colKey)].edit(op, colKey, value, table);
}

/** What a list cell copies: the name of the entry it holds, or nothing. */
export function listText(op, colKey, table) {
    const { options, value } = listOf(op, colKey, table);
    return options.find(option => option.value === value)?.label ?? '';
}

/**
 * The edit a pasted name makes: a pick of the entry of that name, matched
 * regardless of case, or null for text that names no entry.
 */
export function listPaste(op, colKey, text, table) {
    const name = text.trim().toLowerCase();
    const entry = listOf(op, colKey, table).options.find(option => option.label.toLowerCase() === name);
    return entry ? listEdit(op, colKey, entry.value, table) : null;
}
