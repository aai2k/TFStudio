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
 * For 'eq' specs with a tolerance we emit the same as 'between' over
 * target ± tol, so the rows are met exactly when the check passes; with no
 * tolerance, the base row at the target, a two-sided residual. A row that is
 * scored one-sided (worst case, PPEF) always gets the OPGT and OPLT pair, or
 * it would count the whole side past its target as met.
 * For 'ge'/'le' we emit base + OPGT/OPLT pointing at it.
 *
 * This matches the Zemax merit-function convention: spec rows REFERENCE
 * physical-measurement rows by Op#. The user can later insert / delete /
 * reorder rows in the MF table and the reference (stable id) follows.
 *
 * Dispatch is two lookup tables: BASE_OP_BUILDERS (kind → base-operand
 * builder) and CMP_EMITTERS (cmp → spec-row emitter).
 */

import { makeOperand, isMinmax, isPPEF } from '../../physics/optimizer.js';
import { channelFromKind, singleType, avgType, minmaxType, argwaveType } from './channelTypes.js';
import { ppefRows } from './ppefRows.js';
import { eqTolerance } from './constants.js';

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

// Min/max measurement row: the lowest or highest value over the band, taken on
// the band's sample grid. The ge/le/between/eq logic below
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
        // A check without a source or detector is weighted by makeOperand's
        // defaults, as evaluate.js weights it; an empty object would read as an
        // equal-energy source and a flat detector.
        source: q.source ? { ...q.source } : undefined,
        detector: q.detector ? { ...q.detector } : undefined,
        // Carry the preset identity so the Merit Function Editor shows the
        // integral by name (Tvis/Rsol/…) instead of an opaque "(custom)" row.
        ...(q.presetKey   ? { presetKey:   q.presetKey   } : {}),
        ...(q.presetLabel ? { presetLabel: q.presetLabel } : {}),
        ...(Number.isFinite(q.bandPoints) ? { bandPoints: q.bandPoints } : {}),
    });
}

function buildCentralLambdaBaseOp(q, ch, pol, weight) {
    const opType = argwaveType(q.direction, ch, pol);
    return makeOperand({
        type: opType,
        lambdaStart: q.lambdaStart, lambdaEnd: q.lambdaEnd,
        aoi: q.aoi, pol, weight, target: q.target,
    });
}

// PPEF: the curve block it is measured against goes in ahead of it, at weight
// 0, so the table holds the curve and the row reads it. Null when the curve it
// names is not on the design.
function buildPPEFBaseOp(q, ch, pol, weight, { design, out }) {
    const rows = ppefRows(q, design, { rowWeight: weight });
    if (!rows) return null;
    out.push(rows.block);
    return rows.row;
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
    PPEF:           buildPPEFBaseOp,
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

// The base row at weight 0 and the pair that holds it between lo and hi.
function emitRange(baseOp, lo, hi, weight, out) {
    baseOp.target = (lo + hi) / 2;          // midpoint = display only
    baseOp.weight = 0;
    out.push(baseOp);
    out.push(makeOperand({ type: 'OPGT', refId: baseOp.id, target: lo, weight }));
    out.push(makeOperand({ type: 'OPLT', refId: baseOp.id, target: hi, weight }));
}

function emitBetween(baseOp, q, weight, k, out) {
    emitRange(baseOp, q.lo, q.hi, weight, out);
}

// eq (and any other comparator). The check passes within target ± tol, so a
// tolerance becomes a range; with none, a two-sided row is the spec itself, at
// the requested target and weight. For CENTRAL_LAMBDA the target already lives
// on the argwave row; for T_AT/T_AVG/etc. we set it now.
function emitEq(baseOp, q, weight, k, out) {
    const tol = eqTolerance(q);
    if (tol > 0 || isMinmax(baseOp.type) || isPPEF(baseOp.type)) {
        emitRange(baseOp, q.target - tol, q.target + tol, weight, out);
        return;
    }
    if (k !== 'CENTRAL_LAMBDA') baseOp.target = q.target;
    out.push(baseOp);
}

const CMP_EMITTERS = { ge: emitGe, le: emitLe, between: emitBetween };

/**
 * The enabled checks Generate MF writes no row for: FWHM, EDGE_LAMBDA,
 * LAYER_COUNT, THICKNESS_BUDGET, and a PPEF check whose curve the design does
 * not hold. Read off qualifiersToMFOperands itself, so the two cannot disagree.
 */
export function checksWithoutRow(qualifiers, opts = {}) {
    return (qualifiers || []).filter(q => q.enabled && qualifiersToMFOperands([q], opts).length === 0);
}

// `opts.design` is the design whose measured curves a PPEF qualifier names.
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
        const baseOp = buildBaseOp(q, ch, pol, weight, { design: opts.design, out });
        if (!baseOp) continue;

        const emit = CMP_EMITTERS[q.cmp] || emitEq;
        emit(baseOp, q, weight, k, out);
    }
    return out;
}
