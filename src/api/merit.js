// A design's merit function: setting its rows, and the total and each row's
// value as the Merit Function Editor shows them (utils/physics/meritDisplay.js).

import {
    isKnownOperandType, isValidMeritWeight, isConstraint, isLinearThickness, isEllipsometry, readsWavelengthBand, polFromType, OPERAND_TYPES,
    EXTREMUM_FLAG_MAX, makeOperand,
} from '../utils/physics/optimizer.js';
import { isMeasuredCurve, isEllipsometricMeasuredCurve } from '../utils/physics/optimizer/measuredCurveType.js';
import { makeRowOperand } from '../components/windows/optimization/meritFunctionEditor/meritOperandModel.js';
import { editableColsForRow } from '../components/windows/optimization/meritFunctionEditor/mfTable/operandViewModel.js';
import { withHerpinRecords } from '../utils/materials/designMaterials.js';
import { meritTable } from '../utils/physics/meritDisplay.js';
import { requireResolved } from './materials.js';
import { warnWithoutKernel } from './environment.js';
import { isAngle, shown, refusal } from './check.js';

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
    ['cmp', v => ['eq', 'le', 'ge'].includes(v), "'eq', 'le' or 'ge'"],
    ['flag', v => Number.isInteger(v) && v >= 1 && v <= EXTREMUM_FLAG_MAX, `a whole number from 1 to ${EXTREMUM_FLAG_MAX}`],
];

// Refuses merit row `row`, row `i` of those given, unless this version
// evaluates its type and each field it has is a field of a row, holding a
// value that field can take.
function checkRow(row, i) {
    const at = `setMerit: row ${i}: `;
    if (!row || typeof row !== 'object' || !isKnownOperandType(row.type)) {
        throw new Error(`${at}unknown operand type '${row?.type}'. Types: ${OPERAND_TYPES.join(', ')}`);
    }
    const unknown = Object.keys(row).find(key => !ROW_FIELDS.includes(key));
    if (unknown) {
        throw refusal('unknownOption', { call: 'setMerit', row: i, option: unknown, options: ROW_FIELDS },
            `${at}'${unknown}' is not a field of a merit row; a row takes ${ROW_FIELDS.join(', ')}`);
    }
    const [field, , takes] = CHECKS.find(([name, ok]) => name in row && !ok(row[name])) ?? [];
    if (field) throw refusal('badValue', { call: 'setMerit', row: i, option: field, takes, value: row[field] }, `${at}${field} is ${takes}, not ${shown(row[field])}`);
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

// Whether `op` reads a band or a layer range that starts above its end. Only
// such a row reads lambdaEnd; a single wavelength row keeps it from an earlier
// type unread, as the editor does.
const isReversed = op => (readsWavelengthBand(op.type) || isConstraint(op.type)) && op.lambdaStart > op.lambdaEnd;

/**
 * A design with its merit function replaced by the rows given, as the
 * [Merit Function Editor](/design/merit-function-editor/) holds them. Each row
 * is an operand of the [Operand Reference](/design/operands/), which says what
 * each one computes and which fields it reads. A field a row leaves out takes
 * the value a row added in the editor starts with; an MNT or MXT row covers
 * layers 1 to 1000, counted from the substrate.
 *
 * @param design The design.
 * @param rows The rows, in order, each an object with at least a `type`.
 * @param rows[].type The operand, such as `'RAV'` or `'MNT'`.
 * @param [rows[].lambdaStart] The wavelength, or the first wavelength of the band, nm; for MNT and MXT the first layer.
 * @param [rows[].lambdaEnd] The last wavelength of the band, nm; for MNT and MXT the last layer.
 * @param [rows[].aoi] The angle of incidence, degrees in the incident medium.
 * @param [rows[].pol] `'avg'`, `'s'` or `'p'`.
 * @param [rows[].target] The value the row drives toward, or its bound, in the row's unit: R, T and A as fractions of 1, where the editor shows percent; a thickness in nm for MNT and MXT.
 * @param [rows[].targetEnd] The target at `lambdaEnd` of a spectral target that slopes, or null for a flat one.
 * @param [rows[].weight] How much the row counts, 0 or more.
 * @param [rows[].cmp] For TT and STR, the comparison: `'eq'`, `'le'` or `'ge'`.
 * @param [rows[].flag] The editor's Flag column, a whole number; the Operand Reference says what it does on each row.
 * @param [rows[].enabled=true] `false` leaves the row out of the merit.
 * @param [rows[].id] A name for the row, which a math row gives in `refId`, `refId1` or `refId2` to read it.
 * @param [rows[].refId] For a math row that reads one row, that row's `id`; `refId1` and `refId2` for one that reads two.
 * @param [rows[].comment] The text of a BLNK row.
 * @returns The design with the merit function, which it holds in `meritOperands`.
 * @throws a type this version does not evaluate
 * @throws a field no row has, such as a misspelling, or a value a field cannot take
 * @throws a `lambdaStart` above `lambdaEnd` on a row that reads a band or a layer range
 * @example
 * tf.design = tf.setMerit(tf.design, [
 *     { type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 },
 *     { type: 'MNT', target: 10, weight: 1 },
 * ]);
 * console.log('Merit:', tf.merit(tf.design).total);
 */
export function setMerit(design, rows) {
    // Rows are made as the editor makes them (meritOperandModel.js
    // makeRowOperand). The fields of the curve and integral rows the app
    // writes are taken too (ROW_FIELDS).
    if (!Array.isArray(rows)) throw new Error('setMerit: rows is a list of operand rows');
    const operands = rows.map((row, i) => {
        checkRow(row, i);
        const made = madeRow(row);
        if (isReversed(made)) {
            throw refusal('bandOrder', { call: 'setMerit', row: i, start: made.lambdaStart, end: made.lambdaEnd },
                `setMerit: row ${i}: lambdaStart ${made.lambdaStart} is above lambdaEnd ${made.lambdaEnd}`);
        }
        // A row given no id takes a fresh one, as the editor gives a new row
        // (operandModel.js makeOperand), so the rows of separate runs, and a
        // row added to a design whose rows an earlier run made, never share one.
        return { ...made, id: row.id ?? makeOperand().id, enabled: row.enabled ?? true };
    });
    return { ...design, meritOperands: operands };
}

// Ψ and Δ (from ρ = r_p/r_s) and the phase difference of p and s are scored
// on both polarizations at once and never read pol.
const takesBothPolarizations = type => isEllipsometry(type) || type === 'DPR' || type === 'DPT';

// A measured curve's band, angle and polarization, as the editor shows them
// (measuredCells.js): its band is the snapshot's, and a Ψ or Δ block has no
// polarization.
function measuredScope(op) {
    const pol = isEllipsometricMeasuredCurve(op) ? {} : { pol: op.pol || 'avg' };
    return { lambdaStart: op.lambdaStart, lambdaEnd: op.lambdaEnd, aoi: op.aoi ?? 0, ...pol };
}

// What a row scores, beside its type: TT and STR their comparison, MNT and
// MXT their layer range, a measured curve its band, angle and polarization,
// and a row the editor gives an angle column (operandViewModel.js
// editableColsForRow) its wavelength, or its band where it reads one, its
// angle and the polarization it is scored in.
function rowScope(op) {
    if (isLinearThickness(op.type)) return { cmp: op.cmp ?? 'eq' };
    if (isConstraint(op.type)) return { lambdaStart: op.lambdaStart, lambdaEnd: op.lambdaEnd };
    if (isMeasuredCurve(op.type)) return measuredScope(op);
    if (!editableColsForRow(op).includes('aoi')) return {};
    const band = readsWavelengthBand(op.type) ? { lambdaEnd: op.lambdaEnd } : {};
    const pol = takesBothPolarizations(op.type) ? {} : { pol: polFromType(op.type) ?? op.pol };
    return { lambdaStart: op.lambdaStart, ...band, aoi: op.aoi, ...pol };
}

/**
 * The merit of a design against its merit function, the total and each row,
 * as the Merit Function Editor shows them.
 *
 * @param design The design.
 * @returns The merit.
 * @property total The merit function, or null while a row cannot be evaluated.
 * @property optical The merit without the manufacturing rows MNT, MXT, TT and STR, or null as `total`.
 * @property rows One per row of the merit function, in order.
 * @property rows[].type The operand.
 * @property rows[].lambdaStart The row's wavelength, or the first wavelength of its band, nm; the first layer for MNT and MXT. Absent on a row that reads none.
 * @property rows[].lambdaEnd The last wavelength of the band, nm, on a row that reads a band; the last layer for MNT and MXT.
 * @property rows[].aoi The angle of incidence, on a row that reads one.
 * @property rows[].pol The polarization the row is scored in; absent on a row scored on both, such as PSI or DPR.
 * @property rows[].cmp For TT and STR, the comparison.
 * @property rows[].value The row's value for the design as it is.
 * @property rows[].target The row's target.
 * @property rows[].weight The row's weight.
 * @property rows[].enabled `false` for a row left out of the merit.
 * @property rows[].error Why the row cannot be evaluated, or null.
 * @throws a design that names a material that resolves to nothing
 * @example
 * const m = tf.merit(tf.design);
 * console.log('Merit:', m.total);
 * for (const row of m.rows) console.log(row.type, row.value, row.target);
 */
export function merit(design) {
    requireResolved(design);
    const operands = design.meritOperands || [];
    if (operands.length) warnWithoutKernel();
    const result = meritTable(withHerpinRecords(design), operands);
    return {
        total: result.mf, optical: result.omf,
        rows: operands.map((op, i) => ({
            type: op.type, ...rowScope(op), value: result.computed[i], target: op.target, weight: op.weight,
            enabled: op.enabled !== false, error: result.errors[i] ? String(result.errors[i]) : null,
        })),
    };
}
