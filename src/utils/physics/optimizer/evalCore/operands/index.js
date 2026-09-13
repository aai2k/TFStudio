/**
 * Operand dispatch: the single entry point that scores one merit-function row,
 * and the resolver that lets a math row reference other rows.
 */

import { isConstraint, isDmfs, isBlank, isTotalThickness, isRangeTarget, isMeasuredCurve, isIntegral, isMinmax, isArgwave, isMath, isEllipsometry, isPhaseShift, isGroupDelay, isGroupDelayFlat, isEField } from '../../operandModel.js';
import { computeMathValue } from '../mathOperands.js';
import { _evalTotalThickness, _evalConstraint, _evalArgwave, _evalIntegral, _evalMinmax, _evalRangeTarget, _evalBandAvgOrSingle } from './basic.js';
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
            const v = evalOperand(op, ctx);
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
