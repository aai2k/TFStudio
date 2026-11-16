/**
 * Derivatives in the chromaticity x, y of what locus.js reads off a colour:
 * the dominant and complementary wavelengths and the excitation purity, and
 * the correlated colour temperature and Duv. Each is the function locus.js
 * computes, differentiated, so a merit row reading one has its exact slope.
 */

import { uv1960 } from './colorSpaces.js';
import { locusRayHit, spectralLocusXy, xyToXYZ } from './locus.js';
import { correlatedColorTemperature, planckianUvDerivatives } from './cct.js';

// ∂λ and ∂s, in vx and vy, at the crossing `hit` of the ray W + s·v with
// segment hit.i of `loc`, v = [vx, vy]. The crossing solves W + s·v = A + u·e
// for s and u, e the segment from A to B: s = K / D and u = M / D, with
// D = v × e, K = (A − W) × e and M = (A − W) × v, and λ = λ_A + u·(λ_B − λ_A).
function hitSlopes(loc, white, [vx, vy], hit) {
  const a = loc[hit.i], b = loc[hit.i + 1];
  const ex = b.x - a.x, ey = b.y - a.y;
  const px = a.x - white.x, py = a.y - white.y;
  const D = vx * ey - vy * ex;
  const K = px * ey - py * ex;
  const M = px * vy - py * vx;
  const D2 = D * D;
  const span = b.lam - a.lam;
  return {
    dLam: [span * (-py * D - M * ey) / D2, span * (px * D + M * ex) / D2],
    ds: [-K * ey / D2, K * ex / D2],
  };
}

// The purity is 1/s, s the ray parameter at the hit (|WS| over |W·hit|).
const puritySlope = (s, ds) => [-ds[0] / (s * s), -ds[1] / (s * s)];

// The slope of a purple's purity, measured to the purple line along v.
function purpleLinePurity(loc, white, v) {
  const ends = [loc[0], loc[loc.length - 1]];
  const purple = locusRayHit(ends, white.x, white.y, v[0], v[1]);
  return purple ? puritySlope(purple.s, hitSlopes(ends, white, v, purple).ds) : [0, 0];
}

/**
 * The derivatives in x and y of what dominantWavelength gives at `xy`, each a
 * pair [∂/∂x, ∂/∂y]: `dom`, `comp` and `purity`. The white is fixed, so the ray
 * turns with the sample, and each wavelength moves along the locus segment it
 * crosses. The pair is [0, 0] for a wavelength the colour has none of: `dom`
 * of a purple, `comp` of any other colour, everything at the white.
 */
export function dominantWavelengthSlopes(xy, white, observer) {
  const loc = spectralLocusXy(observer);
  const v = [xy.x - white.x, xy.y - white.y];
  const none = { dom: [0, 0], comp: [0, 0], purity: [0, 0] };
  if (Math.hypot(v[0], v[1]) < 1e-9) return none;
  const fwd = locusRayHit(loc, white.x, white.y, v[0], v[1]);
  if (fwd) {
    const { dLam, ds } = hitSlopes(loc, white, v, fwd);
    return { ...none, dom: dLam, purity: puritySlope(fwd.s, ds) };
  }
  const back = [-v[0], -v[1]];
  const bwd = locusRayHit(loc, white.x, white.y, back[0], back[1]);
  if (!bwd) return none;
  // The complementary ray runs along −v, so its slope in v changes sign.
  const dLam = hitSlopes(loc, white, back, bwd).dLam;
  return { ...none, comp: [-dLam[0], -dLam[1]], purity: purpleLinePurity(loc, white, v) };
}

// [∂/∂x, ∂/∂y] of CIE 1960 u and v at the chromaticity xy: u = 4x / q and
// v = 6y / q, q = 12y − 2x + 3.
function uvSlopes({ x, y }) {
  const q = 12 * y - 2 * x + 3;
  const q2 = q * q;
  return { u: [(4 * q + 8 * x) / q2, -48 * x / q2], v: [12 * y / q2, (6 * q - 72 * y) / q2] };
}

/**
 * What correlatedColorTemperature gives at `xy`, with the derivatives in x and
 * y of its CCT and Duv, each a pair [∂/∂x, ∂/∂y]: `{ cct, duv, dCct, dDuv }`.
 * CCT is the T at which the blackbody p(T) is nearest the colour s in CIE 1960
 * u, v, so F = (p − s)·p′ = 0 there, and implicit differentiation gives
 * ∂T/∂s = p′ / F_T, F_T = |p′|² + (p − s)·p″. Duv is ±|s − p(T)| at that T,
 * and s − p(T) lies along the normal to the locus there. As T is where the
 * distance is least, its own motion adds nothing, so ∂Duv/∂s is that unit
 * normal, turned towards +v; this holds on the locus too, where s − p(T) has
 * no direction of its own. A pair is [0, 0] where its value is NaN.
 */
export function correlatedColorTemperatureSlopes(xy, observer) {
  const { cct, duv, locusT } = correlatedColorTemperature(xy, observer);
  if (!Number.isFinite(duv)) return { cct, duv, dCct: [0, 0], dDuv: [0, 0] };
  const sample = uv1960(xyToXYZ(xy));
  const { u, v } = planckianUvDerivatives(locusT, observer);
  const du = sample.u - u.f, dv = sample.v - v.f;
  const dSample = uvSlopes(xy);
  const FT = u.d1 * u.d1 + v.d1 * v.d1 - du * u.d2 - dv * v.d2;
  const dCct = Number.isFinite(cct) && FT > 0
    ? [0, 1].map(j => (u.d1 * dSample.u[j] + v.d1 * dSample.v[j]) / FT)
    : [0, 0];
  const speed = Math.hypot(u.d1, v.d1);
  const turn = u.d1 >= 0 ? 1 : -1;
  const nu = -turn * v.d1 / speed, nv = turn * u.d1 / speed;
  const dDuv = [0, 1].map(j => nu * dSample.u[j] + nv * dSample.v[j]);
  return { cct, duv, dCct, dDuv };
}
