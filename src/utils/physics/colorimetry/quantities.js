/**
 * One colour quantity of a colour report at a time, with its derivative in the
 * tristimulus values X, Y and Z: what a colour row of the merit function reads
 * and the slope its Jacobian row chains through. The values come from the same
 * functions colorReport composes, so a row reads what the Color Evaluation
 * window shows; the slopes are those functions differentiated. Formulas: CIE
 * 15:2004 §8 for the colour spaces, Macleod, Thin-Film Optical Filters 5th ed.
 * §12.2 for the dominant wavelength and purity, CIE 15:2018 §9.5 for CCT. See
 * ../colorimetry.js for the provenance of each.
 */

import { chromaticityXy, uvPrime, uv1960, lab, luv, hunterLab } from './colorSpaces.js';
import { dominantWavelength } from './locus.js';
import { dominantWavelengthSlopes, correlatedColorTemperatureSlopes } from './locusSlopes.js';

/**
 * The quantities, in the order the Color list shows them. "u'" and "v'" are
 * CIE 1976 UCS, 'u' and 'v' CIE 1960 UCS; 'dominant' and 'complementary' are
 * wavelengths in nm, 'purity' the excitation purity as a fraction.
 */
export const COLOR_QUANTITIES = [
  'X', 'Y', 'Z', 'x', 'y', "u'", "v'", 'u', 'v',
  'L*', 'a*', 'b*', 'C*ab', 'hab',
  'u*', 'v*', 'C*uv', 'huv', 'suv',
  'Hunter L', 'Hunter a', 'Hunter b',
  'dominant', 'complementary', 'purity',
  'CCT', 'Duv',
];

/** The hue angles, degrees, whose miss is taken against the chroma beside them. */
export const HUE_CHROMA = { hab: 'C*ab', huv: 'C*uv' };

/**
 * The observer a quantity is computed with on a row set to `observer` ('2' or
 * '10'): CCT and Duv are defined on the CIE 1931 2° observer (CIE 15:2004) and
 * take it whatever the row says, as colorReport does.
 */
export function quantityObserver(quantity, observer) {
  return quantity === 'CCT' || quantity === 'Duv' ? '2' : observer;
}

const ZERO = [0, 0, 0];
const deg = 180 / Math.PI;
const add = (...terms) => [0, 1, 2].map(k => terms.reduce((sum, [c, v]) => sum + c * v[k], 0));

function chromaticity({ X, Y, Z }) {
  const S = X + Y + Z;
  const { x, y } = chromaticityXy({ X, Y, Z });
  if (S <= 0) return { x, y, dx: ZERO, dy: ZERO };
  const S2 = S * S;
  return { x, y, dx: [(Y + Z) / S2, -X / S2, -X / S2], dy: [-Y / S2, (X + Z) / S2, -Y / S2] };
}

function ucs({ X, Y, Z }) {
  const D = X + 15 * Y + 3 * Z;
  const { up, vp } = uvPrime({ X, Y, Z });
  if (D <= 0) return { up, vp, dUp: ZERO, dVp: ZERO };
  const D2 = D * D;
  return {
    up, vp,
    dUp: [4 / D - 4 * X / D2, -60 * X / D2, -12 * X / D2],
    dVp: [-9 * Y / D2, 9 / D - 135 * Y / D2, -27 * Y / D2],
  };
}

// C* and h° of the pair (a, b) with their slopes; both slopes 0 at C* = 0,
// where the hue has no direction.
function polar(a, b, da, db) {
  const C = Math.hypot(a, b);
  if (!(C > 0)) return { dC: ZERO, dh: ZERO };
  return { dC: add([a / C, da], [b / C, db]), dh: add([deg * a / (C * C), db], [-deg * b / (C * C), da]) };
}

// The slope of f in `lab`: the cube root above (6/29)³, a line below.
const labSlope = t => (t > 0.008856451679 ? 1 / (3 * Math.cbrt(t * t)) : 7.787037037);

function cielab(XYZ, white) {
  const v = lab(XYZ, white);
  const dfx = [labSlope(XYZ.X / white.X) / white.X, 0, 0];
  const dfy = [0, labSlope(XYZ.Y / white.Y) / white.Y, 0];
  const dfz = [0, 0, labSlope(XYZ.Z / white.Z) / white.Z];
  const dL = add([116, dfy]);
  const da = add([500, dfx], [-500, dfy]);
  const db = add([200, dfy], [-200, dfz]);
  return { v, dL, da, db, ...polar(v.a, v.b, da, db) };
}

function cieluv(XYZ, white) {
  const v = luv(XYZ, white);
  const yr = XYZ.Y / white.Y;
  const dL = [0, (yr > 0.008856451679 ? 116 / (3 * Math.cbrt(yr * yr)) : 903.296296) / white.Y, 0];
  const s = ucs(XYZ), sw = uvPrime(white);
  const du = add([13 * (s.up - sw.up), dL], [13 * v.L, s.dUp]);
  const dv = add([13 * (s.vp - sw.vp), dL], [13 * v.L, s.dVp]);
  const { dC, dh } = polar(v.u, v.v, du, dv);
  const ds = v.L > 0 ? add([1 / v.L, dC], [-v.C / (v.L * v.L), dL]) : ZERO;
  return { v, du, dv, dC, dh, ds };
}

function hunter(XYZ, white) {
  const v = hunterLab(XYZ, white);
  const yr = XYZ.Y / white.Y;
  const sy = Math.sqrt(Math.max(yr, 0));
  if (!(sy > 0)) return { v, dL: ZERO, da: ZERO, db: ZERO };
  const Ka = 175 / 198.04 * (white.X + white.Y);
  const Kb = 70 / 218.11 * (white.Y + white.Z);
  const xr = XYZ.X / white.X, zr = XYZ.Z / white.Z;
  const sy3 = sy * sy * sy;
  return {
    v,
    dL: [0, 50 / (sy * white.Y), 0],
    da: [Ka / (white.X * sy), (Ka / white.Y) * (-1 / sy - (xr - yr) / (2 * sy3)), 0],
    db: [0, (Kb / white.Y) * (1 / sy - (yr - zr) / (2 * sy3)), -Kb / (white.Z * sy)],
  };
}

// A slope in x and y carried to X, Y and Z.
const viaXy = (c, [px, py]) => add([px, c.dx], [py, c.dy]);

function dominant(XYZ, white, observer) {
  const c = chromaticity(XYZ);
  const wxy = chromaticityXy(white);
  const v = dominantWavelength(c, wxy, observer);
  const d = dominantWavelengthSlopes(c, wxy, observer);
  return { v, dDom: viaXy(c, d.dom), dComp: viaXy(c, d.comp), dPurity: viaXy(c, d.purity) };
}

function planckian(XYZ, observer) {
  const c = chromaticity(XYZ);
  const t = correlatedColorTemperatureSlopes(c, observer);
  return { t, dCct: viaXy(c, t.dCct), dDuv: viaXy(c, t.dDuv) };
}

const orNaN = value => (value == null ? NaN : value);

// Quantity → its value and slope, from the tristimulus values `XYZ`, the
// illuminant's `white` on the same grid and the observer.
const QUANTITY = {
  X: ({ XYZ }) => [XYZ.X, [1, 0, 0]],
  Y: ({ XYZ }) => [XYZ.Y, [0, 1, 0]],
  Z: ({ XYZ }) => [XYZ.Z, [0, 0, 1]],
  x: ({ XYZ }) => { const c = chromaticity(XYZ); return [c.x, c.dx]; },
  y: ({ XYZ }) => { const c = chromaticity(XYZ); return [c.y, c.dy]; },
  "u'": ({ XYZ }) => { const s = ucs(XYZ); return [s.up, s.dUp]; },
  "v'": ({ XYZ }) => { const s = ucs(XYZ); return [s.vp, s.dVp]; },
  u: ({ XYZ }) => { const s = ucs(XYZ); return [uv1960(XYZ).u, s.dUp]; },
  v: ({ XYZ }) => { const s = ucs(XYZ); return [uv1960(XYZ).v, s.dVp.map(d => (2 / 3) * d)]; },
  'L*': ({ XYZ, white }) => { const c = cielab(XYZ, white); return [c.v.L, c.dL]; },
  'a*': ({ XYZ, white }) => { const c = cielab(XYZ, white); return [c.v.a, c.da]; },
  'b*': ({ XYZ, white }) => { const c = cielab(XYZ, white); return [c.v.b, c.db]; },
  'C*ab': ({ XYZ, white }) => { const c = cielab(XYZ, white); return [c.v.C, c.dC]; },
  hab: ({ XYZ, white }) => { const c = cielab(XYZ, white); return [c.v.h, c.dh]; },
  'u*': ({ XYZ, white }) => { const c = cieluv(XYZ, white); return [c.v.u, c.du]; },
  'v*': ({ XYZ, white }) => { const c = cieluv(XYZ, white); return [c.v.v, c.dv]; },
  'C*uv': ({ XYZ, white }) => { const c = cieluv(XYZ, white); return [c.v.C, c.dC]; },
  huv: ({ XYZ, white }) => { const c = cieluv(XYZ, white); return [c.v.h, c.dh]; },
  suv: ({ XYZ, white }) => { const c = cieluv(XYZ, white); return [c.v.s, c.ds]; },
  'Hunter L': ({ XYZ, white }) => { const h = hunter(XYZ, white); return [h.v.L, h.dL]; },
  'Hunter a': ({ XYZ, white }) => { const h = hunter(XYZ, white); return [h.v.a, h.da]; },
  'Hunter b': ({ XYZ, white }) => { const h = hunter(XYZ, white); return [h.v.b, h.db]; },
  dominant: ({ XYZ, white, observer }) => { const d = dominant(XYZ, white, observer); return [orNaN(d.v.dom), d.dDom]; },
  complementary: ({ XYZ, white, observer }) => { const d = dominant(XYZ, white, observer); return [orNaN(d.v.comp), d.dComp]; },
  purity: ({ XYZ, white, observer }) => { const d = dominant(XYZ, white, observer); return [d.v.purity, d.dPurity]; },
  CCT: ({ XYZ, observer }) => { const p = planckian(XYZ, observer); return [p.t.cct, p.dCct]; },
  Duv: ({ XYZ, observer }) => { const p = planckian(XYZ, observer); return [p.t.duv, p.dDuv]; },
};

/**
 * The value of `quantity` (one of COLOR_QUANTITIES) and its slope
 * [∂/∂X, ∂/∂Y, ∂/∂Z], from the tristimulus values `XYZ` of the response, the
 * illuminant's `white` on the same grid, and the `observer` ('2' or '10') both
 * were taken with (quantityObserver). The value is NaN where the colour has
 * none: a dominant wavelength for a purple, a complementary one for any other
 * colour, CCT and Duv where the nearest blackbody is at either end of 1000 K
 * to 10⁶ K and CCT more than 0.05 from the Planckian locus; its slope is then
 * [0, 0, 0].
 */
export function colorQuantity(quantity, { XYZ, white, observer }) {
  const [value, slope] = QUANTITY[quantity]({ XYZ, white, observer });
  return { value, slope: Number.isFinite(value) ? slope : ZERO };
}
