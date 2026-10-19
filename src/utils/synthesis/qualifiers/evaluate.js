/**
 * Qualifier evaluation.
 *
 * Evaluation strategy:
 *   For each qualifier we synthesize a temporary list of MF operands that
 *   compute the relevant scalar(s), reuse the validated
 *   evaluateOperands / buildEvalContext pipeline, then post-process the
 *   results into { value, pass, deviation, fail_message }. This keeps
 *   the qualifier window's math in lockstep with the optimizer's math —
 *   no second physics implementation to keep in sync.
 *
 * Dispatch is a kind → evaluator lookup table (KIND_EVALUATORS); each
 * evaluator handles one qualifier kind and returns the finished
 * { value, pass, deviation, unit, threshold } result (format.js writes its text).
 */

import { makeOperand, evaluateOperands, buildEvalContext, withFringeSampleCounts, effectiveBackLayers } from '../../physics/optimizer.js';
import { channelFromKind, singleType, avgType, minmaxType, argwaveType, integralType } from './channelTypes.js';
import { finishCompare } from './format.js';
import { checkStepFlag, budgetSide } from './constants.js';
import { evalBandDerived } from './bandScan.js';
import { ppefRows } from './ppefRows.js';

// The Step a check reads its row at (checkStepFlag), which Generate MF writes
// on that row, or the default when `options.coarse` asks for a first answer
// quickly.
const stepOf = (qual, type, options) => (options?.coarse ? {} : checkStepFlag(qual, type));

// A check's row evaluated as the Merit Function Editor and a run evaluate it:
// band rows sampled for the design's fringes (evalCore/fringeSampling.js), so
// a check and the row Generate MF writes for it read one number.
export function rowValue(op, ctx) {
    return evaluateOperands(withFringeSampleCounts([op], ctx), ctx)[0];
}

// ── Static (geometry-only) qualifiers ───────────────────────────────────────

// The layers a thickness budget or layer count adds up (budgetSide): the front
// stack, the back stack as the design is evaluated with it (the mirrored front
// on a symmetric design), or both.
function sideLayers(qual, design) {
    const side = budgetSide(qual);
    const front = side === 'back' ? [] : (design?.frontLayers || []);
    const back = side === 'front' ? [] : effectiveBackLayers(design);
    return [...front, ...back];
}

function evalThicknessBudget(qual, design) {
    const v = sideLayers(qual, design).reduce((s, l) => s + (l.thickness || 0), 0);
    return finishCompare(qual, v, 'nm');
}

function evalLayerCount(qual, design) {
    return finishCompare(qual, sideLayers(qual, design).length, '');
}

// ── Optical scalar qualifiers ────────────────────────────────────────────────

function evalSingleAt(qual, design, ctx) {
    const ch  = channelFromKind(qual.kind) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const op = makeOperand({
        type: singleType(ch, pol),
        lambdaStart: qual.lambda, lambdaEnd: qual.lambda,
        aoi: qual.aoi, pol, target: 0, weight: 1,
    });
    return finishCompare(qual, rowValue(op, ctx), '%');
}

function evalAvg(qual, design, ctx, options) {
    const ch  = channelFromKind(qual.kind) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const type = avgType(ch, pol);
    const op = makeOperand({
        type,
        lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
        aoi: qual.aoi, pol, target: 0, weight: 1, ...stepOf(qual, type, options),
    });
    return finishCompare(qual, rowValue(op, ctx), '%');
}

// MIN_MAX: the true min or max of T, R or A over a band, the "T(λ) ≥ X across
// the band" or "R(λ) ≤ Y across the band" spec on optical drawings. Evaluated
// through the TMN/TMX/RMN/RMX/AMN/AMX operand Generate MF writes, which returns
// the true band extremum (bandExtremum.js) searched at the check's Step, which
// Generate MF writes on that row, so the two read the same value.
function evalMinMax(qual, design, ctx, options) {
    const ch  = channelFromKind(qual.kind) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const type = minmaxType(ch, qual.direction);
    const op = makeOperand({
        type,
        lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
        aoi: qual.aoi, pol, target: 0, weight: 1, ...stepOf(qual, type, options),
    });
    return finishCompare(qual, rowValue(op, ctx), '%');
}

function evalIntegral(qual, design, ctx, options) {
    const ch  = channelFromKind(qual.kind) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const type = integralType(ch);
    const op = makeOperand({
        type,
        lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
        aoi: qual.aoi, pol, target: 0, weight: 1, ...stepOf(qual, type, options),
        source: qual.source, detector: qual.detector,
        bandPoints: qual.bandPoints,
    });
    return finishCompare(qual, rowValue(op, ctx), '%');
}

// CENTRAL_LAMBDA: argwave on the requested channel, through the optimizer's
// argwave operand at the check's Step, so the check reads as the MXWT/MNW* row
// Generate MF writes.
function evalCentralLambda(qual, design, ctx, options) {
    const ch  = channelFromKind(qual.kind) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const type = argwaveType(qual.direction, ch, pol);
    const op = makeOperand({
        type,
        lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
        aoi: qual.aoi, pol, target: qual.target, weight: 1, ...stepOf(qual, type, options),
    });
    return finishCompare(qual, rowValue(op, ctx), 'nm');
}

// PPEF: peak-to-peak error against one of the design's measured T, R or A
// curves, read through the PPEF row the merit table uses, so a Specification
// verdict and the merit row cannot disagree.
function evalPPEF(qual, design, ctx) {
    const rows = ppefRows(qual, design);
    if (!rows) {
        return { value: null, pass: false, deviation: null, unit: 'dB', summaryKey: 'noCurve' };
    }
    const values = evaluateOperands([rows.block, rows.row], ctx);
    return finishCompare(qual, values[1], 'dB');
}

const KIND_EVALUATORS = {
    THICKNESS_BUDGET: evalThicknessBudget,
    LAYER_COUNT:      evalLayerCount,
    T_AT: evalSingleAt, R_AT: evalSingleAt, A_AT: evalSingleAt,
    T_AVG: evalAvg,     R_AVG: evalAvg,     A_AVG: evalAvg,
    MIN_MAX:          evalMinMax,
    INTEGRAL:         evalIntegral,
    CENTRAL_LAMBDA:   evalCentralLambda,
    FWHM:             evalBandDerived,
    EDGE_LAMBDA:      evalBandDerived,
    PPEF:             evalPPEF,
};

// Evaluate one qualifier against a design. Returns:
//   { value, pass, deviation, unit, threshold }
// where value is the raw computed number, unit is 'nm', '%', 'dB' or ''
// depending on kind, and threshold is what the value was held to. One that
// could not be computed carries a summaryKey instead of a threshold.
// Every check reads its band at its own Step. `options.coarse` reads it at the
// default instead, for a first answer on the window's own thread.
export function evaluateQualifier(qual, design, resolveMat, options = {}) {
    const ctx = buildEvalContext(design, resolveMat);
    const evaluator = KIND_EVALUATORS[qual.kind];
    if (!evaluator) {
        return {
            value: null, pass: false, deviation: null, unit: '',
            summaryKey: 'unknownKind', summaryArgs: [qual.kind],
        };
    }
    return evaluator(qual, design, ctx, options);
}

// Evaluate every qualifier in a list against a design.
export function evaluateQualifiers(qualifiers, design, resolveMat, options = {}) {
    return (qualifiers || []).map(q =>
        q.enabled
            ? evaluateQualifier(q, design, resolveMat, options)
            : { value: null, pass: null, deviation: null, unit: '', summaryKey: 'disabled' }
    );
}

// Aggregate verdict: { passing, total, allPass, anyFail }.
export function aggregateVerdict(results) {
    let passing = 0, total = 0;
    for (const r of results) {
        if (r && r.pass === null) continue;     // skip disabled
        total += 1;
        if (r && r.pass === true) passing += 1;
    }
    return { passing, total, allPass: total > 0 && passing === total, anyFail: passing < total };
}
