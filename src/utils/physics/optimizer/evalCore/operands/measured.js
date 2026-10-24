/**
 * Measured-curve operands: the RMS deviation of the design from a stored
 * measurement snapshot, for photometric (T/R/A) and ellipsometric (Ψ, Δ)
 * blocks alike.
 */

import { hasFreeLevel, isEllipsometricMeasuredCurve, measuredCurveChannel, rowReading } from '../../operandModel.js';
import { charOf } from '../../sampling.js';
import { measuredCurveEngineTargets } from '../../measuredCurveOperand.js';
import { tmmProp } from '../tmmEval.js';
import { _normalizeDegrees } from '../angles.js';
import { CALCULATED_DELTA_CONVENTION, convertDeltaConvention } from '../../../thinFilmMath.js';
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

/**
 * What the design reads at each point of a T, R or A measured block, and how
 * far that is from the block's snapshot: `design` in the block's unit (dB on
 * the T-in-dB channel, TDB, a fraction otherwise), `deviations` the design
 * less the snapshot at each point, and `level` null. With the block's level
 * free, `level` is the mean of those differences, the constant that fits them
 * best, and `deviations` are the differences less it. The block's row scores
 * the RMS of `deviations`, and the API's measuredDifference reports them.
 */
export function measuredCurveDeviations(op, ctx) {
    const channel = measuredCurveChannel(op);
    const lambdas = _measuredSnapshotLambdas(op);
    const targets = op.sampleTargets;
    const pol = op.pol || 'avg';
    const char = charOf(channel);
    const design = lambdas.map(lambda => rowReading(
        channel, tmmProp(lambda, op.aoi ?? 0, pol, char, ctx, ctx.frontThicks, ctx.frontMats),
    ));
    const deviations = design.map((value, index) => value - targets[index]);
    let level = null;
    if (hasFreeLevel(op)) {
        level = deviations.reduce((sum, value) => sum + value, 0) / deviations.length;
        for (let index = 0; index < deviations.length; index++) deviations[index] -= level;
    }
    return { design, deviations, level };
}

// Persisted measured-curve block: its value is already the RMS residual, so
// `_operandResidual` consumes it directly just like a continuous range target.
// A block on the T-in-dB channel (TDB) holds its points in dB and is scored in
// dB, as the TDB points it expands into are. A block with its level free keeps
// its deviations on the context: such a block is not expanded for a run, and
// the least-squares engine takes one residual per point from them, as it does
// for a range target.
export function _evalMeasuredCurve(op, ctx) {
    const channel = measuredCurveChannel(op);
    if (!channel) {
        throw new OperandEvaluationError(
            `A measured curve on channel ${op.quantity} is of a kind this version of TFStudio does not know, so it cannot be evaluated.`,
        );
    }
    if (isEllipsometricMeasuredCurve(op)) return _evalMeasuredEllipsometry(op, ctx);
    _assertMeasurementSide(op, ctx);
    const { deviations } = measuredCurveDeviations(op, ctx);
    if (hasFreeLevel(op)) ctx._sampleDeviations?.set(op, deviations);
    const sumSq = deviations.reduce((sum, value) => sum + value * value, 0);
    return Math.sqrt(sumSq / deviations.length);
}

/**
 * What the front stack reads at each point of a Ψ or Δ measured block, and
 * how far that is from the block's snapshot: `design` in degrees, Δ in the
 * sign the block records, `deviations` the design less the snapshot at each
 * point, each Δ difference taken the short way round the circle, and `level`
 * null. The block's row scores the RMS of `deviations`, and the API's
 * measuredDifference reports them.
 */
export function measuredEllipsometryDeviations(op, ctx) {
    _assertFrontEllipsometry(op, ctx);
    const lambdas = _measuredSnapshotLambdas(op);
    const targets = measuredCurveEngineTargets(op);
    const aoi = op.aoi ?? 0;
    const batch = _ellipsometryBatch(ctx, aoi, lambdas, _gridKey(aoi, lambdas));
    const delta = op.quantity === 'DEL';
    const read = lambdas.map(lambda => (delta ? batch.get(lambda).delta : batch.get(lambda).psi));
    const deviations = read.map((value, index) => (delta
        ? _normalizeDegrees(value - targets[index])
        : value - targets[index]));
    const design = delta
        ? convertDeltaConvention(read, CALCULATED_DELTA_CONVENTION, op.deltaConvention || 'azzam')
        : read;
    // Moving Δ into the block's sign mirrors each difference as well.
    const sign = delta && (op.deltaConvention || 'azzam') !== CALCULATED_DELTA_CONVENTION ? -1 : 1;
    return { design, deviations: deviations.map(value => sign * value), level: null };
}

// A measured Ψ or Δ block: the RMS deviation of the front stack's Ψ or Δ from
// the snapshot, with the snapshot's Δ moved into the sign the evaluator returns
// and each Δ difference taken the short way round the circle.
function _evalMeasuredEllipsometry(op, ctx) {
    const { deviations } = measuredEllipsometryDeviations(op, ctx);
    const sumSq = deviations.reduce((sum, value) => sum + value * value, 0);
    return Math.sqrt(sumSq / deviations.length);
}
