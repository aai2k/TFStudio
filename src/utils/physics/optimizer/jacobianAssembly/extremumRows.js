/**
 * Analytic Jacobian rows for single-extremum operands: thickness constraints
 * (MNT/MXT), worst-case min/max R/T/A, linear or in dB or density, the
 * wavelength of a band's peak or dip (MXW* / MNW*), the two-extremum PPEF row,
 * and the one-wavelength TDB row, which shares the dB slope.
 *
 * Each kind is a slope builder, scale·∂value/∂d ÷ σ over the free variables
 * with σ the row's unit scale, and the factor its own residual row takes it
 * at (jacRows.js). The constraint, worst-case and PPEF rows are active-only
 * subgradients: when the bound is crossed the extremum is attained at one
 * index (layer or wavelength), so the slope is the derivative at that single
 * point, and the factor is the sign of the crossing times √w; otherwise the
 * factor is zero. `jc` bundles the shared context:
 * { comp, freeIdx, nFree, ctx, propDeriv, propValue, residualScale }.
 */

import {
    isLogOperand, isMinType, logSlopeOverSigma, polFromType, rowReadingSlopeOverSigma,
} from '../operandModel.js';
import { charOf } from '../sampling.js';
import { operandExtremumLambdas } from '../evalCore/evalContext.js';
import { contextConstraintIndices } from '../constraintRange.js';
import { extremumSlope } from './extremumSlope.js';

// Index of the min (isMin) or max thickness over the given positions of all;
// a tie goes to the first position.
function _constraintArgExtremum(all, indices, isMin) {
    let argj = indices[0], best = all[argj] || 0;
    for (const jj of indices) {
        const v = all[jj] || 0;
        if (isMin ? v < best : v > best) { best = v; argj = jj; }
    }
    return argj;
}

// √w·∂residual/∂value of a bound, residual max(0, target − value) for one
// held at or above its target and max(0, value − target) otherwise: −√w or
// +√w while it is crossed, 0 while it holds.
function boundFactor(op, value, lower) {
    const crossed = lower ? op.target - value > 0 : value - op.target > 0;
    return crossed ? (lower ? -1 : 1) * Math.sqrt(op.weight) : 0;
}

export const constraintFactor = (op, value) => boundFactor(op, value, op.type === 'MNT');
export const minmaxFactor = (op, value) => boundFactor(op, value, isMinType(op.type));
// A peak-to-peak error is a ceiling.
export const ppefFactor = (op, value) => boundFactor(op, value, false);

// Constraint (MNT/MXT): value = min (MNT) or max (MXT) thickness over the
// 1-based layer range (constraintRange.js), so ∂value/∂d is 1 at the layer
// holding it and 0 elsewhere; σ = 1.
export function constraintSlope(op, i, jc, scale) {
    const { freeIdx, nFree, ctx } = jc;
    const row = new Array(nFree).fill(0);
    const all = ctx.fullThicks || ctx.frontThicks || [];
    const indices = contextConstraintIndices(op, ctx);
    if (!indices.length) return row;
    const ci = freeIdx.indexOf(_constraintArgExtremum(all, indices, op.type === 'MNT'));
    if (ci >= 0) row[ci] = scale;
    return row;
}

// Worst-case min/max: the extremum is attained at one wavelength λ*, the one
// the evaluation found (operandExtremumLambdas), so ∂value/∂d ÷ σ is
// (∂value/∂C ÷ σ)·dC*/∂d_j with dC*/dd the derivative of the extremum value
// (extremumSlope.js). ∂value/∂C ÷ σ is 1 for a linear row and ±1/C(λ*) for a
// dB or density row (logReadings.js).
export function minmaxSlope(op, i, jc, scale) {
    const { comp, freeIdx, nFree } = jc;
    const row = new Array(nFree).fill(0);
    const { C, dC } = extremumSlope(op, operandExtremumLambdas(comp)[i], jc);
    const slope = isLogOperand(op.type) ? rowReadingSlopeOverSigma(op.type, C) : 1;
    const k = scale * slope;
    for (let ci = 0; ci < nFree; ci++) row[ci] = k * dC[freeIdx[ci]];
    return row;
}

// MXW* / MNW*: value λ*, so ∂value/∂d_j ÷ σ is dλ*/dd_j ÷ σ, zero where λ*
// sits on a band end or the peak is flat to rounding there (extremumSlope.js).
export function argwaveSlope(op, i, jc, scale) {
    const { comp, freeIdx, nFree, residualScale } = jc;
    const row = new Array(nFree).fill(0);
    const { dLambda } = extremumSlope(op, comp[i], jc);
    if (!dLambda) return row;
    const k = scale / residualScale(op);
    for (let ci = 0; ci < nFree; ci++) row[ci] = k * dLambda[freeIdx[ci]];
    return row;
}

// PPEF: value = EF(λ_high) − EF(λ_low) with EF = target dB − design dB. Only
// the two extreme points move it: ∂value/∂d ÷ σ = ∂C(λ_low)/∂d / C(λ_low) −
// ∂C(λ_high)/∂d / C(λ_high), with the wavelengths the evaluation found
// (evalCore/operands/ppef.js).
export function ppefSlope(op, i, jc, scale) {
    const { comp, freeIdx, nFree, propDeriv, propValue } = jc;
    const row = new Array(nFree).fill(0);
    const extremes = operandExtremumLambdas(comp)[i];
    if (!extremes) return row;
    const { char, aoi, pol } = extremes;
    const relative = lambda => {
        const d = propDeriv(lambda, pol, char, aoi);
        const slope = logSlopeOverSigma('dB', propValue(lambda, pol, char, aoi));
        return freeIdx.map(index => slope * d[index]);
    };
    const low = relative(extremes.low);
    const high = relative(extremes.high);
    for (let ci = 0; ci < nFree; ci++) row[ci] = scale * (low[ci] - high[ci]);
    return row;
}

// TDB at one wavelength: ∂value/∂d_j ÷ σ = (∂value/∂C ÷ σ)·∂C/∂d_j = ∂C/∂d_j / C.
export function logPointSlope(op, i, jc, scale) {
    const { freeIdx, nFree, propDeriv, propValue } = jc;
    const pol = polFromType(op.type) ?? op.pol;
    const char = charOf(op.type);
    const d = propDeriv(op.lambdaStart, pol, char, op.aoi);
    const k = scale * rowReadingSlopeOverSigma(op.type, propValue(op.lambdaStart, pol, char, op.aoi));
    const row = new Array(nFree);
    for (let ci = 0; ci < nFree; ci++) row[ci] = k * d[freeIdx[ci]];
    return row;
}
