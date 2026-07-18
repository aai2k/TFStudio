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
 * { value, pass, deviation, displayValue, unit, summary } result.
 */

import { makeOperand, evaluateOperands, buildEvalContext, ARGWAVE_DEFAULT_POINTS } from '../../physics/optimizer.js';
import { channelFromKind, singleType, avgType, minmaxType, argwaveType } from './channelTypes.js';
import { finishCompare } from './format.js';
import { evalBandDerived } from './bandScan.js';

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
    const v = evaluateOperands([op], ctx)[0];
    return finishCompare(qual, v, '%');
}

function evalAvg(qual, design, ctx) {
    const ch  = channelFromKind(qual.kind) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const op = makeOperand({
        type: avgType(ch, pol),
        lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
        aoi: qual.aoi, pol, target: 0, weight: 1,
    });
    const v = evaluateOperands([op], ctx)[0];
    return finishCompare(qual, v, '%');
}

// MIN_MAX — true min/max of T/R/A over a band. The "T(λ) ≥ X across the band"
// / "R(λ) ≤ Y across the band" spec that appears on optical drawings.
// Evaluated through the SAME TMN/TMX/RMN/RMX/AMN/AMX operand the generated MF
// uses — which returns the true band extremum on the dense (≈1 nm) grid — so
// the Specification verdict and the MF operand's reported value are identical
// by construction (same code, same grid). No separate scan to drift out of sync.
function evalMinMax(qual, design, ctx) {
    const ch  = channelFromKind(qual.kind) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const op = makeOperand({
        type: minmaxType(ch, qual.direction),
        lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
        aoi: qual.aoi, pol, target: 0, weight: 1,
    });
    const v = evaluateOperands([op], ctx)[0];
    return finishCompare(qual, v, '%');
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
    const v = evaluateOperands([op], ctx)[0];
    return finishCompare(qual, v, '%');
}

// CENTRAL_LAMBDA — argwave on the requested channel. Delegates to the
// optimizer's argwave operand so this and the equivalent MXWT/MNW* operand
// placed in design.meritOperands evaluate through exactly the same code path
// with exactly the same λ grid.
function evalCentralLambda(qual, design, ctx) {
    const ch  = channelFromKind(qual.kind) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const op = makeOperand({
        type: argwaveType(qual.direction, ch, pol),
        lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
        aoi: qual.aoi, pol, target: qual.target, weight: 1,
        bandPoints: qual.bandPoints || ARGWAVE_DEFAULT_POINTS,
    });
    const lam = evaluateOperands([op], ctx)[0];
    return finishCompare(qual, lam, 'nm');
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
};

// Evaluate one qualifier against a design. Returns:
//   { value, value2, pass, deviation, displayValue, unit, summary }
// where value/value2 are the raw computed numbers, displayValue is a
// formatted string for the table, and unit is 'nm' or '%' or '' depending
// on kind.
export function evaluateQualifier(qual, design, resolveMat) {
    const ctx = buildEvalContext(design, resolveMat);
    const evaluator = KIND_EVALUATORS[qual.kind];
    if (!evaluator) {
        return {
            value: null, pass: false, deviation: null,
            displayValue: '—', unit: '',
            summary: `Unknown qualifier kind: ${qual.kind}`,
        };
    }
    return evaluator(qual, design, ctx);
}

// Evaluate every qualifier in a list against a design.
export function evaluateQualifiers(qualifiers, design, resolveMat) {
    return (qualifiers || []).map(q =>
        q.enabled
            ? evaluateQualifier(q, design, resolveMat)
            : { value: null, pass: null, deviation: null, displayValue: '—', unit: '', summary: 'disabled' }
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
