/**
 * Analytic Jacobian rows for the operands whose value is a plain linear
 * function of the layer thicknesses: the total-thickness budget (TT) and the
 * film-stress force (STR).
 *
 * Both read the thickness vector directly rather than a spectrum, so their
 * derivative is a constant coefficient per layer and needs no TMM at all. TT's
 * coefficients are all 1, one nanometre of any layer adding one nanometre to
 * the total; STR's are the per-layer stresses, signed by which face the layer
 * sits on. Those signs change only where a bare face's first layer grows past
 * 0 nm (`forceSigns`), so STR is linear on either side of that point.
 *
 * The comparison makes the row one-sided: an `=` row is always active, a `≤` or
 * `≥` row only on the side it is violated, exactly as the MNT/MXT rows work.
 */

import { isStress } from '../operandModel.js';
import { stressCoefficientsNm } from '../../stress/stackForce.js';

// ∂residual/∂value under the comparison: 0 where a one-sided row is satisfied,
// so the row drops out of the step until the bound is crossed.
function activeSign(op, value) {
    if (op.cmp === 'le') return value - op.target > 0 ? 1 : 0;
    if (op.cmp === 'ge') return op.target - value > 0 ? -1 : 0;
    return 1;
}

// ∂value/∂d over the full thickness vector. One entry per optimization
// variable, in the order the vector holds them.
function coefficients(op, ctx) {
    if (isStress(op.type)) return stressCoefficientsNm(ctx);
    return new Array((ctx.fullThicks || ctx.frontThicks || []).length).fill(1);
}

/** √w · ∂residual/∂value of a linear-thickness operand at its value. */
export function linearThicknessFactor(op, value) {
    return Math.sqrt(op.weight) * activeSign(op, value);
}

/**
 * scale · (∂value/∂d_j) / σ for one linear-thickness operand, over the free
 * variables. At linearThicknessFactor it is the operand's Jacobian row.
 */
export function linearThicknessSlope(op, i, jc, scale) {
    const { freeIdx, nFree, ctx, residualScale } = jc;
    const row = new Array(nFree).fill(0);
    const k = scale / residualScale(op);
    const coefficient = coefficients(op, ctx);
    for (let ci = 0; ci < nFree; ci++) row[ci] = k * (coefficient[freeIdx[ci]] || 0);
    return row;
}
