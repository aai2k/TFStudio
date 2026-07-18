/**
 * Spectrum-locus construction, dominant/complementary wavelength + excitation
 * purity, and correlated colour temperature. See ../colorimetry.js for the
 * full physics provenance.
 */

import { cmfTable, planck } from './tables.js';
import { uv1960 } from './colorSpaces.js';

// Spectrum locus (monochromatic-stimulus chromaticities) for the observer.
function spectrumLocus(observer) {
  const cmf = cmfTable(observer);
  return cmf.map(([lam, X, Y, Z]) => {
    const s = X + Y + Z;
    return { lam, x: s > 0 ? X / s : 0, y: s > 0 ? Y / s : 0 };
  });
}
export function spectralLocusXy(observer) { return spectrumLocus(observer); }

/**
 * Dominant/complementary wavelength + excitation purity — Macleod §12.2.
 * Ray from white point W through sample S; first intersection with the
 * spectrum-locus polyline gives the dominant λ (purity = |WS|/|W·locus|).
 * If the ray exits through the purple line, report the *complementary*
 * wavelength (opposite ray) and a negative-purity convention.
 */
// First crossing of the ray W + s·(vx,vy), s>0, with the spectrum-locus
// polyline `loc`. Returns the nearest hit { lam, s, dist } (dist = |W→hit|) or
// null if the ray misses every segment.
function _locusRayHit(loc, wx, wy, vx, vy) {
  let best = null;
  for (let i = 0; i < loc.length - 1; i++) {
    const ax = loc[i].x,   ay = loc[i].y;
    const bx = loc[i + 1].x, by = loc[i + 1].y;
    const ex = bx - ax, ey = by - ay;
    const den = vx * ey - vy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const s = ((ax - wx) * ey - (ay - wy) * ex) / den;
    const u = ((ax - wx) * vy - (ay - wy) * vx) / -den;
    if (s > 1e-9 && u >= -1e-6 && u <= 1 + 1e-6) {
      const lam = loc[i].lam + u * (loc[i + 1].lam - loc[i].lam);
      const px = wx + s * vx, py = wy + s * vy;
      const cand = { lam, s, dist: Math.hypot(px - wx, py - wy) };
      if (!best || s < best.s) best = cand;
    }
  }
  return best;
}

export function dominantWavelength(xy, white, observer) {
  const loc = spectrumLocus(observer);
  const wx = white.x, wy = white.y;
  const dx = xy.x - wx, dy = xy.y - wy;
  const sampleDist = Math.hypot(dx, dy);
  if (sampleDist < 1e-9) return { dom: null, comp: null, purity: 0 };

  const fwd = _locusRayHit(loc, wx, wy, dx, dy);
  if (fwd) {
    return { dom: fwd.lam, comp: null,
             purity: fwd.dist > 0 ? sampleDist / fwd.dist : 0 };
  }
  // Ray hit the purple line → use complementary (opposite direction).
  const bwd = _locusRayHit(loc, wx, wy, -dx, -dy);
  if (bwd) {
    return { dom: null, comp: bwd.lam,
             purity: bwd.dist > 0 ? sampleDist / bwd.dist : 0 };
  }
  return { dom: null, comp: null, purity: 0 };
}

/**
 * Correlated colour temperature (McCamy 1992 cubic) + Duv.
 * Duv = signed distance from the sample to the Planckian locus in CIE 1960
 * (u,v) (positive above the locus).
 */
export function correlatedColorTemperature(xy, observer) {
  // McCamy 1992: n = (x − xe)/(y − ye), epicenter (0.3320, 0.1858). The formula
  // is singular at the epicenter; guard the division so y=0.1858 can't emit
  // ±Infinity/NaN that would then break the Duv search loop below.
  const denom = xy.y - 0.1858;
  if (!(Math.abs(denom) > 1e-6)) return { cct: NaN, duv: NaN, locusT: NaN };
  const n = (xy.x - 0.3320) / denom;
  const cct = -449 * n * n * n + 3525 * n * n - 6823.3 * n + 5520.33;
  // Outside the McCamy-valid range CCT is meaningless; report N/A.
  if (!Number.isFinite(cct) || cct < 1000 || cct > 1e6) {
    return { cct: NaN, duv: NaN, locusT: NaN };
  }
  // Duv: nearest blackbody on the locus near the McCamy estimate.
  const uvOf = (T) => {
    let X = 0, Y = 0, Z = 0;
    const cmf = cmfTable(observer);
    for (const [lam, xb, yb, zb] of cmf) {
      const P = planck(lam, T); X += P * xb; Y += P * yb; Z += P * zb;
    }
    return uv1960({ X, Y, Z });
  };
  const sample = uv1960(xyToXYZ(xy));
  let bestT = cct, bestD = Infinity;
  for (let T = Math.max(1000, cct - 400); T <= cct + 400; T += 5) {
    const p = uvOf(T);
    const d = Math.hypot(p.u - sample.u, p.v - sample.v);
    if (d < bestD) { bestD = d; bestT = T; }
  }
  const pl = uvOf(bestT);
  const duv = (sample.v > pl.v ? 1 : -1) * bestD;
  // McCamy CCT is only meaningful near the Planckian locus. Beyond |Duv| ~ 0.05
  // (where the ±400 K search also tends to rail at its window edge) the colour
  // is too far off-locus for a correlated temperature — report N/A for cct but
  // still return the measured Duv.
  if (Math.abs(duv) > 0.05) return { cct: NaN, duv, locusT: bestT };
  return { cct, duv, locusT: bestT };
}

function xyToXYZ(xy, Y = 1) {
  if (xy.y <= 0) return { X: 0, Y: 0, Z: 0 };
  return { X: xy.x * Y / xy.y, Y, Z: (1 - xy.x - xy.y) * Y / xy.y };
}
