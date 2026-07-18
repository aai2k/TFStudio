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

// Legend swatches, stacked top-left inside the plot area.
export function legendSVG(geom, all) {
  const { mL, mT } = geom;
  let lx = mL + 8, ly = mT + 6;
  const parts = [`<g font-size="10">`];
  for (const s of all) {
    const w = 8 + (s.label || '').length * 5.6 + 18;
    parts.push(`<rect x="${lx}" y="${ly-9}" width="${w}" height="13" fill="#ffffff" fill-opacity="0.75"/>`);
    parts.push(`<line x1="${lx+2}" y1="${ly-2}" x2="${lx+16}" y2="${ly-2}" stroke="${s.color}" stroke-width="2"${s.dash?` stroke-dasharray="${s.dash}"`:''}/>`);
    parts.push(`<text x="${lx+20}" y="${ly+1}" fill="#222">${escapeHtml(s.label || '')}</text>`);
    ly += 15;
  }
  parts.push(`</g>`);
  return parts;
}
