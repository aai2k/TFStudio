/**
 * Analytic Jacobian rows for band / pointwise value operands (TGT/RGT/AGT,
 * weighted integrals, band means and single-λ targets).
 *
 * Each builder returns the length-nFree Jacobian row for one operand; a range
 * target returns one row per sample. `jc` bundles the shared context:
 * { comp, freeIdx, nFree, propDeriv }.
 */

import { resolveSourceSpec, resolveDetectorSpec } from '../../spectralWeightings.js';
import { polFromType } from '../operandModel.js';
import { charOf, operandSampleLambdas, isRangeAvg, bandQuadratureWeights } from '../sampling.js';

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

// Weighted-integral: residual = sw·(C̄_w − target),
//   ∂C̄_w/∂d_j = Σ_i (w_i / Σ w_k) · ∂C_i/∂d_j   (linear, exact),
// with w_i = qᵢ·S(λᵢ)·D(λᵢ) as in the evaluator.
export function _jacRowIntegral(op, i, jc) {
    const { freeIdx, nFree, propDeriv } = jc;
    const sw = Math.sqrt(op.weight);
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
    for (let ci = 0; ci < nFree; ci++) row[ci] *= sw;
    return row;
}

// Band mean (TAV/RAV/AAV, residual = sw·(Σ qₛ valₛ − target), qₛ the band
// grid's trapezoid weights) or single-λ (residual = sw·(val − target)).
export function _jacRowMeanOrSingle(op, jc) {
    const { freeIdx, nFree, propDeriv } = jc;
    const sw = Math.sqrt(op.weight);
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
        for (let ci = 0; ci < nFree; ci++) row[ci] *= sw;
    } else {
        const d = propDeriv(op.lambdaStart, pol, char, op.aoi);
        for (let ci = 0; ci < nFree; ci++) row[ci] = sw * d[freeIdx[ci]];
    }
    return row;
}
