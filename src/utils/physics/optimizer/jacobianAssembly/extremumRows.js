/**
 * Analytic Jacobian rows for single-extremum operands: thickness constraints
 * (MNT/MXT) and worst-case min/max R/T/A.
 *
 * These are active-only subgradients: when the constraint/target is violated the
 * extremum is attained at one index (layer or wavelength), so the row is the
 * signed derivative at that single point; otherwise the row is zero. `jc` bundles
 * the shared context: { comp, freeIdx, nFree, ctx, propDeriv }.
 */

import { isMinType, polFromType } from '../operandModel.js';
import { charOf } from '../sampling.js';
import { operandExtremumLambdas } from '../evalCore/evalContext.js';

// Index of the min (isMin) or max thickness over all[lo..hi].
function _constraintArgExtremum(all, lo, hi, isMin) {
    let argj = lo, best = all[lo] || 0;
    for (let jj = lo; jj <= hi; jj++) {
        const v = all[jj] || 0;
        if (isMin ? v < best : v > best) { best = v; argj = jj; }
    }
    return argj;
}

// Constraint (MNT/MXT): subgradient of sw·max(0, ±(target−comp)); comp = min
// (MNT) or max (MXT) over the 1-based layer-index range.
export function _jacRowConstraint(op, i, jc) {
    const { comp, freeIdx, nFree, ctx } = jc;
    const row = new Array(nFree).fill(0);
    const all = ctx.fullThicks || ctx.frontThicks || [];
    const lo = Math.max(0, Math.round(op.lambdaStart) - 1);
    const hi = Math.min(all.length - 1, Math.round(op.lambdaEnd) - 1);
    if (lo > hi) return row;
    const isMin = op.type === 'MNT';
    const violated = isMin ? (op.target - comp[i] > 0) : (comp[i] - op.target > 0);
    if (!violated) return row;
    const ci = freeIdx.indexOf(_constraintArgExtremum(all, lo, hi, isMin));
    if (ci >= 0) row[ci] = Math.sqrt(op.weight) * (isMin ? -1 : 1);
    return row;
}

// Worst-case min/max: residual = sw·max(0, ±(target−comp)); when active the
// extremum is attained at one wavelength λ*, the grid sample the evaluation
// picked (operandExtremumLambdas), so the subgradient is sw·(±1)·∂C(λ*)/∂d_j
// and the derivative kernel runs at λ* alone.
export function _jacRowMinmax(op, i, jc) {
    const { comp, freeIdx, nFree, propDeriv } = jc;
    const row = new Array(nFree).fill(0);
    const isMin = isMinType(op.type);
    const violated = isMin ? (op.target - comp[i] > 0) : (comp[i] - op.target > 0);
    if (!violated) return row;
    const pol = polFromType(op.type) ?? op.pol;
    const d = propDeriv(operandExtremumLambdas(comp)[i], pol, charOf(op.type), op.aoi);
    // ∂residual/∂C under the violated branch: +1 for max, −1 for min.
    const scale = (isMin ? -1 : 1) * Math.sqrt(op.weight);
    for (let ci = 0; ci < nFree; ci++) row[ci] = scale * d[freeIdx[ci]];
    return row;
}
