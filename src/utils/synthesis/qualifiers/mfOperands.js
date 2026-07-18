/**
 * MF-generation helper — convert each qualifier into one or more MF operands.
 *
 * Zemax-style architecture:
 *   1. Emit the BASE T/R/A/argwave/integral row (the actual physical operand
 *      whose value the spec is about). Its target is set to a sensible
 *      neutral value (0 for equality use; the user's threshold for eq specs).
 *   2. Emit a separate OPGT/OPLT/OPVA row that REFERENCES the base operand
 *      by id (op.refId). Its target is the user's spec threshold.
 *
 * For 'between' specs we emit ONE base row + OPGT(refId=base.id) + OPLT(...).
 * For 'eq' specs we just emit the base row with target = user's value
 * (equality two-sided residual is exactly what the user wants).
 * For 'ge'/'le' we emit base + OPGT/OPLT pointing at it.
 *
 * This matches the Zemax merit-function convention: spec rows REFERENCE
 * physical-measurement rows by Op#. The user can later insert / delete /
 * reorder rows in the MF table and the reference (stable id) follows.
 *
 * Dispatch is two lookup tables: BASE_OP_BUILDERS (kind → base-operand
 * builder) and CMP_EMITTERS (cmp → spec-row emitter).
 */

import { makeOperand } from '../../physics/optimizer.js';
import { channelFromKind, singleType, avgType, minmaxType, argwaveType } from './channelTypes.js';

// ── Base physical-measurement operand, one builder per kind ─────────────────

function buildSingleBaseOp(q, ch, pol, weight) {
    return makeOperand({
        type: singleType(ch, pol),
        lambdaStart: q.lambda, lambdaEnd: q.lambda,
        aoi: q.aoi, pol, weight, target: 0,
    });
}

function buildAvgBaseOp(q, ch, pol, weight) {
    return makeOperand({
        type: avgType(ch, pol),
        lambdaStart: q.lambdaStart, lambdaEnd: q.lambdaEnd,
        aoi: q.aoi, pol, weight, target: 0,
    });
}

// Min/max measurement row — the optimizer's soft-min/soft-max over the band
// (smooth surrogate for the true extremum). The ge/le/between/eq logic below
// references this row, so a "min T ≥ 90 %" spec becomes TMN(weight 0) +
// OPGT(refId, 0.90).
function buildMinMaxBaseOp(q, ch, pol, weight) {
    return makeOperand({
        type: minmaxType(ch, q.direction),
        lambdaStart: q.lambdaStart, lambdaEnd: q.lambdaEnd,
        aoi: q.aoi, pol, weight, target: 0,
    });
}

function buildIntegralBaseOp(q, ch, pol, weight) {
    const opType = ch === 'R' ? 'RIW' : ch === 'A' ? 'AIW' : 'TIW';
    return makeOperand({
        type: opType,
        lambdaStart: q.lambdaStart, lambdaEnd: q.lambdaEnd,
        aoi: q.aoi, pol, weight, target: 0,
        source: { ...q.source }, detector: { ...q.detector },
        ...(Number.isFinite(q.bandPoints) ? { bandPoints: q.bandPoints } : {}),
    });
}

function buildCentralLambdaBaseOp(q, ch, pol, weight) {
    const opType = argwaveType(q.direction, ch, pol);
    return makeOperand({
        type: opType,
        lambdaStart: q.lambdaStart, lambdaEnd: q.lambdaEnd,
        aoi: q.aoi, pol, weight, target: q.target,
        ...(Number.isFinite(q.bandPoints) ? { bandPoints: q.bandPoints } : {}),
    });
}

// FWHM / EDGE_LAMBDA: no direct MF operand — needs a derived FWHM operand
// with its own gradient (open follow-up). LAYER_COUNT / THICKNESS_BUDGET are
// filtered out by the caller before reaching this table (discrete /
// sum-constraints; MNT/MXT would partially cover them).
const BASE_OP_BUILDERS = {
    T_AT: buildSingleBaseOp, R_AT: buildSingleBaseOp, A_AT: buildSingleBaseOp,
    T_AVG: buildAvgBaseOp,   R_AVG: buildAvgBaseOp,   A_AVG: buildAvgBaseOp,
    MIN_MAX:        buildMinMaxBaseOp,
    INTEGRAL:       buildIntegralBaseOp,
    CENTRAL_LAMBDA: buildCentralLambdaBaseOp,
};

// ── Spec rows, one emitter per comparator ────────────────────────────────────
// The base operand's WEIGHT is forced to 0 for ge/le/between so it
// contributes nothing to the merit function (otherwise the equality residual
// (val − base.target) would fight the inequality constraint), but its TARGET
// is set to the spec value so the MFE table shows "spec = 99 %, value = 99.5 %"
// instead of "spec = 0 %, value = 99.5 %".

function emitGe(baseOp, q, weight, k, out) {
    baseOp.target = q.target;
    baseOp.weight = 0;
    out.push(baseOp);
    out.push(makeOperand({ type: 'OPGT', refId: baseOp.id, target: q.target, weight }));
}

function emitLe(baseOp, q, weight, k, out) {
    baseOp.target = q.target;
    baseOp.weight = 0;
    out.push(baseOp);
    out.push(makeOperand({ type: 'OPLT', refId: baseOp.id, target: q.target, weight }));
}

function emitBetween(baseOp, q, weight, k, out) {
    baseOp.target = (q.lo + q.hi) / 2;      // midpoint = display only
    baseOp.weight = 0;
    out.push(baseOp);
    out.push(makeOperand({ type: 'OPGT', refId: baseOp.id, target: q.lo, weight }));
    out.push(makeOperand({ type: 'OPLT', refId: baseOp.id, target: q.hi, weight }));
}

// eq (and any other comparator) → just the base operand at the requested
// target. For CENTRAL_LAMBDA the target already lives on the argwave row; for
// T_AT/T_AVG/etc. we set it now. Weight stays at the user-requested value
// because this row IS the spec.
function emitEq(baseOp, q, weight, k, out) {
    if (k !== 'CENTRAL_LAMBDA') baseOp.target = q.target;
    out.push(baseOp);
}

const CMP_EMITTERS = { ge: emitGe, le: emitLe, between: emitBetween };

export function qualifiersToMFOperands(qualifiers, opts = {}) {
    const out = [];
    const weight = opts.weight || 1.0;
    for (const q of (qualifiers || [])) {
        if (!q.enabled) continue;
        const k = q.kind;

        // Geometry-only qualifiers don't translate to MF operands the
        // optimizer can act on.
        if (k === 'LAYER_COUNT' || k === 'THICKNESS_BUDGET') continue;

        const buildBaseOp = BASE_OP_BUILDERS[k];
        if (!buildBaseOp) continue;   // FWHM/EDGE_LAMBDA or unknown kind

        const ch  = channelFromKind(k) || q.channel || 'T';
        const pol = q.pol || 'avg';
        const baseOp = buildBaseOp(q, ch, pol, weight);

        const emit = CMP_EMITTERS[q.cmp] || emitEq;
        emit(baseOp, q, weight, k, out);
    }
    return out;
}
