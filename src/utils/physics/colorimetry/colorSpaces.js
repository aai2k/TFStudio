/**
 * Tristimulus integration and colour-space conversions (CIELAB / CIELUV /
 * u'v' / Hunter Lab). See ../colorimetry.js for the full physics provenance.
 */

import { RANGE_MIN, RANGE_MAX, cmfTable, interp, illumValue } from './tables.js';
import { trapezoidalWeighted } from '../integralValues/weightedIntegral.js';

/**
 * Tristimulus X,Y,Z of a sampled spectral response, Macleod Eqs. (12.1)–(12.3):
 *
 *     X = 100 · ∫S(λ)R(λ)x̄(λ)dλ / ∫S(λ)ȳ(λ)dλ,  Y and Z alike with ȳ and z̄.
 *
 * The integrals are taken by the trapezoidal rule on the response's own
 * wavelength grid over 380–780 nm, with S and x̄, ȳ, z̄ linearly interpolated
 * from their 5 nm CIE tables to the grid nodes. A feature narrower than the
 * table spacing therefore counts at the width the grid resolves; nothing
 * between two grid nodes is seen.
 *
 * @param {{lambda:number[], values:number[]}} spectrum
 *        `lambda` ascending in nm; `values` R(λ)|T(λ) as a *fraction* (0–1)
 * @param {string} observer    '2' | '10'
 * @param {string} illuminant  'D65' | 'D50' | 'A' | 'E'
 * @returns {{X,Y,Z}}  with Y in percent (luminance factor)
 */
export function tristimulus(spectrum, observer, illuminant) {
  const cmf = cmfTable(observer);
  const integrate = (col) => trapezoidalWeighted(spectrum.lambda, spectrum.values,
    (lam) => illumValue(illuminant, lam) * interp(cmf, lam, col), RANGE_MIN, RANGE_MAX);
  const x = integrate(1), y = integrate(2), z = integrate(3);
  // ∫S·ȳ·dλ, the denominator of all three.
  const norm = y.den;
  if (!(norm > 0)) return { X: 0, Y: 0, Z: 0 };
  const k = 100 / norm;
  return { X: k * x.num, Y: k * y.num, Z: k * z.num };
}

/** Reference-white XYZ (R ≡ 1) on the wavelength grid `lambda` (nm). */
export function whitePoint(lambda, observer, illuminant) {
  return tristimulus({ lambda, values: Array.from(lambda, () => 1) }, observer, illuminant);
}

export function chromaticityXy({ X, Y, Z }) {
  const s = X + Y + Z;
  if (s <= 0) return { x: 0, y: 0 };
  return { x: X / s, y: Y / s };
}

// CIE 1976 UCS u',v'  and  CIE 1960 UCS u,v  (v = 1.5·v').
export function uvPrime({ X, Y, Z }) {
  const d = X + 15 * Y + 3 * Z;
  if (d <= 0) return { up: 0, vp: 0 };
  return { up: 4 * X / d, vp: 9 * Y / d };
}
export function uv1960(XYZ) {
  const { up, vp } = uvPrime(XYZ);
  return { u: up, v: (2 / 3) * vp };
}

const f_lab = (t) => t > 0.008856451679 ? Math.cbrt(t) : (7.787037037 * t + 16 / 116);

/** CIE L*a*b* + C*ab, h°ab (CIE 15:2004 §8.2). White Yn = 100. */
export function lab(XYZ, white) {
  const fx = f_lab(XYZ.X / white.X);
  const fy = f_lab(XYZ.Y / white.Y);
  const fz = f_lab(XYZ.Z / white.Z);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  const C = Math.hypot(a, b);
  let h = Math.atan2(b, a) * 180 / Math.PI; if (h < 0) h += 360;
  return { L, a, b, C, h };
}

/** CIE L*u*v* + C*uv, h°uv, suv (CIE 15:2004 §8.2.1). */
export function luv(XYZ, white) {
  const yr = XYZ.Y / white.Y;
  const L = yr > 0.008856451679 ? 116 * Math.cbrt(yr) - 16 : 903.296296 * yr;
  const s  = uvPrime(XYZ), sw = uvPrime(white);
  const u = 13 * L * (s.up - sw.up);
  const v = 13 * L * (s.vp - sw.vp);
  const C = Math.hypot(u, v);
  let h = Math.atan2(v, u) * 180 / Math.PI; if (h < 0) h += 360;
  const suv = L > 0 ? C / L : 0;
  return { L, u, v, C, h, s: suv };
}

/** Hunter Lab (Hunter, *JOSA* 48, 985 (1958); CIE 15 Annex). */
export function hunterLab(XYZ, white) {
  const Ka = 175 / 198.04 * (white.X + white.Y);
  const Kb =  70 / 218.11 * (white.Y + white.Z);
  const xr = XYZ.X / white.X, yr = XYZ.Y / white.Y, zr = XYZ.Z / white.Z;
  const sy = Math.sqrt(Math.max(yr, 0));
  const L = 100 * sy;
  const a = sy > 0 ? Ka * (xr - yr) / sy : 0;
  const b = sy > 0 ? Kb * (yr - zr) / sy : 0;
  return { L, a, b };
}
