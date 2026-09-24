/**
 * Operand evaluators that read the spectrum through `tmmProp`, plus the two
 * that read the thickness vector directly: total thickness, layer-thickness
 * constraints, math rows, argmax wavelength, weighted integrals, worst-case
 * extrema, continuous range targets and band averages.
 */

import { resolveSourceSpec, resolveDetectorSpec } from '../../../spectralWeightings.js';
import { stressForceNm } from '../../../stress/stackForce.js';
import { isMinType, isArgwaveMin, argwaveOpticalChar, argwavePolCode, polFromType } from '../../operandModel.js';
import { isRangeAvg, charOf, operandSampleLambdas, bandQuadratureWeights } from '../../sampling.js';
import { tmmProp } from '../tmmEval.js';
import { _assertMeasurementSide } from './errors.js';

// 3-point parabolic interpolation around a discrete extremum at index i in a
// uniformly-spaced sample (lams[i] linear in i). Returns the sub-sample λ and
// the interpolated value. Falls back to the discrete extremum when the parabola
// is degenerate or the peak sits on a boundary.
function parabolicPeakLambda(lams, vals, i) {
    const n = lams.length;
    if (n < 3 || i <= 0 || i >= n - 1) return { lam: lams[i], val: vals[i] };
    const y0 = vals[i - 1], y1 = vals[i], y2 = vals[i + 1];
    const denom = (y0 - 2 * y1 + y2);
    if (Math.abs(denom) < 1e-15) return { lam: lams[i], val: vals[i] };
    // Δ ∈ (−0.5, 0.5) is the sub-sample offset; standard parabolic-peak formula.
    const delta = 0.5 * (y0 - y2) / denom;
    const dLam  = lams[i + 1] - lams[i];   // uniform step assumed
    const lamP  = lams[i] + delta * dLam;
    const valP  = y1 - 0.25 * (y0 - y2) * delta;
    return { lam: lamP, val: valP };
}

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
// 1-based layer-index range. The range clamps to the actual layer count, so a
// generator can emit an end far above it to mean "every current and future
// layer" (see DEFAULT_CONSTRAINT_LAST_LAYER).
// In both_independent mode ctx.fullThicks spans front+back so constraints can
// reach either stack; otherwise it equals frontThicks.
export function _evalConstraint(op, ctx) {
    const all = ctx.fullThicks || ctx.frontThicks || [];
    const lo = Math.max(0, Math.round(op.lambdaStart) - 1);
    const hi = Math.min(all.length - 1, Math.round(op.lambdaEnd) - 1);
    if (lo > hi) return 0;
    if (op.type === 'MNT') {
        let v = Infinity;
        for (let i = lo; i <= hi; i++) v = Math.min(v, all[i] || 0);
        return isFinite(v) ? v : 0;
    }
    let v = 0;
    for (let i = lo; i <= hi; i++) v = Math.max(v, all[i] || 0);
    return v;
}

// Argmax/argmin-wavelength (MXW*/MNW*): sample C(λ) over [λStart,λEnd] on a
// uniform grid, find the discrete extremum, refine with a 3-pt parabolic fit.
// Returns λ in nm.
export function _evalArgwave(op, ctx) {
    const char = argwaveOpticalChar(op.type);                     // 'T' | 'R' | 'A'
    const pol  = argwavePolCode(op.type) ?? op.pol ?? 'avg';
    const lams = operandSampleLambdas(op);
    const n    = lams.length;
    if (n === 0) return op.lambdaStart;
    const vals = new Array(n);
    for (let i = 0; i < n; i++) {
        vals[i] = tmmProp(lams[i], op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats);
    }
    const minMode = isArgwaveMin(op.type);
    let bestI = 0, bestV = vals[0];
    for (let i = 1; i < n; i++) {
        if (minMode ? vals[i] < bestV : vals[i] > bestV) { bestV = vals[i]; bestI = i; }
    }
    return parabolicPeakLambda(lams, vals, bestI).lam;
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

// Worst-case minmax operand (TMN/RMN/AMN/TMX/RMX/AMX): the TRUE extremum of C(λ)
// over the band (the real physical worst-case T/R/A — never >100%, never <0%).
// The earlier log-sum-exp "soft" surrogate was abandoned: its un-normalized form
// inflated a flat 99% T to >100% ("TMX = 108.9%"), and any smoothing biases the
// value away from the real extremum. We report the honest extremum here (so the
// MFE "Current" cell and the Specification window agree exactly) and give the
// optimizer a single-argmax SUBGRADIENT in _analyticJacobian — the same
// hard-extremum approach used for MNT/MXT. Sampled on the dense argwave grid
// (≈1 nm) so a narrow peak / dip can't slip between samples. The grid
// wavelength of the extremum, nm, is kept on the context: the Jacobian and the
// Newton curvature differentiate C there and nowhere else.
export function _evalMinmax(op, ctx) {
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams    = operandSampleLambdas(op);
    const n       = lams.length;
    const minMode = isMinType(op.type);
    let ext = minMode ? Infinity : -Infinity;
    let at = null;
    for (let i = 0; i < n; i++) {
        const v = tmmProp(lams[i], op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats);
        if (minMode ? v < ext : v > ext) { ext = v; at = lams[i]; }
    }
    ctx._extremumLambdas?.set(op, at);
    return Number.isFinite(ext) ? ext : 0;
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
