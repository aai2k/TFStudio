import { escapeHtml } from './escapeHtml.js';

// Screen-space points for one series. `step` draws a left-hand staircase
// (value holds until the next node, then jumps) — correct for the
// refractive-index profile, which is a piecewise-constant n(z) and would
// otherwise look like sloped "hills".
function seriesPoints(s, sx, sy) {
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
  return pts;
}

// Series polylines.
export function seriesPolylinesSVG(all, sx, sy) {
  const parts = [];
  for (const s of all) {
    const pts = seriesPoints(s, sx, sy);
    if (!pts.length) continue;
    const dash = s.dash ? ` stroke-dasharray="${s.dash}"` : '';
    parts.push(`<polyline fill="none" stroke="${s.color || '#1565c0'}" stroke-width="1.4"${dash} points="${pts.join(' ')}"/>`);
  }
  return parts;
}

export const LEGEND_ROW_HEIGHT = 14;
const LEGEND_GAP = 14;
const CHAR_WIDTH = 5.6;

/**
 * Legend entries laid out in rows under the plot, wrapping at the plot width,
 * so the legend never covers a curve. Returns rows of `{ s, x }`.
 */
export function legendLayout(all, left, maxWidth) {
  const rows = [];
  let row = [], x = left;
  for (const s of all) {
    const w = 22 + (s.label || '').length * CHAR_WIDTH;
    if (row.length && x + w > left + maxWidth) { rows.push(row); row = []; x = left; }
    row.push({ s, x });
    x += w + LEGEND_GAP;
  }
  if (row.length) rows.push(row);
  return rows;
}

/** The legend rows drawn from `top` downwards. */
export function legendSVG(rows, top) {
  const parts = [`<g font-size="10">`];
  rows.forEach((row, r) => {
    const y = top + r * LEGEND_ROW_HEIGHT + 9;
    for (const { s, x } of row) {
      parts.push(`<line x1="${x}" y1="${y}" x2="${x + 16}" y2="${y}" stroke="${s.color}" stroke-width="2"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`);
      parts.push(`<text x="${x + 21}" y="${y + 3}" fill="#222">${escapeHtml(s.label || '')}</text>`);
    }
  });
  parts.push(`</g>`);
  return parts;
}
