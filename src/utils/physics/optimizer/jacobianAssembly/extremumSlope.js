/**
 * Thickness derivatives of a band-extremum row at the extremum λ* its
 * evaluation found (evalCore/bandExtremum.js), from the analytic dC/dd at λ*
 * and λ* ± ε. The differences in λ are taken on g = ±1/P, the function the
 * search minimised (P = T, 1 − R or A), which is close to a parabola in λ near
 * a resonance:
 *
 *  - worst case: the derivative of the extremum value is ∂C/∂d at the
 *    stationary point (Danskin, The Theory of Max-Min, 1967). It is taken at
 *    the Newton-corrected stationary point, g_d − g_λd·g_λ/g_λλ, so a λ* a hair
 *    off a narrow peak, where ∂C/∂d swings with λ, does not carry g_λd·Δλ into
 *    the row.
 *  - MXW* / MNW*: the shift of λ* with a thickness d is −g_λd/g_λλ, the
 *    implicit-function derivative of g_λ(λ*, d) = 0.
 *
 * At a band end λ* stays where it is: the worst case is ∂C/∂d there and the
 * wavelength does not move. Under a cone, λ* ± ε average over the rays settled
 * at λ*, so the differences see one set of rays.
 */

import { extremumRowSpec } from '../extremumGrid.js';
import { extremumSearchStep } from '../evalCore/bandExtremum.js';
import { shareConeNodes } from '../evalCore/coneNodeCount.js';
import { tmmProp } from '../evalCore/tmmEval.js';

// g = s/P(C), s = +1 for a row that looks for a peak and −1 for one that looks
// for a dip, and dg/dC = −s·P'(C)/P².
function gFunctions(spec) {
    const s = spec.peak ? 1 : -1;
    const dP = spec.char === 'R' ? -1 : 1;
    const P = C => Math.max(spec.char === 'R' ? 1 - C : C, 1e-300);
    return { g: C => s / P(C), dgdC: C => -s * dP / (P(C) * P(C)) };
}

// Smallest step, nm, of the width probe below. A hundredth of a 0.001 nm
// search step would be 1e-5 nm, at which the second difference of a feature
// hundreds of nanometres wide is lost to rounding.
const MIN_PROBE_NM = 1e-3;

// The λ step of the differences: a thousandth of the peak's width
// w ≈ √(8g/g''), from g = g*(1 + 4Δ²/w²) near a resonance, so the cubic part
// of g, which sets in on the scale of w, stays out of them, and a broad
// feature is not differenced finer than rounding allows. The width comes from
// a probe a hundredth of the search step wide, never under MIN_PROBE_NM; where
// the probe finds no curvature its own step is used.
function differenceStep(op, ctx, spec, lambda, g0) {
    const { g } = gFunctions(spec);
    const e0 = Math.max(1e-2 * extremumSearchStep(op, ctx), MIN_PROBE_NM);
    shareConeNodes(ctx, op.aoi, lambda, [lambda - e0, lambda + e0]);
    const C = lam => tmmProp(lam, op.aoi, spec.pol, spec.char, ctx, ctx.frontThicks, ctx.frontMats);
    const gpp = (g(C(lambda + e0)) - 2 * g0 + g(C(lambda - e0))) / (e0 * e0);
    const width = gpp > 0 ? Math.sqrt(8 * Math.abs(g0) / gpp) : Infinity;
    return Number.isFinite(width) ? 1e-3 * width : e0;
}

// dC/dd for every thickness variable and C, at one wavelength.
function pointAt(op, spec, jc, lam) {
    return { d: jc.propDeriv(lam, spec.pol, spec.char, op.aoi), C: jc.propValue(lam, spec.pol, spec.char, op.aoi) };
}

// g and its λ derivatives at λ*, from dC/dd and C at λ* and λ* ± e.
function gDifferences(spec, Z, P, M, e) {
    const { g, dgdC } = gFunctions(spec);
    const gd = X => X.d.map(v => dgdC(X.C) * v);
    const gdP = gd(P), gdM = gd(M);
    return {
        gl: (g(P.C) - g(M.C)) / (2 * e),
        gll: (g(P.C) - 2 * g(Z.C) + g(M.C)) / (e * e),
        gld: gdP.map((v, k) => (v - gdM[k]) / (2 * e)),
        gd0: gd(Z),
        dgdC0: dgdC(Z.C),
    };
}

/**
 * The slope of a band-extremum row at the extremum λ* (nm) its evaluation
 * found: { C, dC } for a worst-case row, C(λ*) and the derivative of the
 * extremum value in every thickness variable; { dLambda } for MXW* / MNW*,
 * the derivative of λ* in each, or null where λ* does not move (a band end)
 * or the peak is flat to rounding at λ*, so its wavelength has no slope to
 * take. Away from those the worst case is taken at the Newton-corrected
 * point. `jc` is the Jacobian context (propDeriv, propValue, ctx).
 */
export function extremumSlope(op, lambda, jc) {
    const spec = extremumRowSpec(op);
    const atEnd = lambda === Math.min(op.lambdaStart, op.lambdaEnd) || lambda === Math.max(op.lambdaStart, op.lambdaEnd);
    const Z = pointAt(op, spec, jc, lambda);
    const plain = spec.argwave ? { dLambda: null } : { C: Z.C, dC: Z.d };
    if (atEnd) return plain;
    const e = differenceStep(op, jc.ctx, spec, lambda, gFunctions(spec).g(Z.C));
    shareConeNodes(jc.ctx, op.aoi, lambda, [lambda - e, lambda + e]);
    const s = gDifferences(spec, Z, pointAt(op, spec, jc, lambda + e), pointAt(op, spec, jc, lambda - e), e);
    if (!(s.gll > 0)) return plain;
    if (spec.argwave) return { dLambda: s.gld.map(v => -v / s.gll) };
    return { C: Z.C, dC: s.gd0.map((v, k) => (v - s.gld[k] * s.gl / s.gll) / s.dgdC0) };
}
