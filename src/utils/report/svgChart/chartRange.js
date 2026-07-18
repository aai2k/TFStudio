// Axis-range resolution: fixed cfg values win, otherwise fall back to the
// data extent (y gets a 5% pad); a degenerate (zero-width/height) range is
// widened by 1 so the scale never divides by zero.

// Min/max of a field ('x' or 'y') across every series.
function dataExtent(all, field) {
  let lo = +Infinity, hi = -Infinity;
  for (const s of all) for (const v of s[field]) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

export function resolveXRange(all, xMinFix, xMaxFix) {
  let xMin = xMinFix, xMax = xMaxFix;
  if (xMin == null || xMax == null) {
    const [lo, hi] = dataExtent(all, 'x');
    if (xMin == null) xMin = lo; if (xMax == null) xMax = hi;
  }
  if (xMax === xMin) xMax = xMin + 1;
  return [xMin, xMax];
}

export function resolveYRange(all, yMinFix, yMaxFix) {
  let yMin = yMinFix, yMax = yMaxFix;
  if (yMin == null || yMax == null) {
    let [lo, hi] = dataExtent(all, 'y');
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.05;
    if (yMin == null) yMin = lo - pad; if (yMax == null) yMax = hi + pad;
  }
  if (yMax === yMin) yMax = yMin + 1;
  return [yMin, yMax];
}
