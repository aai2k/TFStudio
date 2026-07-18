import { resolveXRange, resolveYRange } from './chartRange.js';
import { axisTicksSVG, axisLabelsSVG } from './chartAxes.js';
import { seriesPolylinesSVG, legendSVG } from './chartSeries.js';

const M_LEFT = 56, M_RIGHT = 16, M_TOP = 14, M_BOTTOM = 46;

function emptyChartSVG(width, height) {
  return `<svg viewBox="0 0 ${width} ${height}" class="tf-chart" xmlns="http://www.w3.org/2000/svg">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>`
    + `<text x="${width/2}" y="${height/2}" text-anchor="middle" fill="#999" font-size="13">no data</text></svg>`;
}

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

  const mL = M_LEFT, mR = M_RIGHT, mT = M_TOP, mB = M_BOTTOM;
  const pw = width - mL - mR, ph = height - mT - mB;

  const all = series.filter(s => s.x && s.x.length);
  if (!all.length) return emptyChartSVG(width, height);

  const [xMin, xMax] = resolveXRange(all, xMinFix, xMaxFix);
  const [yMin, yMax] = resolveYRange(all, yMinFix, yMaxFix);

  const sx = (x) => mL + (x - xMin) / (xMax - xMin) * pw;
  const sy = (y) => mT + (1 - (y - yMin) / (yMax - yMin)) * ph;

  const geom = { xMin, xMax, yMin, yMax, mL, mR, mT, mB, pw, ph, width, height, sx, sy };

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${width} ${height}" class="tf-chart" xmlns="http://www.w3.org/2000/svg">`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(`<rect x="${mL}" y="${mT}" width="${pw}" height="${ph}" fill="#ffffff" stroke="#888" stroke-width="1"/>`);

  parts.push(...axisTicksSVG(geom));
  parts.push(...seriesPolylinesSVG(all, sx, sy));
  parts.push(...axisLabelsSVG(geom, xLabel, yLabel));
  if (legend && all.length > 1) parts.push(...legendSVG(geom, all));

  parts.push(`</svg>`);
  return parts.join('');
}
