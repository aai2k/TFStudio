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
 */

import { isMeasuredCurve, makeOperand } from './operandModel.js';

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

/** Expand one valid measured snapshot into pointwise T/R/A target operands. */
function expandMeasuredCurveOperand(op) {
    if (!isMeasuredCurve(op?.type)) return [op];
    const lambdas = op.sampleLambdas;
    const targets = op.sampleTargets;
    if (!Array.isArray(lambdas) || !Array.isArray(targets)
        || lambdas.length === 0 || lambdas.length !== targets.length) return [op];
    const pointWeight = op.weight / lambdas.length;
    return lambdas.map((lambda, index) => ({
        id: `${op.id}:${index}`,
        enabled: op.enabled !== false,
        type: ['T', 'R', 'A'].includes(op.quantity) ? op.quantity : 'R',
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
    makeMeasuredCurveOperand, expandMeasuredCurveOperand, expandMeasuredCurveOperands,
};
