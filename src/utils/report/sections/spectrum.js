/**
 * Spectrum block: T, R and A, with their s and p components, against the
 * spectral axis as a plot and as a table sampled at a chosen step.
 *
 * The axis unit and the vertical scale (percent, fraction, dB or optical
 * density) follow the Optical Evaluation window's own definitions, so the block
 * reads as that window does. The form for several designs is in
 * ./spectrumComparison.js.
 */

import { lineChartSVG, escapeHtml } from '../svgChart.js';
import { SPECTRAL_UNITS, fromNm, spectralSymbol } from '../../physics/spectralAxis.js';
import { yScaleOf, yScaleReadsQuantity } from '../../../components/windows/analysis/opticalEvaluation/yScale.js';
import {
  DASH, deg, tt, blockTitle, errNote, wrap, table, splitRows, flow, note, plotHeight,
} from './format.js';

// Print colours: one hue per quantity, lighter for the s and darker for the p
// component.
export const CURVES = [
  { key: 'T',  color: '#1565c0' },
  { key: 'R',  color: '#c62828' },
  { key: 'A',  color: '#2e7d32' },
  { key: 'Ts', color: '#64b5f6' },
  { key: 'Rs', color: '#ef9a9a' },
  { key: 'Tp', color: '#0d47a1' },
  { key: 'Rp', color: '#8e0000' },
];

// Solid for the first angle, dashed for the rest.
const dashFor = si => si === 0 ? null : (si === 1 ? '4 3' : '1 3');

// Decimals the table prints in each vertical scale: what a coating is
// specified to, not what the engine carries.
const Y_DECIMALS = { percent: 2, fraction: 4, dB: 2, OD: 3 };
const Y_UNIT_TAG = { percent: ', %', fraction: '', dB: ', dB', OD: ', OD' };

/** The switched-on curves the block's vertical scale can read. */
export function enabledCurves(settings) {
  const on = settings.curves || {};
  return CURVES.filter(cv => on[cv.key] && yScaleReadsQuantity(settings.yScale, cv.key));
}

// A fixed vertical range in the scale's own numbers. A logarithmic scale has
// no reading for a zero end: that end comes from the data, and the one end
// with a reading is the top of a dB axis and the bottom of a density axis.
function fixedYRange(settings, scale) {
  if (settings.yAuto) return {};
  const ends = [scale.fromPercent(settings.yMin ?? 0), scale.fromPercent(settings.yMax ?? 100)].filter(Number.isFinite);
  if (ends.length === 2) return { yMin: Math.min(...ends), yMax: Math.max(...ends) };
  if (ends.length === 0) return {};
  return scale.id === 'OD' ? { yMin: ends[0] } : { yMax: ends[0] };
}

/** How the block reads its axes: the x unit and the y scale, with their formats. */
export function spectrumAxes(settings, tr) {
  const unit = SPECTRAL_UNITS[settings.spectralUnit] ? settings.spectralUnit : 'nm';
  const scale = yScaleOf(settings.yScale);
  const decimals = Math.max(1, SPECTRAL_UNITS[unit].decimals);
  const formatValue = value => value.toFixed(decimals).replace(/\.?0+$/, '');
  return {
    unitShort: SPECTRAL_UNITS[unit].short,
    xLabel: (tr?.spectralAxis || {})[unit] || SPECTRAL_UNITS[unit].title,
    xHeader: `${spectralSymbol(unit)}, ${SPECTRAL_UNITS[unit].short}`,
    x: nm => fromNm(nm, unit),
    formatValue,
    formatX: nm => formatValue(fromNm(nm, unit)),
    y: fraction => scale.fromFraction(fraction),
    yLabel: scale.short,
    yTag: Y_UNIT_TAG[scale.id],
    yRange: fixedYRange(settings, scale),
    formatY: fraction => {
      const shown = scale.fromFraction(fraction);
      if (Number.isFinite(shown)) return shown.toFixed(Y_DECIMALS[scale.id]);
      return shown > 0 ? '∞' : DASH;
    },
  };
}

/** Sample indices at every `step` nm from the start of the grid. */
export function stepIndices(lambda, step) {
  if (!lambda.length) return [];
  if (!(step > 0) || lambda.length < 2) return lambda.map((_, i) => i);
  const dl = (lambda[lambda.length - 1] - lambda[0]) / (lambda.length - 1);
  const out = [];
  let last = -1;
  for (let lam = lambda[0]; lam <= lambda[lambda.length - 1] + 1e-9; lam += step) {
    const i = Math.min(lambda.length - 1, Math.round((lam - lambda[0]) / dl));
    if (i !== last) out.push(i);
    last = i;
  }
  return out;
}

// A stepped table longer than this flows into side-by-side copies.
const TABLE_FLOW_ROWS = 30;

/** A sampled table, flowed into up to three columns when it is narrow and long. */
export function stepTable(headers, rows) {
  const ncol = headers.length <= 4 ? Math.min(3, Math.max(1, Math.ceil(rows.length / TABLE_FLOW_ROWS))) : 1;
  const align = headers.map(() => 'r');
  return flow(splitRows(rows, ncol).map(slice => table(headers, slice, { align })));
}

export function angleSuffix(sp, s) {
  return sp.series.length > 1 ? ` ${deg(s.theta)}°` : '';
}

/** Plot series for one design: a curve per enabled quantity per angle. */
export function spectrumSeries(sp, curves, axes) {
  const series = [];
  const x = sp.lambda.map(axes.x);
  sp.series.forEach((s, si) => {
    for (const cv of curves) {
      if (!s[cv.key]) continue;
      series.push({ x, y: s[cv.key].map(axes.y), color: cv.color, label: cv.key + angleSuffix(sp, s), dash: dashFor(si) });
    }
  });
  return series;
}

function spectrumTable(sp, curves, step, axes) {
  const headers = [axes.xHeader];
  const cols = [];
  for (const s of sp.series) {
    for (const cv of curves) {
      if (!s[cv.key]) continue;
      headers.push(`${cv.key}${angleSuffix(sp, s)}${axes.yTag}`);
      cols.push(s[cv.key]);
    }
  }
  const rows = stepIndices(sp.lambda, step).map(i => [axes.formatX(sp.lambda[i]), ...cols.map(arr => axes.formatY(arr[i]))]);
  return stepTable(headers.map(escapeHtml), rows);
}

export function spectrumPlot(series, settings, axes) {
  const height = plotHeight(settings.plot);
  if (height <= 0 || !series.length) return '';
  return `<div class="tf-plot">${lineChartSVG({
    width: 720, height, series, xLabel: axes.xLabel, yLabel: axes.yLabel, ...axes.yRange,
  })}</div>`;
}

function caption(sp, tr) {
  const modes = tr?.evalModes || {};
  return note(`${escapeHtml(tt(tr, 'aoi', 'AOI'))} ${sp.series.map(s => `${deg(s.theta)}°`).join(', ')}`
    + ` · ${escapeHtml(tt(tr, 'evaluation', 'Evaluation'))} ${escapeHtml(modes[sp.evalMode] || sp.evalMode)}`);
}

// The range covered, in the block's unit; a unit that runs the other way to
// wavelength still reads low to high.
function rangeSubtitle(sp, axes) {
  if (!sp.lambda.length) return '';
  const ends = [sp.lambda[0], sp.lambda[sp.lambda.length - 1]].map(axes.x).sort((a, b) => a - b);
  return `${axes.formatValue(ends[0])}-${axes.formatValue(ends[1])} ${axes.unitShort}`;
}

export function buildSpectrum({ data, block, settings, tr }) {
  const title = blockTitle(tr, 'spectrum', 'Spectrum');
  const sp = data.blocks[block.id];
  if (!sp) return wrap('spectrum', title, errNote('not computed'));
  if (sp.error) return wrap('spectrum', title, errNote(sp.error));
  const axes = spectrumAxes(settings, tr);
  const curves = enabledCurves(settings);
  const withTable = settings.tableStep > 0 && curves.length > 0;
  const inner = spectrumPlot(spectrumSeries(sp, curves, axes), settings, axes)
    + caption(sp, tr)
    + (withTable ? spectrumTable(sp, curves, settings.tableStep, axes) : '');
  return wrap('spectrum', title, inner, { subtitle: escapeHtml(rangeSubtitle(sp, axes)), breakable: withTable });
}
