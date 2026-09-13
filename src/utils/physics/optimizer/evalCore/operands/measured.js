/**
 * Measured-curve operands: the RMS deviation of the design from a stored
 * measurement snapshot, for photometric (T/R/A) and ellipsometric (Ψ, Δ)
 * blocks alike.
 */

import { isEllipsometricMeasuredCurve } from '../../operandModel.js';
import { measuredCurveEngineTargets } from '../../measuredCurveOperand.js';
import { tmmProp } from '../tmmEval.js';
import { _normalizeDegrees } from '../angles.js';
import { OperandEvaluationError, _assertMeasurementSide, _assertFrontEllipsometry } from './errors.js';
import { _gridKey, _ellipsometryBatch } from './ellipsometry.js';

// The wavelengths of a measured block, checked so a broken snapshot is
// reported on its row rather than scored.
function _measuredSnapshotLambdas(op) {
    const lambdas = op.sampleLambdas;
    const targets = op.sampleTargets;
    const paired = Array.isArray(lambdas) && Array.isArray(targets) && lambdas.length === targets.length;
    if (!paired || lambdas.length === 0) {
        throw new OperandEvaluationError('Measured curve snapshot has no valid sample pairs.');
    }
    for (let index = 0; index < lambdas.length; index++) {
        if (!Number.isFinite(lambdas[index]) || lambdas[index] <= 0 || !Number.isFinite(targets[index])) {
            throw new OperandEvaluationError('Measured curve snapshot contains an invalid wavelength or target.');
        }
    }
    return lambdas;
}

// Persisted measured-curve block: its value is already the RMS residual, so
// `_operandResidual` consumes it directly just like a continuous range target.
export function _evalMeasuredCurve(op, ctx) {
    if (isEllipsometricMeasuredCurve(op)) return _evalMeasuredEllipsometry(op, ctx);
    _assertMeasurementSide(op, ctx);
    const lambdas = _measuredSnapshotLambdas(op);
    const targets = op.sampleTargets;
    const char = ['T', 'R', 'A'].includes(op.quantity) ? op.quantity : 'R';
    const pol = op.pol || 'avg';
    let sumSq = 0;
    for (let index = 0; index < lambdas.length; index++) {
        const difference = tmmProp(
            lambdas[index], op.aoi ?? 0, pol, char, ctx, ctx.frontThicks, ctx.frontMats,
        ) - targets[index];
        sumSq += difference * difference;
    }
    return Math.sqrt(sumSq / lambdas.length);
}

// A measured Ψ or Δ block: the RMS deviation of the front stack's Ψ or Δ from
// the snapshot, with the snapshot's Δ moved into the sign the evaluator returns
// and each Δ difference taken the short way round the circle.
function _evalMeasuredEllipsometry(op, ctx) {
    _assertFrontEllipsometry(op, ctx);
    const lambdas = _measuredSnapshotLambdas(op);
    const targets = measuredCurveEngineTargets(op);
    const aoi = op.aoi ?? 0;
    const batch = _ellipsometryBatch(ctx, aoi, lambdas, _gridKey(aoi, lambdas));
    const delta = op.quantity === 'DEL';
    let sumSq = 0;
    for (let index = 0; index < lambdas.length; index++) {
        const point = batch.get(lambdas[index]);
        const difference = delta
            ? _normalizeDegrees(point.delta - targets[index])
            : point.psi - targets[index];
        sumSq += difference * difference;
    }
    return Math.sqrt(sumSq / lambdas.length);
}
