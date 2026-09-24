/**
 * Per-operand contributions to the second-order curvature term S.
 *
 * `_curvOperand` adds one operand's share to the upper triangle of H through
 * `hc = { r0, nFree, sample, addS }`; `rp` is the operand's first residual-row
 * index (aligned with r0/J), and the return value is the number of residual
 * rows the operand occupies.
 * `_operandSupportsFullNewton` reports whether an operand is eligible for the
 * full analytic Newton Hessian at all.
 */

import { operandResidualScale } from '../evalCore.js';
import { resolveSourceSpec, resolveDetectorSpec } from '../../spectralWeightings.js';
import {
    isMath, isArgwave, isEField, isEllipsometry, polFromType,
    isManufacturability, isMinmax, isRangeTarget, isIntegral,
} from '../operandModel.js';
import { charOf, operandSampleLambdas, isRangeAvg, bandQuadratureWeights } from '../sampling.js';

// One enabled, evaluated operand's curvature. The manufacturability rows
// contribute zero curvature: the layer bounds are piecewise linear in the
// thicknesses, and the total thickness and the film force are linear outright.
//
// A worst-case min/max row (TMN..AMX) is given zero curvature as well, which
// leaves it the Gauss-Newton term JᵀJ. It is not piecewise linear: while the
// extremum stays on one grid sample λ* its residual is ±√w·(C(λ*) − target),
// and ∂²C(λ*) is exact there. But λ* moves with the thicknesses, so the band
// extremum is the upper (or lower) envelope of the samples, whose curvature
// the fixed-λ* term understates, and it has a kink wherever two peaks tie.
// Measured on five min/max merit functions, adding ±√w·r·∂²C(λ*) to S left
// Newton and SQP at a worse merit in three and a better one in two; the
// envelope correction −C_dλ·C_λd/C_λλ did no better.
export function _curvOperand(op, rp, hc) {
    if (isManufacturability(op.type) || isMinmax(op.type)) return 1;
    if (isRangeTarget(op.type)) return _curvRangeTarget(op, rp, hc);
    if (isIntegral(op.type)) _curvIntegral(op, rp, hc);
    else if (isRangeAvg(op.type)) _curvRangeAvg(op, rp, hc);
    else _curvSingle(op, rp, hc);
    return 1;
}

// Single-λ optical: residual = sw·(val − target), ∂²r = sw·∂²comp.
function _curvSingle(op, rp, hc) {
    const { r0, sample, addS } = hc;
    const pol = polFromType(op.type) ?? op.pol;
    addS(r0[rp] * Math.sqrt(op.weight), sample(op.lambdaStart, pol, charOf(op.type), op.aoi).d2);
}

// Range-target (TGT/RGT/AGT), one residual per sample rₛ = √(w·qₛ)·devₛ at rows
// rp … rp+n−1 (qₛ the band grid's trapezoid weights): ∂²rₛ = √(w·qₛ)·∂²valₛ, so
// S gains rₛ·√(w·qₛ)·∂²valₛ per sample. Returns n, the number of residual rows
// the operand occupies.
function _curvRangeTarget(op, rp, hc) {
    const { r0, sample, addS } = hc;
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const q = bandQuadratureWeights(lams.length);
    for (let s = 0; s < lams.length; s++) {
        addS(r0[rp + s] * Math.sqrt(op.weight * q[s]), sample(lams[s], pol, char, op.aoi).d2);
    }
    return lams.length;
}

// Weighted-integral: ∂²r = sw·Σ wᵢ·∂²comp ; S = r·∂²r, with wᵢ = qᵢ·S(λᵢ)·D(λᵢ)
// normalized as in the evaluator.
function _curvIntegral(op, rp, hc) {
    const { r0, nFree, sample, addS } = hc;
    const sw = Math.sqrt(op.weight);
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n = lams.length;
    const q = bandQuadratureWeights(n);
    const S = resolveSourceSpec(op.source || { id: 'E' });
    const D = resolveDetectorSpec(op.detector || { id: 'flat' });
    let den = 0; const wts = new Array(n);
    for (let s = 0; s < n; s++) { const w = q[s] * S.sampler(lams[s]) * D.sampler(lams[s]); wts[s] = w; den += w; }
    if (den <= 1e-30) return;
    const invDen = 1 / den;
    const d2acc = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
    for (let s = 0; s < n; s++) {
        const wi = wts[s] * invDen;
        if (!(wi > 0)) continue;
        const smp = sample(lams[s], pol, char, op.aoi);
        for (let a = 0; a < nFree; a++) for (let b = a; b < nFree; b++) d2acc[a][b] += wi * smp.d2[a][b];
    }
    addS(r0[rp] * sw, d2acc);
}

// Band mean (TAV/RAV/AAV): ∂²r = sw·Σ qₛ·∂²comp, qₛ the band grid's trapezoid weights.
function _curvRangeAvg(op, rp, hc) {
    const { r0, nFree, sample, addS } = hc;
    const sw = Math.sqrt(op.weight);
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const q = bandQuadratureWeights(lams.length);
    const d2acc = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
    for (let s = 0; s < lams.length; s++) {
        const smp = sample(lams[s], pol, char, op.aoi);
        for (let a = 0; a < nFree; a++) for (let b = a; b < nFree; b++) d2acc[a][b] += q[s] * smp.d2[a][b];
    }
    addS(r0[rp] * sw, d2acc);
}

// Whether one operand is compatible with the FULL analytic Newton Hessian.
// Math/argwave curvature isn't worked out, and σ-normalization ≠ 1 means the
// Jacobian is FD (so the analytic curvature would not match). Ellipsometry and
// field operands have no second derivative worked out either, and tan Ψ, cos Δ
// and the field peak sit at σ = 1, so they are named here. TT and STR are not:
// both are linear in the thicknesses, so their curvature is exactly zero and
// the Newton system simply skips them.
export function _operandSupportsFullNewton(op) {
    if (!op.enabled) return true;
    if (isMath(op.type) || isArgwave(op.type)) return false;
    if (isEllipsometry(op.type) || isEField(op.type)) return false;
    return operandResidualScale(op) === 1;
}
