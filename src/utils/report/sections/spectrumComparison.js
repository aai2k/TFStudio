/**
 * Spectrum block for several designs: every design on one plot, one color per
 * design and one line style per quantity, and a table with a column per design.
 * First angle only, so the plot stays readable. The axis unit and the vertical
 * scale are the block's, as in the single-design form.
 */

import { escapeHtml } from '../svgChart.js';
import { deg, tt, blockTitle, errNote, wrap, note, DESIGN_COLORS } from './format.js';
import { enabledCurves, stepIndices, stepTable, spectrumAxes, spectrumPlot } from './spectrum.js';

// One line style per quantity; the design is told by its color.
const CURVE_DASH = { T: null, R: '4 3', A: '1 3', Ts: '2 2', Rs: '6 2', Tp: '8 3 2 3', Rp: '8 3 2 3 2 3' };

/** Index of the grid point at `lam`, or -1 when the grid does not carry it. */
export function nearestIndex(lambda, lam) {
  if (!lambda.length) return -1;
  const dl = lambda.length > 1 ? (lambda[lambda.length - 1] - lambda[0]) / (lambda.length - 1) : 1;
  const i = Math.round((lam - lambda[0]) / dl);
  const inside = i >= 0 && i < lambda.length && Math.abs(lambda[i] - lam) <= dl / 2 + 1e-9;
  return inside ? i : -1;
}

function comparisonSeries(ready, curves, axes) {
  const series = [];
  for (const d of ready) {
    const s = d.sp.series[0];
    const x = d.sp.lambda.map(axes.x);
    for (const cv of curves) {
      if (!s[cv.key]) continue;
      series.push({ x, y: s[cv.key].map(axes.y), color: d.color, label: `${cv.key} ${d.label}`, dash: CURVE_DASH[cv.key] });
    }
  }
  return series;
}

function comparisonTable(ready, curves, step, axes) {
  const headers = [axes.xHeader];
  const cols = [];
  for (const cv of curves) {
    for (const d of ready) {
      if (!d.sp.series[0][cv.key]) continue;
      headers.push(`${cv.key} ${d.label}${axes.yTag}`);
      cols.push({ lambda: d.sp.lambda, arr: d.sp.series[0][cv.key] });
    }
  }
  const grid = ready[0].sp.lambda;
  const rows = stepIndices(grid, step).map(i => {
    const lam = grid[i];
    return [axes.formatX(lam), ...cols.map(col => {
      const j = nearestIndex(col.lambda, lam);
      return j >= 0 ? axes.formatY(col.arr[j]) : '';
    })];
  });
  return stepTable(headers.map(escapeHtml), rows);
}

/** `designs` is [{ label, name, color, data }]; each design's spectrum sits under the block's id. */
export function buildSpectrumComparison({ designs, block, settings, tr }) {
  const title = blockTitle(tr, 'spectrum', 'Spectrum');
  const items = designs.map((d, i) => ({ ...d, sp: d.data.blocks[block.id], color: d.color || DESIGN_COLORS[i % DESIGN_COLORS.length] }));
  const ready = items.filter(d => d.sp && !d.sp.error && d.sp.series.length);
  if (!ready.length) return wrap('spectrum', title, errNote(items.find(d => d.sp?.error)?.sp.error || 'not computed'));

  const axes = spectrumAxes(settings, tr);
  const curves = enabledCurves(settings);
  const withTable = settings.tableStep > 0 && curves.length > 0;
  const inner = spectrumPlot(comparisonSeries(ready, curves, axes), settings, axes)
    + note(`${escapeHtml(tt(tr, 'aoi', 'AOI'))} ${deg(ready[0].sp.series[0].theta)}°`)
    + (withTable ? comparisonTable(ready, curves, settings.tableStep, axes) : '');
  return wrap('spectrum', title, inner, { breakable: withTable });
}
