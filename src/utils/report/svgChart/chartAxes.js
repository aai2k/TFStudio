import { escapeHtml } from './escapeHtml.js';
import { ticks, fmtTick } from './ticks.js';

// Gridlines + tick labels for both axes.
export function axisTicksSVG(geom) {
  const { xMin, xMax, yMin, yMax, mL, mT, ph, pw, sx, sy } = geom;
  const parts = [];
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
  return parts;
}

// Axis titles: x centered below the plot, y rotated along the left edge.
export function axisLabelsSVG(geom, xLabel, yLabel) {
  const { mT, mL, ph, pw, width, height } = geom;
  const parts = [];
  if (xLabel) parts.push(`<text x="${mL+pw/2}" y="${height-6}" text-anchor="middle" fill="#222" font-size="11">${escapeHtml(xLabel)}</text>`);
  if (yLabel) parts.push(`<text x="14" y="${mT+ph/2}" text-anchor="middle" fill="#222" font-size="11" transform="rotate(-90 14 ${mT+ph/2})">${escapeHtml(yLabel)}</text>`);
  return parts;
}
