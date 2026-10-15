/**
 * Operand evaluators that read the spectrum through `tmmProp`, plus the two
 * that read the thickness vector directly: total thickness, layer-thickness
 * constraints, math rows, argmax wavelength, weighted integrals, worst-case
 * extrema, continuous range targets and band averages.
 */

import { resolveSourceSpec, resolveDetectorSpec } from '../../../spectralWeightings.js';
import { stressForceNm } from '../../../stress/stackForce.js';
import { polFromType, rowReading } from '../../operandModel.js';
import { isRangeAvg, charOf, operandSampleLambdas, bandQuadratureWeights } from '../../sampling.js';
import { contextConstraintIndices } from '../../constraintRange.js';
import { tmmProp } from '../tmmEval.js';
import { findBandExtremum } from '../bandExtremum.js';
import { _assertMeasurementSide } from './errors.js';

// Total thickness (TT): sum of all active layer thicknesses (nm). Uses the full
// optimization vector (front, or front+back in both_independent) so it tracks
// exactly the layers the optimizer can move — matching the constraints' domain.
export function _evalTotalThickness(op, ctx) {
    const all = ctx.fullThicks || ctx.frontThicks || [];
    let sum = 0;
    for (let i = 0; i < all.length; i++) sum += all[i] || 0;
    return sum;
}

// Film stress (STR): the net bending force per unit width the coatings put on
// the substrate, Σ σ_l d_l in N/m, the back coating subtracting. Which sides
// count follows the evaluation mode, so the number is the force the stress
// analysis window bends the substrate with. Per-layer stress comes off the
// material record; a material that states none contributes zero.
export function _evalStressForce(op, ctx) {
    return stressForceNm(ctx);
}

// MNT/MXT layer-thickness constraint: min (MNT) or max (MXT) thickness over a
// 1-based layer range, layer 1 on the substrate as in the Design Editor
// (constraintRange.js). The range clamps to the actual layer count, so a
// generator can emit an end far above it to mean "every current and future
// layer" (see DEFAULT_CONSTRAINT_LAST_LAYER).
// A range that holds no layer (a bare substrate, or a start past the last
// layer) has nothing to bound, so the row has no value and the merit skips it,
// as it skips a comment row. A value of 0 nm would score an MNT row as a layer
// its whole target too thin.
// In both_independent mode ctx.fullThicks spans front+back so constraints can
// reach either stack; otherwise it holds the optimized side.
export function _evalConstraint(op, ctx) {
    const all = ctx.fullThicks || ctx.frontThicks || [];
    const indices = contextConstraintIndices(op, ctx);
    if (!indices.length) return null;
    if (op.type === 'MNT') {
        let v = Infinity;
        for (const i of indices) v = Math.min(v, all[i] || 0);
        return isFinite(v) ? v : 0;
    }
    let v = 0;
    for (const i of indices) v = Math.max(v, all[i] || 0);
    return v;
}

// Argmax/argmin-wavelength (MXW*/MNW*): the wavelength, nm, of the band's true
// maximum or minimum (bandExtremum.js), or NaN when a sample has no value (a
// material with no index there): the extremum of a band with a hole in it is
// not known.
export function _evalArgwave(op, ctx) {
    return findBandExtremum(op, ctx).lambda;
}

// Weighted-integral operand (TIW/RIW/AIW):
//   C̄ = Σ w_i · C_i  /  Σ w_i      with w_i = q_i · S(λ_i) · D(λ_i)
// S(λ) and D(λ) come from the operand's source/detector specs (or default to
// E × flat = unity, i.e. a plain band average); q_i are the trapezoid weights
// of the band grid (bandQuadratureWeights), so the sums are ∫S·D·C dλ / ∫S·D dλ.
export function _evalIntegral(op, ctx) {
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n    = lams.length;
    const q    = bandQuadratureWeights(n);
    const S = resolveSourceSpec(op.source   || { id: 'E' });
    const D = resolveDetectorSpec(op.detector || { id: 'flat' });
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        const lam = lams[i];
        const w   = q[i] * S.sampler(lam) * D.sampler(lam);
        const v   = tmmProp(lam, op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats);
        num += w * v;
        den += w;
    }
    return den > 1e-30 ? num / den : 0;
}

// Worst-case minmax operand (TMN/RMN/AMN/TMX/RMX/AMX): the true extremum of C(λ)
// over the band (bandExtremum.js), so the merit table's Current cell and the
// Specification window read the same number. The wavelength of the extremum,
// nm, is kept on the context: the Jacobian and the Newton curvature
// differentiate C there and nowhere else. A sample with no value (a material
// with no index there) leaves the extremum unknown: NaN, which the merit
// function refuses, as it refuses a band average with such a sample. A dB or
// density row (TDBMN, TDBMX, RDBMX, ODMN) reports its own reading of the
// extremum of T or R; the conversion is monotone, so a lowest density is a
// highest T.
export function _evalMinmax(op, ctx) {
    const { lambda, C } = findBandExtremum(op, ctx);
    ctx._extremumLambdas?.set(op, Number.isFinite(lambda) ? lambda : null);
    return Number.isFinite(C) ? rowReading(op.type, C) : NaN;
}

// TDB: T in dB at op.lambdaStart.
export function _evalLogPoint(op, ctx) {
    _assertMeasurementSide(op, ctx);
    const pol = polFromType(op.type) ?? op.pol;
    return rowReading(op.type, tmmProp(op.lambdaStart, op.aoi, pol, charOf(op.type), ctx, ctx.frontThicks, ctx.frontMats));
}

// Continuous per-λ target (TGT/RGT/AGT): RMS deviation of the spectrum from the
// (flat or linearly ramped) target line across the band, √(Σ qᵢ devᵢ²) with the
// trapezoid weights qᵢ of the band grid. calcMF squares this directly (the
// per-sample residuals are already folded into the RMS). The per-sample
// deviations are kept on the context for the least-squares engine, which takes
// one residual per sample.
export function _evalRangeTarget(op, ctx) {
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n    = lams.length;
    const q    = bandQuadratureWeights(n);
    const t0   = op.target;
    const t1   = op.targetEnd != null ? op.targetEnd : op.target;
    const deviations = new Array(n);
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
        const f   = i / (n - 1);
        const ti  = t0 + (t1 - t0) * f;
        const d   = tmmProp(lams[i], op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats) - ti;
        deviations[i] = d;
        sumSq += q[i] * d * d;
    }
    ctx._sampleDeviations?.set(op, deviations);
    return Math.sqrt(sumSq);
}

// Band average (TAV/RAV/AAV = (1/Δλ)∫C dλ over the band, trapezoid rule on the
// band grid) or, for a plain single-wavelength operand, C at op.lambdaStart.
// The λ grid comes from the centralized helper so the worker pre-sampler
// cannot diverge from what we evaluate here → bit-identical.
export function _evalBandAvgOrSingle(op, ctx) {
    _assertMeasurementSide(op, ctx);
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    if (!isRangeAvg(op.type)) {
        return tmmProp(op.lambdaStart, op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats);
    }
    const lams = operandSampleLambdas(op);
    const q    = bandQuadratureWeights(lams.length);
    let sum = 0;
    for (let i = 0; i < lams.length; i++) {
        sum += q[i] * tmmProp(lams[i], op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats);
    }
    return sum;
}
