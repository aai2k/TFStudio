/**
 * The measured-curve merit block: building one, and expanding it for a run.
 *
 * A measured spectrum is one row in the merit table carrying a snapshot of the
 * sampled curve, and it evaluates directly as the RMS deviation from those
 * points. Least squares needs more than that: it wants one residual and one
 * Jacobian row per measured point, or the whole curve contributes a single
 * rank-one block and Gauss-Newton learns nothing about the fit. So the block is
 * expanded into ordinary single-wavelength operands at run launch. Both forms
 * score the same merit, which is what makes the two views interchangeable.
 *
 * A block holds one channel: R, T or A of a photometric measurement, or Ψ or
 * Δ of an ellipsometric one. A Δ block also records the sign convention its
 * points were written in, and both forms move them into the sign the point
 * evaluator returns before comparing.
 */

import {
    MEASURED_CURVE_QUANTITIES, isMeasuredCurve, makeOperand,
} from './operandModel.js';
import { CALCULATED_DELTA_CONVENTION, convertDeltaConvention } from '../thinFilmMath.js';

/** Build the persisted one-row snapshot used to fit a known design to a curve. */
function makeMeasuredCurveOperand(overrides = {}) {
    const sampleLambdas = Array.isArray(overrides.sampleLambdas)
        ? overrides.sampleLambdas.slice()
        : [];
    const sampleTargets = Array.isArray(overrides.sampleTargets)
        ? overrides.sampleTargets.slice()
        : [];
    return makeOperand({
        type: 'MCURVE',
        target: 0,
        quantity: 'R',
        curveId: null,
        curveName: 'Measured curve',
        ...overrides,
        sampleLambdas,
        sampleTargets,
    });
}

// The conversion below allocates a copy of the whole snapshot, and the merit
// table asks for it on every evaluation of the block, so the result is held
// against the block it came from. A snapshot edit produces a new operand object
// and a new sampleTargets array, either of which retires the entry; the WeakMap
// lets a block that is deleted go with it.
const convertedDeltaTargets = new WeakMap();

/**
 * The block's targets in the units the point evaluator compares against: a Δ
 * snapshot moved from the convention its file was written in into the one
 * computeEllipsometry returns. Every other channel is stored as evaluated.
 */
function measuredCurveEngineTargets(op) {
    if (op.quantity !== 'DEL') return op.sampleTargets;
    const convention = op.deltaConvention || 'azzam';
    const cached = convertedDeltaTargets.get(op);
    if (cached && cached.from === op.sampleTargets && cached.convention === convention) {
        return cached.targets;
    }
    const targets = convertDeltaConvention(
        op.sampleTargets, convention, CALCULATED_DELTA_CONVENTION);
    convertedDeltaTargets.set(op, { from: op.sampleTargets, convention, targets });
    return targets;
}

/** Expand one valid measured snapshot into pointwise single-wavelength operands. */
function expandMeasuredCurveOperand(op) {
    if (!isMeasuredCurve(op?.type)) return [op];
    const lambdas = op.sampleLambdas;
    if (!Array.isArray(lambdas) || !Array.isArray(op.sampleTargets)
        || lambdas.length === 0 || lambdas.length !== op.sampleTargets.length) return [op];
    const targets = measuredCurveEngineTargets(op);
    const pointWeight = op.weight / lambdas.length;
    const type = MEASURED_CURVE_QUANTITIES.includes(op.quantity) ? op.quantity : 'R';
    return lambdas.map((lambda, index) => ({
        id: `${op.id}:${index}`,
        enabled: op.enabled !== false,
        type,
        lambdaStart: lambda,
        lambdaEnd: lambda,
        aoi: op.aoi ?? 0,
        pol: op.pol || 'avg',
        target: targets[index],
        targetEnd: null,
        weight: pointWeight,
        measuredCurveBlockId: op.id,
        measuredCurveId: op.curveId || null,
        measurementSide: op.side || 'front',
    }));
}

/** Expand every measured block while preserving all other operand identities. */
function expandMeasuredCurveOperands(operands) {
    if (!Array.isArray(operands)) return operands;
    let changed = false;
    const output = [];
    for (const op of operands) {
        const expanded = expandMeasuredCurveOperand(op);
        if (expanded.length !== 1 || expanded[0] !== op) changed = true;
        output.push(...expanded);
    }
    return changed ? output : operands;
}

export {
    makeMeasuredCurveOperand, measuredCurveEngineTargets,
    expandMeasuredCurveOperand, expandMeasuredCurveOperands,
};
