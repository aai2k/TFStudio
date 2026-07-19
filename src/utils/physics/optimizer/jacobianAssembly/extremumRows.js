/**
 * Analytic Jacobian rows for single-extremum operands: thickness constraints
 * (MNT/MXT) and worst-case min/max R/T/A.
 *
 * These are active-only subgradients: when the constraint/target is violated the
 * extremum is attained at one index (layer or wavelength), so the row is the
 * signed derivative at that single point; otherwise the row is zero. `jc` bundles
 * the shared context: { comp, freeIdx, nFree, ctx, propVal, propDeriv }.
 */

import { isMinType, polFromType } from '../operandModel.js';
import { charOf, operandSampleLambdas } from '../sampling.js';

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
// extremum is attained at one wavelength λ* (the argmin/argmax on the SAME grid
// evalOperand used), so the subgradient is sw·(±1)·∂C(λ*)/∂d_j.
export function _jacRowMinmax(op, i, jc) {
    const { comp, freeIdx, nFree, propVal, propDeriv } = jc;
    const sw = Math.sqrt(op.weight);
    const row = new Array(nFree).fill(0);
    const isMin = isMinType(op.type);
    const violated = isMin ? (op.target - comp[i] > 0) : (comp[i] - op.target > 0);
    if (!violated) return row;
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n    = lams.length;
    let argS = 0, bestV = isMin ? Infinity : -Infinity;
    for (let s = 0; s < n; s++) {
        const v = propVal(lams[s], pol, char, op.aoi);
        if (isMin ? v < bestV : v > bestV) { bestV = v; argS = s; }
    }
    // ∂residual/∂comp under the violated branch: +1 for max, −1 for min.
    const dResSign = isMin ? -1 : +1;
    const d = propDeriv(lams[argS], pol, char, op.aoi);
    for (let ci = 0; ci < nFree; ci++) row[ci] = sw * dResSign * d[freeIdx[ci]];
    return row;
}
