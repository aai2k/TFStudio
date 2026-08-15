/** Analytic DLS rows for phase, GD, GDD, and TOD operands. */

import { isGroupDelayFlat } from '../operandModel.js';
import { operandSampleLambdas } from '../sampling.js';

function emptyRow(nFree) {
    return new Array(nFree).fill(0);
}

function copyFreeDerivatives(derivative, freeIdx, scale) {
    return freeIdx.map(index => scale * derivative[index]);
}

export function _jacRowPhase(op, operandIndex, jc) {
    const {
        comp,
        freeIdx,
        nFree,
        phasePoint,
        residualScale,
    } = jc;
    const scale = Math.sqrt(op.weight) / residualScale(op);
    if (!isGroupDelayFlat(op.type)) {
        const point = phasePoint(op, op.lambdaStart);
        return point ? copyFreeDerivatives(point.derivative, freeIdx, scale) : null;
    }

    const computed = comp[operandIndex];
    if (!(computed > 1e-12)) return emptyRow(nFree);
    const wavelengths = operandSampleLambdas(op);
    const row = emptyRow(nFree);
    for (const wavelength of wavelengths) {
        const point = phasePoint(op, wavelength);
        if (!point) return null;
        const difference = point.value - op.target;
        for (let column = 0; column < nFree; column++) {
            row[column] += difference * point.derivative[freeIdx[column]];
        }
    }
    const rmsScale = scale / (computed * wavelengths.length);
    for (let column = 0; column < nFree; column++) row[column] *= rmsScale;
    return row;
}
