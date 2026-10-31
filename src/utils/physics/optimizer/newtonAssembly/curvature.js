/**
 * The second-order curvature term S of the Newton system.
 *
 * `addCurvature` adds S to the upper triangle of H. Each enabled, evaluated
 * operand with curvature is a term over its sample wavelengths. Terms at one
 * angle that read common wavelengths share a grid, which is walked once
 * (gridWalk.js): each wavelength's kernel packages are computed once, read by
 * every term there and dropped, so a step keeps no package past its wavelength
 * however fine the rows' Step. A term that sums its samples adds the sum to H
 * in operand order; a range target adds each sample to H as the walk reaches
 * it, which puts it ahead of the earlier rows on its grid in the order of the
 * sum into H. A range target shares a grid with earlier rows only when it reads
 * a wavelength in common with one of them.
 * `_operandSupportsFullNewton` reports whether an operand is eligible for the
 * full analytic Newton Hessian at all.
 */

import { operandResidualScale } from '../evalCore.js';
import { resolveSourceSpec, resolveDetectorSpec } from '../../spectralWeightings.js';
import {
    isMath, isArgwave, isEField, isEllipsometry, isMeasuredCurve, polFromType,
    isManufacturability, isMinmax, isRangeTarget, isIntegral,
} from '../operandModel.js';
import { charOf, operandSampleLambdas, isRangeAvg, bandQuadratureWeights } from '../sampling.js';
import { _addS } from './gaussNewton.js';
import { shareGrids, walk } from './gridWalk.js';

// Add S over the enabled, evaluated operands to the upper triangle of H.
// `hc = { r0, nFree, at }`: r0 the residuals, aligned with the Jacobian rows,
// and `at(λ, aoi)(pol, ch)` the sampler of makeHessianSampler.
export function addCurvature(H, operands, comp, hc) {
    const terms = _curvTerms(operands, comp, hc);
    shareGrids(terms);
    for (const term of terms) {
        if (!term.grid.walked) walk(term.grid, H, hc.at);
        term.flush(H);
    }
}

// The terms of the operands with curvature, in operand order. `rp` is an
// operand's first residual row.
function _curvTerms(operands, comp, hc) {
    const terms = [];
    let rp = 0;
    for (let i = 0; i < operands.length; i++) {
        const op = operands[i];
        if (!op.enabled || comp[i] == null) continue;
        const { rows, term } = _curvOperand(op, rp, hc);
        rp += rows;
        if (!term) continue;
        term.pol = polFromType(op.type) ?? op.pol;
        term.char = charOf(op.type);
        term.aoi = op.aoi;
        terms.push(term);
    }
    return terms;
}

// One enabled, evaluated operand's curvature term, or null, and the number of
// residual rows it occupies. The manufacturability rows contribute zero
// curvature: the layer bounds are piecewise linear in the thicknesses, and the
// total thickness and the film force are linear outright.
//
// A worst-case min/max row (TMN..AMX) is given zero curvature as well, which
// leaves it the Gauss-Newton term JᵀJ. It is not piecewise linear: at the
// extremum λ* its residual is ±√w·(C(λ*) − target), and ∂²C(λ*) at fixed λ* is
// exact there. But λ* moves with the thicknesses, so the band extremum is the
// upper (or lower) envelope of C over the band, whose curvature the fixed-λ*
// term misstates, and it has a kink wherever two peaks tie.
// Measured on five min/max merit functions, adding ±√w·r·∂²C(λ*) to S left
// Newton and SQP at a worse merit in three and a better one in two; the
// envelope correction −C_dλ·C_λd/C_λλ did no better.
function _curvOperand(op, rp, hc) {
    if (isManufacturability(op.type) || isMinmax(op.type)) return { rows: 1, term: null };
    if (isRangeTarget(op.type)) {
        const term = _rangeTargetTerm(op, rp, hc);
        return { rows: term.lams.length, term };
    }
    if (isIntegral(op.type)) return { rows: 1, term: _integralTerm(op, rp, hc) };
    if (isRangeAvg(op.type)) return { rows: 1, term: _rangeAvgTerm(op, rp, hc) };
    return { rows: 1, term: _singleTerm(op, rp, hc) };
}

// Single-λ optical: residual = sw·(val − target), ∂²r = sw·∂²comp.
function _singleTerm(op, rp, { r0, nFree }) {
    let d2 = null;
    return {
        lams: [op.lambdaStart],
        reads: () => true,
        add: (s, smpD2) => { d2 = smpD2; },
        flush: H => { _addS(H, nFree, r0[rp] * Math.sqrt(op.weight), d2); d2 = null; },
    };
}

// Range-target (TGT/RGT/AGT), one residual per sample rₛ = √(w·qₛ)·devₛ at rows
// rp … rp+n−1 (qₛ the band grid's trapezoid weights): ∂²rₛ = √(w·qₛ)·∂²valₛ, so
// S gains rₛ·√(w·qₛ)·∂²valₛ per sample, added to H as each sample is read.
function _rangeTargetTerm(op, rp, { r0, nFree }) {
    const lams = operandSampleLambdas(op);
    const q = bandQuadratureWeights(lams.length);
    return {
        lams,
        addsEachSample: true,
        reads: () => true,
        add: (s, d2, H) => _addS(H, nFree, r0[rp + s] * Math.sqrt(op.weight * q[s]), d2),
        flush: () => {},
    };
}

// Weighted-integral: ∂²r = sw·Σ wᵢ·∂²comp ; S = r·∂²r, with wᵢ = qᵢ·S(λᵢ)·D(λᵢ)
// normalized as in the evaluator. A sample of no weight is not read.
function _integralTerm(op, rp, hc) {
    const lams = operandSampleLambdas(op);
    const n = lams.length;
    const q = bandQuadratureWeights(n);
    const S = resolveSourceSpec(op.source || { id: 'E' });
    const D = resolveDetectorSpec(op.detector || { id: 'flat' });
    let den = 0; const wts = new Array(n);
    for (let s = 0; s < n; s++) { const w = q[s] * S.sampler(lams[s]) * D.sampler(lams[s]); wts[s] = w; den += w; }
    if (den <= 1e-30) return null;
    const invDen = 1 / den;
    for (let s = 0; s < n; s++) wts[s] *= invDen;
    return _sumTerm(lams, wts, hc.r0[rp] * Math.sqrt(op.weight), hc.nFree);
}

// Band mean (TAV/RAV/AAV): ∂²r = sw·Σ qₛ·∂²comp, qₛ the band grid's trapezoid weights.
function _rangeAvgTerm(op, rp, { r0, nFree }) {
    const lams = operandSampleLambdas(op);
    return _sumTerm(lams, bandQuadratureWeights(lams.length), r0[rp] * Math.sqrt(op.weight), nFree);
}

// A row whose ∂²r is the weighted sum Σ wₛ·∂²compₛ over its samples, added to H
// as coef·Σ. A sample whose weight is not above zero is not read. The sum is
// held from the row's first sample to its turn only.
function _sumTerm(lams, weights, coef, nFree) {
    const zeros = () => Array.from({ length: nFree }, () => new Array(nFree).fill(0));
    let acc = null;
    return {
        lams,
        reads: s => weights[s] > 0,
        add: (s, d2) => {
            acc ??= zeros();
            const w = weights[s];
            for (let a = 0; a < nFree; a++) for (let b = a; b < nFree; b++) acc[a][b] += w * d2[a][b];
        },
        flush: H => { _addS(H, nFree, coef, acc ?? zeros()); acc = null; },
    };
}

// Whether one operand is compatible with the FULL analytic Newton Hessian.
// Math/argwave curvature isn't worked out, and the curvature terms are not
// divided by σ, so a row with σ ≠ 1 would not match its Jacobian row. Ellipsometry and
// field operands have no second derivative worked out either, and tan Ψ, cos Δ
// and the field peak sit at σ = 1, so they are named here. TT and STR are not:
// both are linear in the thicknesses, so their curvature is exactly zero and
// the Newton system simply skips them.
export function _operandSupportsFullNewton(op) {
    if (!op.enabled) return true;
    if (NO_ANALYTIC_CURVATURE.some(test => test(op.type))) return false;
    return operandResidualScale(op) === 1;
}

// A curve block reaching the engine whole has its level free, and the curvature
// of its shared level is not worked out.
const NO_ANALYTIC_CURVATURE = [isMath, isArgwave, isEllipsometry, isEField, isMeasuredCurve];
