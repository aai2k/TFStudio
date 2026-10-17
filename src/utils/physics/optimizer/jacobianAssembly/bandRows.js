/**
 * Analytic Jacobian rows for band / pointwise value operands (TGT/RGT/AGT,
 * curve blocks with their level free, weighted integrals, band means and
 * single-λ targets).
 *
 * A range target and a level-free block return one row per sample. The
 * single-row kinds are slope builders, scale·∂value/∂d over the free
 * variables (σ = 1 for all of them), called with the row's own √w for its
 * Jacobian row and with 1 for the slope of its value (jacRows.js). `jc`
 * bundles the shared context: { comp, freeIdx, nFree, propDeriv }.
 */

import { resolveSourceSpec, resolveDetectorSpec } from '../../spectralWeightings.js';
import { isRangeTarget, measuredCurveChannel, polFromType, rowReadingSlopeOverSigma } from '../operandModel.js';
import { charOf, operandSampleLambdas, isRangeAvg, bandQuadratureWeights } from '../sampling.js';
import { operandSampleDeviations } from '../evalCore/evalContext.js';
import { operandResidualRows } from '../residualRows.js';

// Continuous per-λ target (TGT/RGT/AGT), one residual per sample:
// rₛ = √(w·qₛ)·(valₛ − tₛ), qₛ the band grid's trapezoid weights, so
// ∂rₛ/∂d_k = √(w·qₛ)·∂valₛ/∂d_k. The target line tₛ does not depend on the
// thicknesses.
export function _jacRowsRangeTarget(op, jc) {
    const { freeIdx, nFree, propDeriv } = jc;
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const q = bandQuadratureWeights(lams.length);
    return lams.map((lambda, s) => {
        const sw = Math.sqrt(op.weight * q[s]);
        const d = propDeriv(lambda, pol, char, op.aoi);
        const row = new Array(nFree);
        for (let ci = 0; ci < nFree; ci++) row[ci] = sw * d[freeIdx[ci]];
        return row;
    });
}

// Curve block with its level free, one residual per point:
// rₛ = √(w/n)·(gₛ − ḡ)/σ with gₛ the block's reading of the channel at λₛ less
// its point, and ḡ their mean. The level ḡ moves with the thicknesses, so
// ∂rₛ/∂d_k = √(w/n)·(uₛ − ū) with uₛ = (∂gₛ/∂C ÷ σ)·∂Cₛ/∂d_k and ū their mean:
// every row has the block's mean derivative taken out.
export function _jacRowsLevelFree(op, jc) {
    const { freeIdx, nFree, propDeriv, propValue } = jc;
    const channel = measuredCurveChannel(op);
    const char = charOf(channel);
    const pol = op.pol || 'avg';
    const aoi = op.aoi ?? 0;
    const lambdas = op.sampleLambdas;
    const n = lambdas.length;
    const u = lambdas.map((lambda) => {
        const d = propDeriv(lambda, pol, char, aoi);
        const slope = rowReadingSlopeOverSigma(channel, propValue(lambda, pol, char, aoi));
        return freeIdx.map(index => slope * d[index]);
    });
    const mean = new Array(nFree).fill(0);
    for (const row of u) for (let ci = 0; ci < nFree; ci++) mean[ci] += row[ci] / n;
    const scale = Math.sqrt(op.weight / n);
    return u.map(row => row.map((value, ci) => scale * (value - mean[ci])));
}

// The value of a range target or of a level-free curve block, row i, is the
// RMS V of its per-sample deviations. At weight 1 its residual rows rₛ have
// Σ rₛ² = (V/σ)², so ∂V/∂d = σ²·Σₛ rₛ·∂rₛ/∂d / V, from the row's own residual
// and Jacobian rows. At V = 0 the RMS has a corner, and its smallest
// subgradient there is 0.
export function rmsValueSlope(op, i, jc) {
    const { comp, nFree, residualScale } = jc;
    const row = new Array(nFree).fill(0);
    const value = comp[i];
    if (!(value > 0)) return row;
    const unit = { ...op, weight: 1 };
    const sigma = residualScale(op);
    const residuals = operandResidualRows(unit, value, operandSampleDeviations(comp)[i], sigma);
    const slopes = isRangeTarget(op.type) ? _jacRowsRangeTarget(unit, jc) : _jacRowsLevelFree(unit, jc);
    const k = sigma * sigma / value;
    for (let s = 0; s < slopes.length; s++) {
        const weighted = k * residuals[s];
        for (let ci = 0; ci < nFree; ci++) row[ci] += weighted * slopes[s][ci];
    }
    return row;
}

// Weighted-integral: residual = sw·(C̄_w − target),
//   ∂C̄_w/∂d_j = Σ_i (w_i / Σ w_k) · ∂C_i/∂d_j   (linear, exact),
// with w_i = qᵢ·S(λᵢ)·D(λᵢ) as in the evaluator.
export function integralSlope(op, i, jc, scale) {
    const { freeIdx, nFree, propDeriv } = jc;
    const row = new Array(nFree).fill(0);
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n    = lams.length;
    const q    = bandQuadratureWeights(n);
    const S    = resolveSourceSpec(op.source   || { id: 'E' });
    const D    = resolveDetectorSpec(op.detector || { id: 'flat' });
    let den = 0;
    const wts = new Array(n);
    for (let s = 0; s < n; s++) {
        const w = q[s] * S.sampler(lams[s]) * D.sampler(lams[s]);
        wts[s] = w; den += w;
    }
    if (den <= 1e-30) return row;
    const invDen = 1 / den;
    for (let s = 0; s < n; s++) {
        const wi = wts[s] * invDen;
        if (!(wi > 0)) continue;
        const d = propDeriv(lams[s], pol, char, op.aoi);
        for (let ci = 0; ci < nFree; ci++) row[ci] += wi * d[freeIdx[ci]];
    }
    for (let ci = 0; ci < nFree; ci++) row[ci] *= scale;
    return row;
}

// Band mean (TAV/RAV/AAV, residual = sw·(Σ qₛ valₛ − target), qₛ the band
// grid's trapezoid weights) or single-λ (residual = sw·(val − target)).
export function meanOrSingleSlope(op, i, jc, scale) {
    const { freeIdx, nFree, propDeriv } = jc;
    const row = new Array(nFree).fill(0);
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    if (isRangeAvg(op.type)) {
        const lams = operandSampleLambdas(op);
        const q = bandQuadratureWeights(lams.length);
        for (let s = 0; s < lams.length; s++) {
            const d = propDeriv(lams[s], pol, char, op.aoi);
            for (let ci = 0; ci < nFree; ci++) row[ci] += q[s] * d[freeIdx[ci]];
        }
        for (let ci = 0; ci < nFree; ci++) row[ci] *= scale;
    } else {
        const d = propDeriv(op.lambdaStart, pol, char, op.aoi);
        for (let ci = 0; ci < nFree; ci++) row[ci] = scale * d[freeIdx[ci]];
    }
    return row;
}
