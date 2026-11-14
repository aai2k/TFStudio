/**
 * Derivatives in the chromaticity x, y of what locus.js reads off a colour:
 * the dominant and complementary wavelengths and the excitation purity, and
 * the correlated colour temperature and Duv. Each is the function locus.js
 * computes, differentiated, so a merit row reading one has its exact slope.
 */

import { cmfTable, planck, planckSlope } from './tables.js';
import { uv1960 } from './colorSpaces.js';
import {
  correlatedColorTemperature, locusRayHit, planckianXyz, spectralLocusXy, xyToXYZ,
} from './locus.js';

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

// ∂u/∂T and ∂v/∂T of the blackbody at T in CIE 1960 u, v: u = 4X/D and
// v = 6Y/D, D = X + 15Y + 3Z, X, Y and Z summed as planckianXyz sums them.
function planckianUvSlope(T, observer) {
  let X = 0, Y = 0, Z = 0, dX = 0, dY = 0, dZ = 0;
  for (const [lam, xb, yb, zb] of cmfTable(observer)) {
    const P = planck(lam, T), dP = planckSlope(lam, T);
    X += P * xb; Y += P * yb; Z += P * zb;
    dX += dP * xb; dY += dP * yb; dZ += dP * zb;
  }
  const D = X + 15 * Y + 3 * Z, dD = dX + 15 * dY + 3 * dZ;
  return { u: 4 * (dX * D - X * dD) / (D * D), v: 6 * (dY * D - Y * dD) / (D * D) };
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
 * CCT is McCamy's cubic in n = (x − 0.3320) / (y − 0.1858) (McCamy, Color
 * Res. Appl. 17, 142 (1992)). Duv is the distance in CIE 1960 u, v from the
 * colour to the nearest blackbody of the 5 K search, so it moves along the line
 * from that blackbody to the colour, the normal to the locus where the search
 * finds the foot of it. The search runs from McCamy's estimate less 400 K, or
 * from 1000 K, and where it runs from the estimate its blackbodies move with
 * the colour as the estimate does, which adds their own motion along the
 * locus. A pair is [0, 0] where its value is NaN.
 */
export function correlatedColorTemperatureSlopes(xy, observer) {
  const { cct, duv, locusT } = correlatedColorTemperature(xy, observer);
  const denom = xy.y - 0.1858;
  const n = (xy.x - 0.3320) / denom;
  const raw = -449 * n * n * n + 3525 * n * n - 6823.3 * n + 5520.33;
  const dT = -3 * 449 * n * n + 2 * 3525 * n - 6823.3;
  const dRaw = [dT / denom, -dT * n / denom];
  const dCct = Number.isFinite(cct) ? dRaw : [0, 0];
  if (!Number.isFinite(duv)) return { cct, duv, dCct, dDuv: [0, 0] };
  const sample = uv1960(xyToXYZ(xy));
  const pl = uv1960(planckianXyz(locusT, observer));
  const du = sample.u - pl.u, dv = sample.v - pl.v;
  const dist = Math.hypot(du, dv);
  const dSample = uvSlopes(xy);
  const moves = raw - 400 > 1000 ? dRaw : [0, 0];
  const dLocus = planckianUvSlope(locusT, observer);
  const k = dist > 0 ? (sample.v > pl.v ? 1 : -1) / dist : 0;
  const dDuv = [0, 1].map(j => k * (du * (dSample.u[j] - dLocus.u * moves[j]) + dv * (dSample.v[j] - dLocus.v * moves[j])));
  return { cct, duv, dCct, dDuv };
}
