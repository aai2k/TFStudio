/**
 * The least-squares residual rows one merit-function row contributes.
 *
 * Most rows give one residual, √w·r/σ, with r the row's miss against its target
 * and σ its unit scale (evalCore/residualScale.js). A range target (TGT/RGT/AGT)
 * gives one residual per sample, √(w·qₛ)·devₛ with qₛ the trapezoid weights of
 * the band grid (sampling.js bandQuadratureWeights): their squares sum to
 * w·Σ qₛ devₛ², exactly the row's contribution to the merit, but each sample
 * keeps its own Jacobian row. As a single RMS residual the operand would add a rank-one
 * block to JᵀJ and Levenberg-Marquardt would see only its gradient direction. A
 * measured curve is expanded the same way (measuredCurveOperand.js). The analytic
 * Jacobian builders emit rows in the same order and number
 * (jacobianAssembly/jacRows.js).
 */

import { isRangeTarget } from './operandModel.js';
import { bandQuadratureWeights } from './sampling.js';
import { operandResidualScale, _operandResidual } from './evalCore.js';

// A NaN or Inf residual would poison the QR/LM solve. The residual vector must
// keep a fixed length aligned row for row with the analytic Jacobian and with
// the perturbed vectors the finite-difference Jacobian differences, so a finite
// 0 stands in. A degenerate design is still rejected by the accept test, since
// calcMF returns Infinity for it.
const finiteOrZero = value => (Number.isFinite(value) ? value : 0);

/**
 * Residual rows of one enabled, evaluated operand. `value` is its evaluated
 * merit value; `deviations` are its per-sample deviations from the target line
 * (evalCore operandSampleDeviations), read only for a range target.
 */
export function operandResidualRows(op, value, deviations) {
    if (isRangeTarget(op.type)) {
        const q = bandQuadratureWeights(deviations.length);
        return deviations.map((dev, s) => finiteOrZero(Math.sqrt(op.weight * q[s]) * dev));
    }
    return [finiteOrZero(Math.sqrt(op.weight) * _operandResidual(op, value) / operandResidualScale(op))];
}
