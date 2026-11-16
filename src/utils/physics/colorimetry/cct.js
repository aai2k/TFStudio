/**
 * Correlated colour temperature and Duv: the Planckian radiator nearest a
 * colour in CIE 1960 u, v (CIE 15:2018 §9.5; Y. Ohno, LEUKOS 10, 47 (2014)).
 */

import { PLANCK_C2, cmfTable, planck } from './tables.js';
import { uv1960 } from './colorSpaces.js';
import { planckianXyz, xyToXYZ } from './locus.js';

// The locus is searched from 1000 K to 10⁶ K, on a grid of 1 mired (10⁶/T).
const MIRED_MIN = 1, MIRED_MAX = 1000;
const locusGrids = new Map();

// Planckian chromaticities in CIE 1960 u, v at every whole mired of the range,
// kept per colour-matching table.
function locusGrid(observer) {
  const key = cmfTable(observer);
  let grid = locusGrids.get(key);
  if (!grid) {
    grid = [];
    for (let m = MIRED_MIN; m <= MIRED_MAX; m++) grid.push(uv1960(planckianXyz(1e6 / m, observer)));
    locusGrids.set(key, grid);
  }
  return grid;
}

/**
 * u and v of the blackbody at T in CIE 1960 u, v, each with its first and
 * second derivative in T, `{ f, d1, d2 }`: u = 4X/D and v = 6Y/D,
 * D = X + 15Y + 3Z, X, Y and Z summed as planckianXyz sums them. With
 * a = c2/(λT), Planck's law gives ∂P/∂T = P·h/T, h = a·eᵃ/(eᵃ − 1), and as
 * ∂h/∂T = −(a/T)·h′(a), h′(a) = eᵃ·(eᵃ − 1 − a)/(eᵃ − 1)²,
 * ∂²P/∂T² = P·(h² − h − a·h′(a))/T².
 */
export function planckianUvDerivatives(T, observer) {
  let X = 0, Y = 0, Z = 0, dX = 0, dY = 0, dZ = 0, d2X = 0, d2Y = 0, d2Z = 0;
  for (const [lam, xb, yb, zb] of cmfTable(observer)) {
    const a = PLANCK_C2 / (lam * T);
    const e = Math.exp(a);
    const P = planck(lam, T);
    const h = a * e / (e - 1);
    const hPrime = e * (e - 1 - a) / ((e - 1) * (e - 1));
    const dP = P * h / T;
    const d2P = P * (h * h - h - a * hPrime) / (T * T);
    X += P * xb; Y += P * yb; Z += P * zb;
    dX += dP * xb; dY += dP * yb; dZ += dP * zb;
    d2X += d2P * xb; d2Y += d2P * yb; d2Z += d2P * zb;
  }
  const D = X + 15 * Y + 3 * Z, dD = dX + 15 * dY + 3 * dZ, d2D = d2X + 15 * d2Y + 3 * d2Z;
  // f = kN/D: f′ = k(N′D − ND′)/D², f″ = k[(N″D − ND″)/D² − 2D′(N′D − ND′)/D³].
  const ratio = (k, N, dN, d2N) => ({
    f: k * N / D,
    d1: k * (dN * D - N * dD) / (D * D),
    d2: k * ((d2N * D - N * d2D) / (D * D) - 2 * dD * (dN * D - N * dD) / (D * D * D)),
  });
  return { u: ratio(4, X, dX, d2X), v: ratio(6, Y, dY, d2Y) };
}

// Index on the grid of the point nearest `sample`.
function nearestOnGrid(grid, sample) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < grid.length; i++) {
    const d = (grid[i].u - sample.u) ** 2 + (grid[i].v - sample.v) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// F(T) = (p(T) − s)·p′(T), half the slope in T of the squared distance from
// the blackbody p(T) to the colour s, and its own slope F_T.
function distanceSlope(sample, observer, T) {
  const { u, v } = planckianUvDerivatives(T, observer);
  const du = u.f - sample.u, dv = v.f - sample.v;
  return {
    F: du * u.d1 + dv * v.d1,
    FT: u.d1 * u.d1 + v.d1 * v.d1 + du * u.d2 + dv * v.d2,
  };
}

// The T between `lo` and `hi` where F(T) = 0, by Newton's method on F,
// falling back to bisection on a step that leaves the bracket.
function nearestTemperature(sample, observer, lo, hi) {
  let T = (lo + hi) / 2;
  for (let iter = 0; iter < 60; iter++) {
    const { F, FT } = distanceSlope(sample, observer, T);
    if (F > 0) hi = T; else lo = T;
    const step = FT > 0 ? F / FT : NaN;
    if (Math.abs(step) <= 1e-13 * T || hi - lo <= 1e-13 * T) break;
    let next = T - step;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    T = next;
  }
  return T;
}

// The bracket around grid point `best`: the neighbouring mireds, or at an end
// of the grid the one neighbour and the end itself. T falls as the mired
// rises. Null when the distance still falls past the end, so the nearest
// blackbody lies outside 1000 K to 10⁶ K.
function bracketAround(best, last, sample, observer) {
  const tOf = i => 1e6 / (MIRED_MIN + i);
  if (best === 0 && distanceSlope(sample, observer, tOf(0)).F < 0) return null;
  if (best === last && distanceSlope(sample, observer, tOf(last)).F > 0) return null;
  return { lo: tOf(Math.min(best + 1, last)), hi: tOf(Math.max(best - 1, 0)) };
}

/**
 * Correlated colour temperature and Duv. CCT is the temperature of the
 * Planckian radiator nearest the colour in CIE 1960 u, v; Duv is the signed
 * distance to that radiator, positive above the locus. The nearest whole mired
 * is found on the grid, then nearestTemperature finds the T between its
 * neighbours. CCT and Duv are both NaN when the nearest radiator lies outside
 * 1000 K to 10⁶ K. CCT alone is NaN when |Duv| > 0.05, where Ohno puts the
 * limit of a meaningful CCT. `locusT` is the nearest radiator's temperature, K.
 */
export function correlatedColorTemperature(xy, observer) {
  const none = { cct: NaN, duv: NaN, locusT: NaN };
  if (!(xy.y > 0)) return none;
  const sample = uv1960(xyToXYZ(xy));
  const grid = locusGrid(observer);
  const bracket = bracketAround(nearestOnGrid(grid, sample), grid.length - 1, sample, observer);
  if (!bracket) return none;
  const T = nearestTemperature(sample, observer, bracket.lo, bracket.hi);
  const pl = uv1960(planckianXyz(T, observer));
  const duv = (sample.v > pl.v ? 1 : -1) * Math.hypot(pl.u - sample.u, pl.v - sample.v);
  return { cct: Math.abs(duv) > 0.05 ? NaN : T, duv, locusT: T };
}
