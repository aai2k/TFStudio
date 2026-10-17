/**
 * Per-operand analytic Jacobian-row dispatch.
 *
 * Routes one operand to the row builder for its type: band / pointwise value
 * rows (bandRows.js), single-extremum rows (extremumRows.js), the rows that
 * read the thickness vector directly (linearRows.js), phase rows
 * (phaseRows.js) and math rows (mathRows.js).
 *
 * A single-row kind is a slope builder, slope(op, i, jc, scale) =
 * scale·∂value/∂d ÷ σ over the free variables with σ the row's unit scale,
 * and a factor(op, value) = √w·∂residual/∂value, 0 where a one-sided row
 * holds. Its Jacobian row is the slope at its factor; the slope of its value
 * alone, which a math row reading it chains through, is the slope at σ.
 */

import {
    hasFreeLevel,
    isArgwave,
    isConstraint,
    isEField,
    isEllipsometry,
    isGroupDelay,
    isIntegral,
    isLinearThickness,
    isLogPoint,
    isMath,
    isMeasuredCurve,
    isMinmax,
    isPPEF,
    isPhaseShift,
    isRangeTarget,
} from '../operandModel.js';
import { _jacRowsLevelFree, _jacRowsRangeTarget, integralSlope, meanOrSingleSlope, rmsValueSlope } from './bandRows.js';
import {
    argwaveSlope, constraintFactor, constraintSlope, logPointSlope, minmaxFactor, minmaxSlope, ppefFactor, ppefSlope,
} from './extremumRows.js';
import { linearThicknessFactor, linearThicknessSlope } from './linearRows.js';
import { ellipsometrySlope, phaseSlope } from './phaseRows.js';
import { mathReadIndices, mathRow, mathValueSlope } from './mathRows.js';

const weighted = op => Math.sqrt(op.weight);

// Operand kind → [slope, factor], checked top-down; the band-average /
// single-λ builder is the fall-through default.
const ROW_KINDS = [
    [isConstraint,      constraintSlope,      constraintFactor],
    [isLinearThickness, linearThicknessSlope, linearThicknessFactor],
    [isIntegral,        integralSlope,        weighted],
    [isMinmax,          minmaxSlope,          minmaxFactor],
    [isArgwave,         argwaveSlope,         weighted],
    [isPPEF,            ppefSlope,            ppefFactor],
    [isLogPoint,        logPointSlope,        weighted],
    [isEllipsometry,    ellipsometrySlope,    weighted],
    [type => isPhaseShift(type) || isGroupDelay(type), phaseSlope, weighted],
];
const MEAN_OR_SINGLE = [null, meanOrSingleSlope, weighted];

const rowKind = type => ROW_KINDS.find(([test]) => test(type)) ?? MEAN_OR_SINGLE;

// Rows that give one residual per sample, with a builder of their own.
const isPerSample = op => isRangeTarget(op.type) || hasFreeLevel(op);

// Kinds with no thickness slope: the peak |E|² of EFMX, and a curve block read
// whole, which a run keeps only for a math row to read (measuredCurveOperand.js).
// A context whose derivatives do not reach some other kinds names them in
// jc.outOfReach(op): the needle scan, whose variables are needles rather than
// layer thicknesses (scanners/analyticScan.js).
const hasNoSlope = (op, jc) => isEField(op.type) || (isMeasuredCurve(op.type) && !hasFreeLevel(op))
    || jc.outOfReach?.(op) === true;

// ∂value/∂d of row i over the free variables, without its weight, unit scale
// or one-sided clipping, or null for a kind with no slope. Kept on jc per row,
// so a row two math rows read is differentiated once; a row met again on its
// own chain, which a row with a value cannot be, reads as having no slope.
function valueSlope(op, i, jc) {
    jc.valueSlopes ??= new Map();
    if (jc.valueSlopes.has(i)) return jc.valueSlopes.get(i);
    jc.valueSlopes.set(i, null);
    const slope = ownValueSlope(op, i, jc);
    jc.valueSlopes.set(i, slope);
    return slope;
}

function ownValueSlope(op, i, jc) {
    if (isPerSample(op)) return rmsValueSlope(op, i, jc);
    if (hasNoSlope(op, jc)) return null;
    if (isMath(op.type)) return mathValueSlope(op, i, jc, valueSlope);
    return rowKind(op.type)[1](op, i, jc, jc.residualScale(op));
}

// Whether valueSlope can give row i a slope, by its rules read from the rows
// alone. `seen` holds each row met: false while its chain is followed, so a
// row met again on its own chain reads as having none.
function reachesSlope(op, i, jc, seen) {
    if (seen.has(i)) return seen.get(i);
    seen.set(i, false);
    const chainReaches = () => mathReadIndices(op, jc)
        ?.every(index => reachesSlope(jc.operands[index], index, jc, seen)) ?? false;
    const reaches = isPerSample(op) || (!hasNoSlope(op, jc) && (!isMath(op.type) || chainReaches()));
    seen.set(i, reaches);
    return reaches;
}

// Whether _jacRows declines row i of jc.operands, decided from the rows alone
// without a derivative taken: a kind with no slope, or a math row whose chain
// meets one, a reference to no row, or itself. jc needs only operands and
// outOfReach. A phase or ellipsometric row is also declined where the
// evaluation kept no derivative at its wavelength, which this cannot see.
export function _jacRowsDecline(op, i, jc) {
    return !reachesSlope(op, i, jc, new Map());
}

// The Jacobian rows of one operand, in the order and number of the residual
// rows it contributes (residualRows.js): one per sample for a range target and
// a level-free curve block, one for every other kind. Null when the analytic
// chain rule declines the operand, which puts the whole Jacobian on finite
// differences.
export function _jacRows(op, i, jc) {
    if (isRangeTarget(op.type)) return _jacRowsRangeTarget(op, jc);
    if (hasFreeLevel(op)) return _jacRowsLevelFree(op, jc);
    if (hasNoSlope(op, jc)) return null;
    if (isMath(op.type)) {
        const row = mathRow(op, i, jc, valueSlope);
        return row ? [row] : null;
    }
    const [, slope, factor] = rowKind(op.type);
    const scale = factor(op, jc.comp[i]);
    const row = scale === 0 ? new Array(jc.nFree).fill(0) : slope(op, i, jc, scale);
    return row ? [row] : null;
}
