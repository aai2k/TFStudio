// A design's merit function: setting its rows, and the total and each row's
// value as the Merit Function Editor shows them (utils/physics/meritDisplay.js).

import { isKnownOperandType, isValidMeritWeight, isConstraint, readsWavelengthBand, OPERAND_TYPES } from '../utils/physics/optimizer.js';
import { isMeasuredCurve } from '../utils/physics/optimizer/measuredCurveType.js';
import { makeRowOperand } from '../components/windows/optimization/meritFunctionEditor/meritOperandModel.js';
import { withHerpinRecords } from '../utils/materials/designMaterials.js';
import { meritTable } from '../utils/physics/meritDisplay.js';
import { requireResolved } from './materials.js';
import { isAngle, shown } from './check.js';

let rowSeq = 0;

// The fields an operand row holds, over every operand type: the editor's
// columns and what each type keeps beside them (operandModel.js makeOperand,
// the evaluators that read them, the integral presets and the measured-curve
// rows the curve windows write).
const ROW_FIELDS = [
    'id', 'enabled', 'type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'targetEnd', 'weight',
    'cmp', 'comment', 'detector', 'quantity', 'source', 'refId', 'refId1', 'refId2', 'baseType',
    'bandPoints', 'rampPoints', 'curveId', 'curveName', 'levelFree', 'measuredCurveBlockId', 'measurementSide',
    'side', 'deltaConvention', 'flag', 'sampleLambdas', 'sampleTargets', 'gridMode', 'sourceSpacingNm',
    'presetKey', 'presetLabel',
];

const isNumber = v => Number.isFinite(v);
const CHECKS = [
    ['enabled', v => typeof v === 'boolean', 'true or false'],
    ['lambdaStart', isNumber, 'a number'],
    ['lambdaEnd', isNumber, 'a number'],
    ['aoi', isAngle, 'an angle of incidence in degrees, 0 <= aoi < 90'],
    ['pol', v => ['avg', 's', 'p'].includes(v), "'avg', 's' or 'p'"],
    ['target', isNumber, 'a number (T, R and A as fractions of 1)'],
    ['targetEnd', v => v === null || isNumber(v), 'a number or null'],
    ['weight', isValidMeritWeight, 'a number of 0 or more'],
];

// What is wrong with merit row `row`, or null.
function rowProblem(row) {
    if (!row || typeof row !== 'object' || !isKnownOperandType(row.type)) {
        return `unknown operand type '${row?.type}'. Types: ${OPERAND_TYPES.join(', ')}`;
    }
    const unknown = Object.keys(row).find(key => !ROW_FIELDS.includes(key));
    if (unknown) return `'${unknown}' is not a field of a merit row; a row takes ${ROW_FIELDS.join(', ')}`;
    for (const [field, ok, takes] of CHECKS) {
        if (field in row && !ok(row[field])) return `${field} is ${takes}, not ${shown(row[field])}`;
    }
    return null;
}

// The row `row` makes, as the editor makes one. makeOperand reads a target of
// 0.99 as the editor's placeholder for a new row and seeds the type's own
// default; a target the caller gives is kept, as the editor keeps a typed one.
// A measured curve's target is fixed at 0.
function madeRow(row) {
    const made = makeRowOperand(row);
    if ('target' in row && !isMeasuredCurve(row.type)) made.target = row.target;
    return made;
}

// Only a row over a band or a layer range reads lambdaEnd; a single
// wavelength row keeps it from an earlier type unread, as the editor does.
function bandProblem(op) {
    const ranged = readsWavelengthBand(op.type) || isConstraint(op.type);
    return ranged && op.lambdaStart > op.lambdaEnd ? `lambdaStart ${op.lambdaStart} is above lambdaEnd ${op.lambdaEnd}` : null;
}

/**
 * `design` with its merit function made of `rows`: each an operand row with
 * at least `type`, the other fields defaulting as a row added in the editor
 * does (meritOperandModel.js makeRowOperand: an MNT or MXT row covers layers 1
 * to 1000, counted from the substrate), e.g. { type: 'RAV', lambdaStart: 400,
 * lambdaEnd: 700, target: 0, weight: 1 }. Targets for T, R and A are fractions
 * of 1. A type this build does not evaluate, a field no operand of this build
 * has (a misspelling, or a field a newer release wrote), or a value a field
 * cannot take is refused, naming what it takes.
 */
export function setMerit(design, rows) {
    if (!Array.isArray(rows)) throw new Error('setMerit: rows is a list of operand rows');
    const operands = rows.map((row, i) => {
        const problem = rowProblem(row);
        if (problem) throw new Error(`setMerit: row ${i}: ${problem}`);
        const made = madeRow(row);
        const band = bandProblem(made);
        if (band) throw new Error(`setMerit: row ${i}: ${band}`);
        return { ...made, id: row.id ?? `api-op-${++rowSeq}`, enabled: row.enabled ?? true };
    });
    return { ...design, meritOperands: operands };
}

/**
 * The merit of `design` against its merit function, as the Merit Function
 * Editor shows it: { total, optical (the merit without the manufacturing rows
 * MNT, MXT, TT and STR), rows: [{ type, value, target, weight, enabled, error }] }.
 * total and optical are null while a row cannot be evaluated; that row's
 * `error` says why.
 */
export function merit(design) {
    requireResolved(design);
    const operands = design.meritOperands || [];
    const result = meritTable(withHerpinRecords(design), operands);
    return {
        total: result.mf, optical: result.omf,
        rows: operands.map((op, i) => ({
            type: op.type, value: result.computed[i], target: op.target, weight: op.weight,
            enabled: op.enabled !== false, error: result.errors[i] ? String(result.errors[i]) : null,
        })),
    };
}
