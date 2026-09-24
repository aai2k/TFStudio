/**
 * Per-operand analytic Jacobian-row dispatch.
 *
 * Routes one operand to the row builder for its type: band / pointwise value
 * rows (bandRows.js), single-extremum rows (extremumRows.js), or the rows that
 * read the thickness vector directly (linearRows.js).
 */

import {
    isConstraint,
    isEllipsometry,
    isGroupDelay,
    isIntegral,
    isLinearThickness,
    isMinmax,
    isPhaseShift,
    isRangeTarget,
} from '../operandModel.js';
import { _jacRowsRangeTarget, _jacRowIntegral, _jacRowMeanOrSingle } from './bandRows.js';
import { _jacRowConstraint, _jacRowMinmax } from './extremumRows.js';
import { _jacRowLinearThickness } from './linearRows.js';
import { _jacRowEllipsometry, _jacRowPhase } from './phaseRows.js';

// Operand kind → single-row builder, checked top-down; the band-average /
// single-λ builder is the fall-through default.
const ROW_BUILDERS = [
    [isConstraint,    _jacRowConstraint],
    [isLinearThickness, _jacRowLinearThickness],
    [isIntegral,      _jacRowIntegral],
    [isMinmax,        _jacRowMinmax],
    [isEllipsometry,  (op, i, jc) => _jacRowEllipsometry(op, jc)],
    [type => isPhaseShift(type) || isGroupDelay(type), _jacRowPhase],
];

// The Jacobian rows of one operand, in the order and number of the residual
// rows it contributes (residualRows.js): one per sample for a range target, one
// for every other kind. Null when the analytic chain rule declines the operand.
export function _jacRows(op, i, jc) {
    if (isRangeTarget(op.type)) return _jacRowsRangeTarget(op, jc);
    const hit = ROW_BUILDERS.find(([test]) => test(op.type));
    const row = hit ? hit[1](op, i, jc) : _jacRowMeanOrSingle(op, jc);
    return row ? [row] : null;
}
