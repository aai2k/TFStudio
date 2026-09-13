/**
 * Per-operand analytic Jacobian-row dispatch.
 *
 * Routes one operand to the row builder for its type: band / pointwise value
 * rows (bandRows.js) or single-extremum rows (extremumRows.js).
 */

import {
    isConstraint,
    isEllipsometry,
    isGroupDelay,
    isIntegral,
    isMinmax,
    isPhaseShift,
    isRangeTarget,
} from '../operandModel.js';
import { _jacRowRangeTarget, _jacRowIntegral, _jacRowMeanOrSingle } from './bandRows.js';
import { _jacRowConstraint, _jacRowMinmax } from './extremumRows.js';
import { _jacRowEllipsometry, _jacRowPhase } from './phaseRows.js';

// Operand kind → row builder, checked top-down; the band-average / single-λ
// builder is the fall-through default.
const ROW_BUILDERS = [
    [isConstraint,    _jacRowConstraint],
    [isRangeTarget,   _jacRowRangeTarget],
    [isIntegral,      _jacRowIntegral],
    [isMinmax,        _jacRowMinmax],
    [isEllipsometry,  (op, i, jc) => _jacRowEllipsometry(op, jc)],
    [type => isPhaseShift(type) || isGroupDelay(type), _jacRowPhase],
];

// Dispatch one operand to its Jacobian-row builder.
export function _jacRow(op, i, jc) {
    const hit = ROW_BUILDERS.find(([test]) => test(op.type));
    return hit ? hit[1](op, i, jc) : _jacRowMeanOrSingle(op, jc);
}
