/**
 * Analytic Jacobian rows for band / pointwise value operands (TGT/RGT/AGT,
 * weighted integrals, band means and single-λ targets).
 *
 * Each builder returns the length-nFree Jacobian row for one operand. `jc`
 * bundles the shared context: { comp, freeIdx, nFree, propDeriv, propVal }.
 */

import { resolveSourceSpec, resolveDetectorSpec } from '../../spectralWeightings.js';
import { polFromType } from '../operandModel.js';
import { charOf, operandSampleLambdas, isRangeAvg } from '../sampling.js';

// Continuous per-λ target (TGT/RGT/AGT): residual = sw·comp, comp = √(mean dev²);
// ∂comp/∂d_k = (1/(comp·n))·Σ dev_s·∂val_s/∂d_k.
export function _jacRowRangeTarget(op, i, jc) {
    const { comp, freeIdx, nFree, propVal, propDeriv } = jc;
    const sw = Math.sqrt(op.weight);
    const row = new Array(nFree).fill(0);
    const cval = comp[i];
    if (cval <= 1e-12) return row;
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n = lams.length;
    const t0 = op.target;
    const t1 = op.targetEnd != null ? op.targetEnd : op.target;
    for (let s = 0; s < n; s++) {
        const ti  = t0 + (t1 - t0) * (s / (n - 1));
        const dev = propVal(lams[s], pol, char, op.aoi) - ti;
        const d   = propDeriv(lams[s], pol, char, op.aoi);
        for (let ci = 0; ci < nFree; ci++) row[ci] += dev * d[freeIdx[ci]];
    }
    const scale = sw / (cval * n);
    for (let ci = 0; ci < nFree; ci++) row[ci] *= scale;
    return row;
}

// Weighted-integral: residual = sw·(C̄_w − target),
//   ∂C̄_w/∂d_j = Σ_i (w_i / Σ w_k) · ∂C_i/∂d_j   (linear, exact).
export function _jacRowIntegral(op, i, jc) {
    const { freeIdx, nFree, propDeriv } = jc;
    const sw = Math.sqrt(op.weight);
    const row = new Array(nFree).fill(0);
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n    = lams.length;
    const S    = resolveSourceSpec(op.source   || { id: 'E' });
    const D    = resolveDetectorSpec(op.detector || { id: 'flat' });
    let den = 0;
    const wts = new Array(n);
    for (let s = 0; s < n; s++) {
        const w = S.sampler(lams[s]) * D.sampler(lams[s]);
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

// Band mean (TAV/RAV/AAV, residual = sw·(mean − target)) or single-λ
// (residual = sw·(val − target)).
export function _jacRowMeanOrSingle(op, jc) {
    const { freeIdx, nFree, propDeriv } = jc;
    const sw = Math.sqrt(op.weight);
    const row = new Array(nFree).fill(0);
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    if (isRangeAvg(op.type)) {
        const lams = operandSampleLambdas(op);
        const n = lams.length;
        for (let s = 0; s < n; s++) {
            const d = propDeriv(lams[s], pol, char, op.aoi);
            for (let ci = 0; ci < nFree; ci++) row[ci] += d[freeIdx[ci]];
        }
        const scale = sw / n;
        for (let ci = 0; ci < nFree; ci++) row[ci] *= scale;
    } else {
        const d = propDeriv(op.lambdaStart, pol, char, op.aoi);
        for (let ci = 0; ci < nFree; ci++) row[ci] = sw * d[freeIdx[ci]];
    }
    return row;
}
