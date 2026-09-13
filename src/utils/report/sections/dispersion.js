/**
 * Group delay block: phase, GD, GDD, CDC and TOD against wavelength, one plot
 * per chosen quantity and a table sampled at a chosen step.
 */

import { lineChartSVG, escapeHtml } from '../svgChart.js';
import {
  num, deg, tt, blockTitle, wrap, table, splitRows, flow, plotHeight, subtitleOf, note, DASH,
} from './format.js';
import { toSignificantFigures } from '../../math/significantFigures.js';
import { stepIndices } from './spectrum.js';
import { blockData } from './otherSections.js';

// Quantity key → data field, axis label and color. Units are fixed by the
// evaluator: femtoseconds and their powers, and fs/nm where the same dispersion
// is taken against wavelength. CDC is written to a fixed number of significant
// figures rather than decimals, because the conversion moves it by three
// decades or more and a fixed decimal count reads as zeros at one end of that
// and as a long integer at the other.
export const QUANTITIES = [
  { key: 'phase', field: 'phaseDeg', label: (tr) => `${tt(tr, 'phase', 'Phase')}, °`, color: '#6a1b9a', decimals: 1 },
  { key: 'gd',    field: 'gd',       label: () => 'GD, fs',   color: '#1565c0', decimals: 2 },
  { key: 'gdd',   field: 'gdd',      label: () => 'GDD, fs²', color: '#c62828', decimals: 2 },
  { key: 'cdc',   field: 'cdc',      label: () => 'CDC, fs/nm', color: '#ef6c00', significantFigures: 5 },
  { key: 'tod',   field: 'tod',      label: () => 'TOD, fs³', color: '#2e7d32', decimals: 1 },
];

/** The quantity keys a gdGdd block can switch on, in the order it shows them. */
export const DISPERSION_QUANTITY_KEYS = QUANTITIES.map(quantity => quantity.key);

function cell(quantity, value) {
  if (value == null || !isFinite(value)) return DASH;
  return quantity.significantFigures
    ? toSignificantFigures(value, quantity.significantFigures)
    : num(value, quantity.decimals);
}

function chosen(settings) {
  const on = settings.quantities || {};
  return QUANTITIES.filter(q => on[q.key]);
}

function plots(d, quantities, settings, tr) {
  const height = plotHeight(settings.plot);
  if (height <= 0) return '';
  const plotH = Math.max(160, Math.round(height * 0.8));
  const xLabel = tt(tr, 'wavelengthNm', 'Wavelength, nm');
  return quantities.map(q => `<div class="tf-plot">${lineChartSVG({
    width: 720, height: plotH, xLabel, yLabel: q.label(tr),
    series: [{ x: d.lambda, y: d[q.field], color: q.color, label: q.label(tr) }],
  })}</div>`).join('');
}

function steppedTable(d, quantities, settings, tr) {
  if (!(settings.tableStep > 0) || !quantities.length) return '';
  const headers = ['λ, nm', ...quantities.map(q => escapeHtml(q.label(tr)))];
  const rows = stepIndices(d.lambda, settings.tableStep).map(i =>
    [String(Math.round(d.lambda[i] * 10) / 10), ...quantities.map(q => cell(q, d[q.field][i]))]);
  const ncol = headers.length <= 4 ? Math.min(3, Math.max(1, Math.ceil(rows.length / 30))) : 1;
  return flow(splitRows(rows, ncol).map(slice => table(headers, slice, { align: headers.map(() => 'r') })));
}

export function buildGdGdd(ctx) {
  const { tr, settings } = ctx;
  const title = blockTitle(tr, 'gdGdd', 'Group delay');
  const { d, fail } = blockData(ctx, 'gdGdd', title);
  if (fail) return fail;
  const quantities = chosen(settings);
  const sides = tr?.sides || {};
  const sub = `${escapeHtml(d.target)} · ${escapeHtml(sides[d.side] || d.side)} · ${escapeHtml(tt(tr, 'aoi', 'AOI'))} ${deg(d.theta)}° · ${escapeHtml(d.pol)}`;
  let inner = plots(d, quantities, settings, tr) + steppedTable(d, quantities, settings, tr);
  if (d.invalid > 0) inner += note(escapeHtml(typeof tr?.invalidPoints === 'function' ? tr.invalidPoints(d.invalid) : `${d.invalid} points could not be evaluated`));
  return wrap('gdGdd', title, inner, { subtitle: subtitleOf(ctx, sub), breakable: settings.tableStep > 0 });
}
