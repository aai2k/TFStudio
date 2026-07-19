/**
 * Per-operand analytic Jacobian-row dispatch.
 *
 * Routes one operand to the row builder for its type: band / pointwise value
 * rows (bandRows.js) or single-extremum rows (extremumRows.js).
 */

import { isConstraint, isRangeTarget, isIntegral, isMinmax } from '../operandModel.js';
import { _jacRowRangeTarget, _jacRowIntegral, _jacRowMeanOrSingle } from './bandRows.js';
import { _jacRowConstraint, _jacRowMinmax } from './extremumRows.js';

// Dispatch one operand to its Jacobian-row builder.
export function _jacRow(op, i, jc) {
    if (isConstraint(op.type))  return _jacRowConstraint(op, i, jc);
    if (isRangeTarget(op.type)) return _jacRowRangeTarget(op, i, jc);
    if (isIntegral(op.type))    return _jacRowIntegral(op, i, jc);
    if (isMinmax(op.type))      return _jacRowMinmax(op, i, jc);
    return _jacRowMeanOrSingle(op, jc);
}
