/**
 * Minimal dependency-free inline-SVG line charts for the report engine.
 *
 * The report HTML must be a single self-contained file (and must render in a
 * headless print-to-PDF window where Plotly is not loaded), so plots are emitted
 * as hand-built `<svg>` rather than via Plotly toImage. Print-friendly: thin
 * strokes, light gridlines, black-on-white axes.
 */

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function niceNum(range, round) {
  const exp = Math.floor(Math.log10(range || 1));
  const frac = (range || 1) / Math.pow(10, exp);
  let nf;
  if (round) nf = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  else       nf = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

// Generate ~`count` "nice" tick values across [min,max].
function ticks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const range = niceNum(max - min, false);
  const step  = niceNum(range / (count - 1), true);
  const start = Math.ceil(min / step) * step;
  const out = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Math.round(v / step) * step);
  return out;
}

const fmtTick = (v) => {
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1e5)) return v.toExponential(1);
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1000) / 1000);
};

/**
 * Line chart.
 *
 * @param {object} cfg
 *   width,height   px (viewBox; CSS scales to container)
 *   series         [{ x:[…], y:[…], color, label, dash? }]
 *   xLabel,yLabel  axis titles
 *   yMin,yMax      optional fixed y-range (else auto)
 *   xMin,xMax      optional fixed x-range (else from data)
 * @returns {string} `<svg>…</svg>`
 */
export function lineChartSVG(cfg) {
  const {
    width = 720, height = 320, series = [],
    xLabel = '', yLabel = '',
    yMin: yMinFix, yMax: yMaxFix, xMin: xMinFix, xMax: xMaxFix,
    legend = true,
  } = cfg;

  const mL = 56, mR = 16, mT = 14, mB = 46;
  const pw = width - mL - mR, ph = height - mT - mB;

  const all = series.filter(s => s.x && s.x.length);
  if (!all.length) {
    return `<svg viewBox="0 0 ${width} ${height}" class="tf-chart" xmlns="http://www.w3.org/2000/svg">`
      + `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>`
      + `<text x="${width/2}" y="${height/2}" text-anchor="middle" fill="#999" font-size="13">no data</text></svg>`;
  }

  let xMin = xMinFix, xMax = xMaxFix, yMin = yMinFix, yMax = yMaxFix;
  if (xMin == null || xMax == null) {
    let lo = +Infinity, hi = -Infinity;
    for (const s of all) for (const x of s.x) { if (x < lo) lo = x; if (x > hi) hi = x; }
    if (xMin == null) xMin = lo; if (xMax == null) xMax = hi;
  }
  if (yMin == null || yMax == null) {
    let lo = +Infinity, hi = -Infinity;
    for (const s of all) for (const y of s.y) { if (y < lo) lo = y; if (y > hi) hi = y; }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.05;
    if (yMin == null) yMin = lo - pad; if (yMax == null) yMax = hi + pad;
  }
  if (xMax === xMin) xMax = xMin + 1;
  if (yMax === yMin) yMax = yMin + 1;

  const sx = (x) => mL + (x - xMin) / (xMax - xMin) * pw;
  const sy = (y) => mT + (1 - (y - yMin) / (yMax - yMin)) * ph;

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${width} ${height}" class="tf-chart" xmlns="http://www.w3.org/2000/svg">`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(`<rect x="${mL}" y="${mT}" width="${pw}" height="${ph}" fill="#ffffff" stroke="#888" stroke-width="1"/>`);

  // Gridlines + ticks
  for (const xv of ticks(xMin, xMax, 6)) {
    if (xv < xMin - 1e-9 || xv > xMax + 1e-9) continue;
    const X = sx(xv);
    parts.push(`<line x1="${X.toFixed(1)}" y1="${mT}" x2="${X.toFixed(1)}" y2="${mT+ph}" stroke="#e6e6e6" stroke-width="1"/>`);
    parts.push(`<text x="${X.toFixed(1)}" y="${mT+ph+16}" text-anchor="middle" fill="#444" font-size="10">${fmtTick(xv)}</text>`);
  }
  for (const yv of ticks(yMin, yMax, 5)) {
    if (yv < yMin - 1e-9 || yv > yMax + 1e-9) continue;
    const Y = sy(yv);
    parts.push(`<line x1="${mL}" y1="${Y.toFixed(1)}" x2="${mL+pw}" y2="${Y.toFixed(1)}" stroke="#e6e6e6" stroke-width="1"/>`);
    parts.push(`<text x="${mL-6}" y="${(Y+3).toFixed(1)}" text-anchor="end" fill="#444" font-size="10">${fmtTick(yv)}</text>`);
  }

  // Series polylines. `step` draws a left-hand staircase (value holds until the
  // next node, then jumps) — correct for the refractive-index profile, which is
  // a piecewise-constant n(z) and would otherwise look like sloped "hills".
  for (const s of all) {
    const pts = [];
    let prevY = null;
    for (let i = 0; i < s.x.length; i++) {
      const yv = s.y[i];
      if (yv == null || !isFinite(yv)) continue;
      const X = sx(s.x[i]), Y = sy(yv);
      // Left-hand staircase: hold the previous value across to this x, then jump.
      if (s.step && prevY != null) pts.push(`${X.toFixed(1)},${prevY.toFixed(1)}`);
      pts.push(`${X.toFixed(1)},${Y.toFixed(1)}`);
      prevY = Y;
    }
    if (!pts.length) continue;
    const dash = s.dash ? ` stroke-dasharray="${s.dash}"` : '';
    parts.push(`<polyline fill="none" stroke="${s.color || '#1565c0'}" stroke-width="1.4"${dash} points="${pts.join(' ')}"/>`);
  }

  // Axis labels
  if (xLabel) parts.push(`<text x="${mL+pw/2}" y="${height-6}" text-anchor="middle" fill="#222" font-size="11">${escapeHtml(xLabel)}</text>`);
  if (yLabel) parts.push(`<text x="14" y="${mT+ph/2}" text-anchor="middle" fill="#222" font-size="11" transform="rotate(-90 14 ${mT+ph/2})">${escapeHtml(yLabel)}</text>`);

  // Legend
  if (legend && all.length > 1) {
    let lx = mL + 8, ly = mT + 6;
    parts.push(`<g font-size="10">`);
    for (const s of all) {
      const w = 8 + (s.label || '').length * 5.6 + 18;
      parts.push(`<rect x="${lx}" y="${ly-9}" width="${w}" height="13" fill="#ffffff" fill-opacity="0.75"/>`);
      parts.push(`<line x1="${lx+2}" y1="${ly-2}" x2="${lx+16}" y2="${ly-2}" stroke="${s.color}" stroke-width="2"${s.dash?` stroke-dasharray="${s.dash}"`:''}/>`);
      parts.push(`<text x="${lx+20}" y="${ly+1}" fill="#222">${escapeHtml(s.label || '')}</text>`);
      ly += 15;
    }
    parts.push(`</g>`);
  }

  parts.push(`</svg>`);
  return parts.join('');
}

// Small filled-step n(z) staircase (refractive-index profile).
export function stepChartSVG(cfg) {
  const { z = [], n = [] } = cfg;
  const series = [{ x: z, y: n, color: '#6a1b9a', label: cfg.label || 'n' }];
  return lineChartSVG({ ...cfg, series });
}
