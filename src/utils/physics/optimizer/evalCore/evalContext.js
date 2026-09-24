/**
 * Evaluation context construction and the operand evaluation pass. The context
 * carries the resolved media, both layer stacks and the illumination cone for
 * one design, plus the per-call caches that let operands sharing a (λ, angle,
 * polarization) coordinate reuse one TMM result.
 */

import { isGroupDelayFlat, isMath } from '../operandModel.js';
import { makeConeSpec } from '../coneAngle.js';
import { isFullSystemEval } from './tmmEval.js';
import {
    evalOperand, OperandEvaluationError, resetOperandCaches, groupDelayFlatBandLevel,
} from './operands/index.js';
import { settleConeNodes } from './coneNodeCount.js';

/**
 * The back stack a design is actually evaluated with.
 *
 * Mirror symmetry: the back coating is the front one repeated, so the physical
 * sequence outward from the substrate is identical on both faces. The front is
 * stored air→substrate and the back substrate→exit, which makes the mirror the
 * REVERSED front rather than a copy, and leaves whatever `backLayers` holds
 * unread. Every reader of a design's two stacks goes through this, so the
 * merit function, the optimizer and the analysis windows cannot disagree about
 * what is on the back.
 */
export function effectiveBackLayers(design) {
    const front = design?.frontLayers || [];
    return (design?.surfaceMode || 'front_only') === 'symmetric'
        ? [...front].reverse()
        : (design?.backLayers || []);
}

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
    const back  = effectiveBackLayers(design);

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
        // Stress run temperatures, read by the STR operand. Absent → every film
        // carries its intrinsic stress and nothing thermal.
        stress:               design?.stress || null,
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
// duration of this call, so (λ,aoi,polCode)→{R,T,A}, (mat,λ)→ñ and each
// stack's distinct-material index are invariant and shared across operands
// (paired R+T rows above all). Always
// overwritten so a reused ctx object can never serve a stale result.
// Operands are indexed by id so math operands can resolve op.refId / refId1/2
// in O(1) and so makeRefResolver can do recursive eval with memoization and
// cycle detection. The range targets leave their per-sample deviations in
// _sampleDeviations and the worst-case min/max rows the wavelength of their
// extremum in _extremumLambdas, both keyed by operand.
function _resetPerCallCaches(ctx, operands) {
    ctx._tmmCache = new Map();
    ctx._nkCache  = new Map();
    ctx._stackIndex = new Map();
    ctx._sampleDeviations = new Map();
    ctx._extremumLambdas = new Map();
    resetOperandCaches(ctx);
    ctx._operandsById = new Map();
    for (const op of operands) ctx._operandsById.set(op.id, op);
    ctx._refCache = new Map();
    ctx._refStack = new Set();
}

// Why a row's value is not a finite number. A math row gets one when a row it
// references is disabled, missing, in a reference cycle or without a value.
function _nonFiniteMessage(op) {
    return isMath(op.type)
        ? 'A row it references is disabled, missing, in a reference cycle, or has no value.'
        : 'Its value is not a finite number.';
}

// Evaluate every enabled operand. A disabled row, a row whose evaluation raised
// OperandEvaluationError and a row whose value is not a finite number all yield
// a null value; for the last two the reason is kept alongside, so the merit
// function refuses to score the design and the table can explain why. Any
// other exception propagates.
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
            const value = evalOperand(op, ctx);
            if (typeof value === 'number' && !Number.isFinite(value)) {
                values[index] = null;
                errors[index] = _nonFiniteMessage(op);
            } else {
                values[index] = value;
            }
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
    settleConeNodes(operands, ctx);
    const { values, errors } = _evaluateValues(operands, ctx);
    const levels = _bandLevels(operands, values, ctx);
    const deviations = ctx._sampleDeviations.size > 0
        ? operands.map(op => ctx._sampleDeviations.get(op) || null)
        : [];
    const extremumLambdas = ctx._extremumLambdas.size > 0
        ? operands.map(op => ctx._extremumLambdas.get(op) ?? null)
        : [];

    Object.defineProperty(values, 'operandErrors', { value: errors });
    Object.defineProperty(values, 'operandBandLevels', { value: levels });
    Object.defineProperty(values, 'operandSampleDeviations', { value: deviations });
    Object.defineProperty(values, 'operandExtremumLambdas', { value: extremumLambdas });
    return values;
}

export function operandEvaluationErrors(computed) {
    return computed?.operandErrors || [];
}

/**
 * Per-sample deviations from the target line, aligned with `computed`, for the
 * range targets (TGT/RGT/AGT); null or absent for every other row. The least-
 * squares engine takes one residual per sample from these.
 */
export function operandSampleDeviations(computed) {
    return computed?.operandSampleDeviations || [];
}

/**
 * Grid wavelength, nm, at which each worst-case min/max row (TMN..AMX) found
 * its extremum, aligned with `computed`; null or absent for every other row.
 */
export function operandExtremumLambdas(computed) {
    return computed?.operandExtremumLambdas || [];
}

/** Achieved band level per row, aligned with `computed`; null where not applicable. */
export function operandBandLevels(computed) {
    return computed?.operandBandLevels || [];
}
