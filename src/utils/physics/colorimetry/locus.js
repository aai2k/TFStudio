/**
 * Spectrum-locus construction, dominant/complementary wavelength + excitation
 * purity, and the Planckian locus. See ../colorimetry.js for the full physics
 * provenance.
 */

import { cmfTable, planck } from './tables.js';

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
 * Dominant/complementary wavelength + excitation purity, Macleod §12.2.
 * Ray from white point W through sample S; first intersection with the
 * spectrum-locus polyline gives the dominant λ (purity = |WS|/|W·locus|).
 * If the ray exits through the purple line, report the *complementary*
 * wavelength (opposite ray), with the purity |WS| over the distance from W to
 * the point where the ray meets the purple line (Eq. 12.6, p. 462).
 */
/**
 * First crossing of the ray W + s·(vx,vy), s>0, with the spectrum-locus
 * polyline `loc`. Returns the nearest hit { lam, s, dist, i } (dist = |W→hit|,
 * i the segment from loc[i] to loc[i + 1]) or null if the ray misses every
 * segment.
 */
export function locusRayHit(loc, wx, wy, vx, vy) {
  let best = null;
  for (let i = 0; i < loc.length - 1; i++) {
    const ax = loc[i].x,   ay = loc[i].y;
    const bx = loc[i + 1].x, by = loc[i + 1].y;
    const ex = bx - ax, ey = by - ay;
    const den = vx * ey - vy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const s = ((ax - wx) * ey - (ay - wy) * ex) / den;
    const u = ((ax - wx) * vy - (ay - wy) * vx) / den;
    if (s > 1e-9 && u >= -1e-6 && u <= 1 + 1e-6) {
      const lam = loc[i].lam + u * (loc[i + 1].lam - loc[i].lam);
      const px = wx + s * vx, py = wy + s * vy;
      const cand = { lam, s, dist: Math.hypot(px - wx, py - wy), i };
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

  const fwd = locusRayHit(loc, wx, wy, dx, dy);
  if (fwd) {
    return { dom: fwd.lam, comp: null,
             purity: fwd.dist > 0 ? sampleDist / fwd.dist : 0 };
  }
  // Ray hit the purple line, the chord joining the two ends of the locus: the
  // complementary wavelength lies in the opposite direction.
  const bwd = locusRayHit(loc, wx, wy, -dx, -dy);
  const purple = locusRayHit([loc[0], loc[loc.length - 1]], wx, wy, dx, dy);
  if (bwd) {
    return { dom: null, comp: bwd.lam,
             purity: purple && purple.dist > 0 ? sampleDist / purple.dist : 0 };
  }
  return { dom: null, comp: null, purity: 0 };
}

/**
 * Tristimulus values of a Planckian radiator at temperature `T` in K, summed
 * over the observer's 5 nm table, unnormalised. Their chromaticities, T from
 * low to high, are the Planckian locus.
 */
export function planckianXyz(T, observer) {
  let X = 0, Y = 0, Z = 0;
  for (const [lam, xb, yb, zb] of cmfTable(observer)) {
    const P = planck(lam, T); X += P * xb; Y += P * yb; Z += P * zb;
  }
  return { X, Y, Z };
}

export function xyToXYZ(xy, Y = 1) {
  if (xy.y <= 0) return { X: 0, Y: 0, Z: 0 };
  return { X: xy.x * Y / xy.y, Y, Z: (1 - xy.x - xy.y) * Y / xy.y };
}
