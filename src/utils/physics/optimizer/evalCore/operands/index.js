/**
 * Operand dispatch: the single entry point that scores one merit-function row,
 * and the resolver that lets a math row reference other rows.
 */

import { isConstraint, isDmfs, isBlank, isStress, isTotalThickness, isRangeTarget, isMeasuredCurve, isIntegral, isMinmax, isArgwave, isMath, isEllipsometry, isPhaseShift, isGroupDelay, isGroupDelayFlat, isEField, isEllipsometricMeasuredCurve, argwaveOpticalChar, argwavePolCode, polFromType } from '../../operandModel.js';
import { charOf, operandSampleLambdas } from '../../sampling.js';
import { computeMathValue } from '../mathOperands.js';
import { _evalTotalThickness, _evalStressForce, _evalConstraint, _evalArgwave, _evalIntegral, _evalMinmax, _evalRangeTarget, _evalBandAvgOrSingle } from './basic.js';
import { _evalMeasuredCurve } from './measured.js';
import { _evalEllipsometry, resetEllipsometryCaches } from './ellipsometry.js';
import { _evalPhaseDispersionPoint, _evalGroupDelayFlat, resetPhaseDispersionCache } from './phase.js';
import { _evalEField } from './efield.js';

export { OperandEvaluationError } from './errors.js';
export { ellipsometryThicknessPoint } from './ellipsometry.js';
export { phaseDispersionThicknessPoint, groupDelayFlatBandLevel } from './phase.js';

// Clear every memo an operand evaluator keeps on the context. Each family owns
// the list of its own caches, so a cache added to one of them cannot be left
// out of the reset an evaluation pass performs.
export function resetOperandCaches(ctx) {
    resetPhaseDispersionCache(ctx);
    resetEllipsometryCaches(ctx);
}

// Look-up referenced operand row(s) by id and recursively evaluate.  Cycle
// detection: an operand on a cycle returns NaN.  ctx._refStack is the call
// stack of in-flight ref evaluations; ctx._refCache memoizes finished values.
// A referenced row with no value of its own (a comment row) also gives NaN, so
// the math row has no value rather than computing from null.
export function makeRefResolver(ctx) {
    const operands = ctx?._operandsById;
    return (refId) => {
        if (!operands) return NaN;
        const op = operands.get(refId);
        if (!op || !op.enabled) return NaN;
        if (!ctx._refCache) ctx._refCache = new Map();
        if (ctx._refCache.has(refId)) return ctx._refCache.get(refId);
        if (!ctx._refStack) ctx._refStack = new Set();
        if (ctx._refStack.has(refId)) return NaN;  // cycle
        ctx._refStack.add(refId);
        try {
            const value = evalOperand(op, ctx);
            const v = value == null ? NaN : value;
            ctx._refCache.set(refId, v);
            return v;
        } finally {
            ctx._refStack.delete(refId);
        }
    };
}

// Zemax-style math operands (OPGT/OPLT/OPVA/ABSO/ABGT/ABLT/DIFF/SUMM/PROD):
// resolve op.refId / op.refId1+refId2 to other MF rows and compute a derived
// value. Returns the underlying VALUE — one-sided residual logic happens in
// calcMF / _residuals / the Jacobian.
function _evalMath(op, ctx) {
    // Legacy shim: an older saved file may have an OPGT/OPLT with op.baseType and
    // no refId — evaluate the virtual base operand directly (no recursion into
    // ctx.operands).
    if ((op.type === 'OPGT' || op.type === 'OPLT') && op.baseType && !op.refId) {
        return evalOperand({ ...op, type: op.baseType }, ctx);
    }
    return computeMathValue(op, makeRefResolver(ctx));
}

// Ordered operand-kind → evaluator dispatch. Order matters (checked top-down);
// the band-average / single-λ evaluator is the fall-through default. GDFLAT/
// GDDFLAT precede isGroupDelay because they also satisfy isGroupDelay.
const _EVAL_DISPATCH = [
    [isTotalThickness, _evalTotalThickness],
    [isStress,         _evalStressForce],
    [isConstraint,     _evalConstraint],
    [isMath,           _evalMath],
    [isArgwave,        _evalArgwave],
    [isIntegral,       _evalIntegral],
    [isMinmax,         _evalMinmax],
    [isRangeTarget,    _evalRangeTarget],
    [isMeasuredCurve,  _evalMeasuredCurve],
    [isEllipsometry,   _evalEllipsometry],
    [isGroupDelayFlat, _evalGroupDelayFlat],
    [isPhaseShift,     _evalPhaseDispersionPoint],
    [isGroupDelay,     _evalPhaseDispersionPoint],
    [isEField,         _evalEField],
];

export function evalOperand(op, ctx) {
    if (isDmfs(op.type) || isBlank(op.type)) return null;   // inert / comment
    for (const [test, evalFn] of _EVAL_DISPATCH) {
        if (test(op.type)) return evalFn(op, ctx);
    }
    return _evalBandAvgOrSingle(op, ctx);
}

// Rows whose evaluator reads nothing through tmmProp.
const _READS_NO_SPECTRUM = [
    isDmfs, isBlank, isTotalThickness, isStress, isConstraint, isMath,
    isEllipsometry, isGroupDelayFlat, isPhaseShift, isGroupDelay, isEField,
];

// The finite wavelengths of a measured block's snapshot.
const _snapshotLambdas = op => (Array.isArray(op.sampleLambdas) ? op.sampleLambdas : [])
    .filter(lambda => Number.isFinite(lambda) && lambda > 0);

/**
 * What a row reads through tmmProp, the cone-averaged R/T/A: its cone axis
 * `aoi` (deg), polarization, channel ('T' | 'R' | 'A') and wavelengths (nm),
 * the same values its evaluator in this dispatch passes. Null for a row that
 * reads no R, T or A (phase, ellipsometry, fields, thickness rows, math,
 * comments).
 */
export function operandSpectrumReads(op) {
    if (_READS_NO_SPECTRUM.some(test => test(op.type))) return null;
    if (isArgwave(op.type)) {
        return {
            aoi: op.aoi, pol: argwavePolCode(op.type) ?? op.pol ?? 'avg',
            char: argwaveOpticalChar(op.type), lambdas: operandSampleLambdas(op),
        };
    }
    if (isMeasuredCurve(op.type)) {
        if (isEllipsometricMeasuredCurve(op)) return null;
        return {
            aoi: op.aoi ?? 0, pol: op.pol || 'avg',
            char: ['T', 'R', 'A'].includes(op.quantity) ? op.quantity : 'R',
            lambdas: _snapshotLambdas(op),
        };
    }
    return {
        aoi: op.aoi, pol: polFromType(op.type) ?? op.pol,
        char: charOf(op.type), lambdas: operandSampleLambdas(op),
    };
}
