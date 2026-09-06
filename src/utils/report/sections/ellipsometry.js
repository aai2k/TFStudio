/**
 * Ellipsometry block: Ψ(λ) and Δ(λ) per angle as plots, and as a table sampled
 * at a chosen step.
 */

import { lineChartSVG, escapeHtml } from '../svgChart.js';
import {
  num, deg, tt, blockTitle, wrap, table, splitRows, flow, plotHeight, subtitleOf,
} from './format.js';
import { stepIndices } from './spectrum.js';
import { blockData } from './otherSections.js';

const dashFor = si => si === 0 ? null : (si === 1 ? '4 3' : '1 3');

function angleSuffix(e, s) {
  return e.series.length > 1 ? ` ${deg(s.theta)}°` : '';
}

function quantitySeries(e, key, symbol, color) {
  return e.series.map((s, si) => ({
    x: e.lambda, y: s[key], color, label: symbol + angleSuffix(e, s), dash: dashFor(si),
  }));
}

function plots(e, settings, tr) {
  const height = plotHeight(settings.plot);
  if (height <= 0) return '';
  const plotH = Math.max(160, Math.round(height * 0.8));
  const xLabel = tt(tr, 'wavelengthNm', 'Wavelength, nm');
  const one = (series, yLabel, yMax) =>
    `<div class="tf-plot">${lineChartSVG({ width: 720, height: plotH, series, xLabel, yLabel, yMin: 0, yMax })}</div>`;
  return (settings.showPsi ? one(quantitySeries(e, 'psi', 'Ψ', '#1565c0'), 'Ψ, °', 90) : '')
       + (settings.showDelta ? one(quantitySeries(e, 'delta', 'Δ', '#c62828'), 'Δ, °', 360) : '');
}

function steppedTable(e, settings) {
  if (!(settings.tableStep > 0)) return '';
  const headers = ['λ, nm'];
  const cols = [];
  for (const s of e.series) {
    const suffix = angleSuffix(e, s);
    if (settings.showPsi) { headers.push(`Ψ${suffix}, °`); cols.push(s.psi); }
    if (settings.showDelta) { headers.push(`Δ${suffix}, °`); cols.push(s.delta); }
  }
  const rows = stepIndices(e.lambda, settings.tableStep).map(i =>
    [String(Math.round(e.lambda[i] * 10) / 10), ...cols.map(arr => num(arr[i], 2))]);
  const ncol = headers.length <= 4 ? Math.min(3, Math.max(1, Math.ceil(rows.length / 30))) : 1;
  return flow(splitRows(rows, ncol).map(slice => table(headers, slice, { align: headers.map(() => 'r') })));
}

export function buildEllipsometry(ctx) {
  const { tr, settings } = ctx;
  const title = blockTitle(tr, 'ellipsometry', 'Ellipsometry');
  const { d: e, fail } = blockData(ctx, 'ellipsometry', title);
  if (fail) return fail;
  const sub = `${escapeHtml(tt(tr, 'aoi', 'AOI'))} ${e.series.map(s => `${deg(s.theta)}°`).join(', ')}`;
  return wrap('ellipsometry', title, plots(e, settings, tr) + steppedTable(e, settings),
    { subtitle: subtitleOf(ctx, sub), breakable: settings.tableStep > 0 });
}
