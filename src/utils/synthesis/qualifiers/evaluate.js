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

import { makeOperand, evaluateOperands, buildEvalContext, withFringeSampleCounts } from '../../physics/optimizer.js';
import { channelFromKind, singleType, avgType, minmaxType, argwaveType } from './channelTypes.js';
import { finishCompare } from './format.js';
import { evalBandDerived } from './bandScan.js';
import { ppefRows } from './ppefRows.js';

/**
 * The step flag the Specification window, the report and the Coating Library's
 * claims search a band at, and scan a FWHM or edge check's band at: 0.01 nm
 * (operandModel.js extremumStepNm), so only peaks closer than about 0.02 nm
 * can read as one. The windows show each check at the default 1 nm step at
 * once and at this one when it is ready; the Specification window follows a
 * run at 1 nm. Callers that evaluate the
 * Specification many times over, such as the Monte Carlo yield and the
 * tolerance windows' badge, keep the default.
 */
export const SPECIFICATION_FLAG = 3;

// The flag `options` asks for, as operand fields; none keeps the default.
const flagOf = options => (options?.flag ? { flag: options.flag } : {});

// A check's row evaluated as the Merit Function Editor and a run evaluate it:
// band rows sampled for the design's fringes (evalCore/fringeSampling.js), so
// a check and the row Generate MF writes for it read one number.
export function rowValue(op, ctx) {
    return evaluateOperands(withFringeSampleCounts([op], ctx), ctx)[0];
}

// ── Static (geometry-only) qualifiers ───────────────────────────────────────

function evalThicknessBudget(qual, design) {
    const layers = design?.frontLayers || [];
    const v = layers.reduce((s, l) => s + (l.thickness || 0), 0)
            + (design?.backLayers || []).reduce((s, l) => s + (l.thickness || 0), 0);
    return finishCompare(qual, v, 'nm');
}

function evalLayerCount(qual, design) {
    const v = (design?.frontLayers?.length || 0) + (design?.backLayers?.length || 0);
    return finishCompare(qual, v, '');
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

function evalAvg(qual, design, ctx) {
    const ch  = channelFromKind(qual.kind) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const op = makeOperand({
        type: avgType(ch, pol),
        lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
        aoi: qual.aoi, pol, target: 0, weight: 1,
    });
    return finishCompare(qual, rowValue(op, ctx), '%');
}

// MIN_MAX: the true min or max of T, R or A over a band, the "T(λ) ≥ X across
// the band" or "R(λ) ≤ Y across the band" spec on optical drawings. Evaluated
// through the TMN/TMX/RMN/RMX/AMN/AMX operand Generate MF writes, which returns
// the true band extremum (bandExtremum.js), so the check and that row read the
// same value whenever they search at the same step: the row at its Flag, the
// check at `options.flag`.
function evalMinMax(qual, design, ctx, options) {
    const ch  = channelFromKind(qual.kind) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const op = makeOperand({
        type: minmaxType(ch, qual.direction),
        lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
        aoi: qual.aoi, pol, target: 0, weight: 1, ...flagOf(options),
    });
    return finishCompare(qual, rowValue(op, ctx), '%');
}

function evalIntegral(qual, design, ctx) {
    const ch  = channelFromKind(qual.kind) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const opType = ch === 'R' ? 'RIW' : ch === 'A' ? 'AIW' : 'TIW';
    const op = makeOperand({
        type: opType,
        lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
        aoi: qual.aoi, pol, target: 0, weight: 1,
        source: qual.source, detector: qual.detector,
        bandPoints: qual.bandPoints,
    });
    return finishCompare(qual, rowValue(op, ctx), '%');
}

// CENTRAL_LAMBDA: argwave on the requested channel, through the optimizer's
// argwave operand, so the check reads as the MXWT/MNW* row Generate MF writes
// whenever the two search at the same step.
function evalCentralLambda(qual, design, ctx, options) {
    const ch  = channelFromKind(qual.kind) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const op = makeOperand({
        type: argwaveType(qual.direction, ch, pol),
        lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
        aoi: qual.aoi, pol, target: qual.target, weight: 1, ...flagOf(options),
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
// `options.flag` sets the step a peak is searched for at, as a merit row's
// flag does; without one the default 1 nm.
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
