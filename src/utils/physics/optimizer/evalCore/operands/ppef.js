/**
 * Peak-to-peak error function (PPEF) against a measured-curve block.
 *
 * At each of the block's points EF(λ) = T_target(λ)[dB] − T_design(λ)[dB], and
 * the row's value is the spread max EF − min EF. A design that differs from
 * the target by the same number of dB everywhere scores zero: that constant is
 * insertion loss, which a gain-flattening filter's datasheet states on its own
 * line, and only the shape error is this one. The sign of EF follows the
 * gain-flattening convention; the spread does not depend on it.
 *
 * The row names its block by id (`refId`). A run expands a block into point
 * rows that keep the block's id in `measuredCurveBlockId`, so the points are
 * read from whichever form is in the list.
 */

import {
    isEllipsometricQuantity, isMeasuredCurve, logValue, measuredCurveChannel,
} from '../../operandModel.js';
import { measuredCurveEngineTargets } from '../../measuredCurveOperand.js';
import { charOf } from '../../sampling.js';
import { tmmProp } from '../tmmEval.js';
import { OperandEvaluationError, _assertMeasurementSide } from './errors.js';

const MISSING = 'The curve block this row is measured against is not in the merit function.';
const SWITCHED_OFF = 'The curve block this row is measured against is switched off.';
const NOT_PHOTOMETRIC = 'A peak-to-peak error is taken against a T, R or A curve, not against Ψ or Δ.';

// The block's points, wherever they are: the block itself, or the point rows
// a run expanded it into. Targets in the block's own unit.
function blockPoints(op, ctx) {
    const operands = ctx._operandsById;
    const block = operands?.get(op.refId);
    if (block && isMeasuredCurve(block.type)) {
        return {
            enabled: block.enabled !== false, channel: measuredCurveChannel(block),
            lambdas: block.sampleLambdas || [], targets: measuredCurveEngineTargets(block) || [],
            aoi: block.aoi ?? 0, pol: block.pol || 'avg', side: block,
        };
    }
    const rows = [];
    for (const row of operands?.values() ?? []) if (row.measuredCurveBlockId === op.refId) rows.push(row);
    if (!rows.length) return null;
    return {
        enabled: rows.every(row => row.enabled !== false), channel: rows[0].type,
        lambdas: rows.map(row => row.lambdaStart), targets: rows.map(row => row.target),
        aoi: rows[0].aoi ?? 0, pol: rows[0].pol || 'avg', side: rows[0],
    };
}

function checkedPoints(op, ctx) {
    const points = blockPoints(op, ctx);
    if (!points || !points.lambdas.length) throw new OperandEvaluationError(MISSING);
    if (!points.enabled) throw new OperandEvaluationError(SWITCHED_OFF);
    if (!points.channel || isEllipsometricQuantity(points.channel)) throw new OperandEvaluationError(NOT_PHOTOMETRIC);
    return points;
}

// A target in dB: a block on the T-in-dB channel holds dB already; a T, R or A
// block holds a fraction.
const targetInDb = (channel, target) => (channel === 'TDB' ? target : logValue('dB', target));

/**
 * The spread of EF over the block's points, in dB. The wavelengths of the
 * highest and lowest EF, and what the design reads there, are kept on the
 * context for the Jacobian, which differentiates EF at those two points alone.
 */
export function _evalPPEF(op, ctx) {
    const points = checkedPoints(op, ctx);
    _assertMeasurementSide(points.side, ctx);
    const char = charOf(points.channel);
    let high = -Infinity;
    let low = Infinity;
    let atHigh = null;
    let atLow = null;
    for (let index = 0; index < points.lambdas.length; index++) {
        const lambda = points.lambdas[index];
        const design = tmmProp(lambda, points.aoi, points.pol, char, ctx, ctx.frontThicks, ctx.frontMats);
        const ef = targetInDb(points.channel, points.targets[index]) - logValue('dB', design);
        if (!Number.isFinite(ef)) return NaN;
        if (ef > high) { high = ef; atHigh = lambda; }
        if (ef < low) { low = ef; atLow = lambda; }
    }
    ctx._extremumLambdas?.set(op, { high: atHigh, low: atLow, char, aoi: points.aoi, pol: points.pol });
    return high - low;
}
