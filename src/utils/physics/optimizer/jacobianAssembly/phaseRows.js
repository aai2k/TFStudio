/**
 * Analytic DLS rows for phase, GD, GDD, and TOD operands. Each is a slope
 * builder, scale·∂value/∂d ÷ σ over the free variables, taken at √w for the
 * row's own Jacobian row (jacRows.js).
 */

import { isGroupDelayFlat } from '../operandModel.js';
import { operandSampleLambdas, bandQuadratureWeights } from '../sampling.js';

function emptyRow(nFree) {
    return new Array(nFree).fill(0);
}

function copyFreeDerivatives(derivative, freeIdx, scale) {
    return freeIdx.map(index => scale * derivative[index]);
}

/** Ψ, Δ, tan Ψ or cos Δ at one wavelength: the operand's own derivative. */
export function ellipsometrySlope(op, i, jc, scale) {
    const point = jc.ellipsometryPoint(op);
    if (!point) return null;
    return copyFreeDerivatives(point.derivative, jc.freeIdx, scale / jc.residualScale(op));
}

export function phaseSlope(op, operandIndex, jc, scale) {
    const {
        comp,
        freeIdx,
        nFree,
        phasePoint,
        residualScale,
    } = jc;
    const k = scale / residualScale(op);
    if (!isGroupDelayFlat(op.type)) {
        const point = phasePoint(op, op.lambdaStart);
        return point ? copyFreeDerivatives(point.derivative, freeIdx, k) : null;
    }

    // RMS = √(Σ qₛ devₛ²) over the band grid's trapezoid weights qₛ, so
    // ∂RMS/∂d = Σ qₛ devₛ ∂devₛ/∂d / RMS.
    const computed = comp[operandIndex];
    if (!(computed > 1e-12)) return emptyRow(nFree);
    const wavelengths = operandSampleLambdas(op);
    const q = bandQuadratureWeights(wavelengths.length);
    const row = emptyRow(nFree);
    for (let s = 0; s < wavelengths.length; s++) {
        const point = phasePoint(op, wavelengths[s]);
        if (!point) return null;
        const weighted = q[s] * (point.value - op.target);
        for (let column = 0; column < nFree; column++) {
            row[column] += weighted * point.derivative[freeIdx[column]];
        }
    }
    const rmsScale = k / computed;
    for (let column = 0; column < nFree; column++) row[column] *= rmsScale;
    return row;
}
