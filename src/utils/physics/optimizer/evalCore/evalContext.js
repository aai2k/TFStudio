/**
 * Evaluation context construction and the operand evaluation pass. The context
 * carries the resolved media, both layer stacks and the illumination cone for
 * one design, plus the per-call caches that let operands sharing a (λ, angle,
 * polarization) coordinate reuse one TMM result.
 */

import { isGroupDelayFlat } from '../operandModel.js';
import { makeConeSpec } from '../coneAngle.js';
import { isFullSystemEval } from './tmmEval.js';
import {
    evalOperand, OperandEvaluationError, resetOperandCaches, groupDelayFlatBandLevel,
} from './operands/index.js';

// Build an evaluation context from a design. Used by callers that already have
// `design` and `resolveMat` (Refinement, GE, Needle, MeritFunctionEditor).
//   surfaceMode = 'symmetric'        → backLayers auto-synced to frontLayers
//   surfaceMode = 'both_independent' → both stacks used as stored
//   surfaceMode = 'front_only'       → back stack ignored
export function buildEvalContext(design, resolveMat) {
    const surfaceMode = design?.surfaceMode || 'front_only';
    const mfEvalMode  = design?.mfEvalMode  || 'side';
    const evalFullSystem = isFullSystemEval(surfaceMode, mfEvalMode);
    const inc   = typeof design.incidentMedium === 'string' ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const exit  = typeof design.exitMedium === 'string' ? design.exitMedium : (design.exitMedium?.material ?? 'Air');
    const front = design.frontLayers || [];
    const backRaw = design.backLayers || [];
    const back  = surfaceMode === 'symmetric' ? [...front].reverse() : backRaw;

    const frontThicks = front.map(l => l.thickness || 0);
    const frontMats   = front.map(l => resolveMat(l.material));
    const backThicks  = back.map(l => l.thickness || 0);
    const backMats    = back.map(l => resolveMat(l.material));

    // Cone-angle averaging: a design-level convergent/divergent
    // beam spec. Normalized once here so every operand evaluated through this
    // ctx shares the same cone. Absent/disabled → coneIsActive() is false and
    // tmmProp stays on the single-angle fast path (bit-identical).
    const cone = makeConeSpec(design?.cone || {});

    return {
        _isEvalContext:       true,
        surfaceMode,
        mfEvalMode,
        evalFullSystem,
        cone,
        _coneNodeCache:       new Map(),
        n0mat:                resolveMat(inc),
        nsmat:                resolveMat(design.substrate?.material ?? 'BK7'),
        neMat:                resolveMat(exit),
        substrateThicknessMm: design.substrate?.thickness ?? 1.0,
        frontThicks, frontMats,
        backThicks,  backMats,
        // fullThicks is what constraint operands act on. It follows the active
        // coating in single-side modes and spans both in both_independent mode.
        fullThicks:  surfaceMode === 'both_independent'
                        ? [...frontThicks, ...backThicks]
                        : surfaceMode === 'back_only'
                            ? backThicks
                            : frontThicks,
    };
}

// The context the legacy positional call form implies: a front-only, side-scored
// evaluation on a semi-infinite substrate.
function _legacyContext(n0mat, nsmat, thicknesses, mats) {
    return {
        _isEvalContext:       true,
        surfaceMode:          'front_only',
        mfEvalMode:           'side',
        evalFullSystem:       false,
        n0mat,
        nsmat,
        neMat:                n0mat,
        substrateThicknessMm: 1.0,
        frontThicks:          thicknesses,
        frontMats:            mats,
        backThicks:           [],
        backMats:             [],
        fullThicks:           thicknesses,
    };
}

// Fresh per-call memoization. Thicknesses/materials are fixed for the
// duration of this call, so (λ,aoi,polCode)→{R,T,A} and (mat,λ)→ñ are
// invariant and shared across operands (notably paired R+T). Always
// overwritten so a reused ctx object can never serve a stale result.
// Operands are indexed by id so math operands can resolve op.refId / refId1/2
// in O(1) and so makeRefResolver can do recursive eval with memoization and
// cycle detection.
function _resetPerCallCaches(ctx, operands) {
    ctx._tmmCache = new Map();
    ctx._nkCache  = new Map();
    resetOperandCaches(ctx);
    ctx._operandsById = new Map();
    for (const op of operands) ctx._operandsById.set(op.id, op);
    ctx._refCache = new Map();
    ctx._refStack = new Set();
}

// Evaluate every enabled operand. A disabled row and a row whose evaluation
// raised OperandEvaluationError both yield a null value; the error message is
// kept alongside so the merit function can exclude the row and the table can
// explain why. Any other exception propagates.
function _evaluateValues(operands, ctx) {
    const values = new Array(operands.length);
    const errors = new Array(operands.length).fill(null);
    for (let index = 0; index < operands.length; index++) {
        const op = operands[index];
        if (!op.enabled) {
            values[index] = null;
            continue;
        }
        try {
            values[index] = evalOperand(op, ctx);
        } catch (error) {
            if (!(error instanceof OperandEvaluationError)) throw error;
            values[index] = null;
            errors[index] = error.message;
        }
    }
    return { values, errors };
}

// Achieved band level for flatness rows, so the table can show a number
// comparable to the target instead of only the RMS deviation. Display-only:
// the merit function scores `values`.
function _bandLevels(operands, values, ctx) {
    const levels = new Array(operands.length).fill(null);
    for (let index = 0; index < operands.length; index++) {
        const op = operands[index];
        if (!op.enabled || values[index] == null || !isGroupDelayFlat(op.type)) continue;
        try {
            levels[index] = groupDelayFlatBandLevel(op, ctx);
        } catch (error) {
            if (!(error instanceof OperandEvaluationError)) throw error;
        }
    }
    return levels;
}

// Backward-compatible evaluator.
//   Old form: evaluateOperands(operands, n0mat, nsmat, thicknesses, mats)
//   New form: evaluateOperands(operands, ctx)  where ctx is from buildEvalContext
// The old form defaults to surfaceMode='front_only'.
export function evaluateOperands(operands, ctxOrN0, nsmatLegacy, thicknessesLegacy, matsLegacy) {
    const ctx = (ctxOrN0 && ctxOrN0._isEvalContext)
        ? ctxOrN0
        : _legacyContext(ctxOrN0, nsmatLegacy, thicknessesLegacy, matsLegacy);

    _resetPerCallCaches(ctx, operands);
    const { values, errors } = _evaluateValues(operands, ctx);
    const levels = _bandLevels(operands, values, ctx);

    Object.defineProperty(values, 'operandErrors', { value: errors });
    Object.defineProperty(values, 'operandBandLevels', { value: levels });
    return values;
}

export function operandEvaluationErrors(computed) {
    return computed?.operandErrors || [];
}

/** Achieved band level per row, aligned with `computed`; null where not applicable. */
export function operandBandLevels(computed) {
    return computed?.operandBandLevels || [];
}
