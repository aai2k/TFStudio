/**
 * Monte-Carlo block: the last run the Monte-Carlo window made for the design.
 * The design curve, the mean over the trials and the ±kσ corridor as a plot,
 * the statistics per wavelength as a table, and the specification yield with
 * its 95 % interval when the run evaluated one.
 *
 * Every figure comes from the run itself: its trials, seed, error settings,
 * corridor width and geometry. What the window is set to now can differ and is
 * never read.
 */

import { lineChartSVG, escapeHtml } from '../svgChart.js';
import {
  pct, num, deg, tt, blockTitle, wrap, table, note, plotHeight, subtitleOf, splitRows, flow,
} from './format.js';
import { stepIndices } from './spectrum.js';
import { blockData } from './otherSections.js';
import { yieldBand } from '../../physics/errorAnalysis/mcResult.js';

const COLORS = { T: '#1565c0', R: '#c62828', A: '#2e7d32' };

// The run's facts in one line: trials, error settings, geometry and seed.
function runFacts(result, tr) {
  const run = result.settings;
  const dist = (tr?.mcDistribution || {})[run.distribution] || run.distribution || '';
  const parts = [
    typeof tr?.mcTrials === 'function' ? tr.mcTrials(result.nTrials) : `${result.nTrials} trials`,
    typeof tr?.mcThickness === 'function' ? tr.mcThickness(num(run.rmsRelPct, 2), num(run.rmsAbsNm, 2))
      : `thickness σ ${num(run.rmsRelPct, 2)} % + ${num(run.rmsAbsNm, 2)} nm`,
  ];
  if (run.rmsReN > 0 || run.rmsImN > 0) {
    parts.push(typeof tr?.mcIndex === 'function' ? tr.mcIndex(num(run.rmsReN, 4), num(run.rmsImN, 4))
      : `index σ ${num(run.rmsReN, 4)} (n), ${num(run.rmsImN, 4)} (k)`);
  }
  if (dist) parts.push(dist);
  parts.push(`${tt(tr, 'aoi', 'AOI')} ${deg(run.theta ?? 0)}°`, run.polarization || 'avg');
  if (result.seed != null) {
    parts.push(typeof tr?.mcSeed === 'function' ? tr.mcSeed(result.seed) : `seed ${result.seed}`);
  }
  return parts.map(escapeHtml).join(' · ');
}

function plot(result, settings, k, tr) {
  const height = plotHeight(settings.plot);
  if (height <= 0) return '';
  const color = COLORS[result.char] || '#1565c0';
  const toPct = arr => arr.map(v => v * 100);
  const series = [
    { x: result.lambda, y: toPct(result.theory), color, label: `${result.char} ${tt(tr, 'mcNominal', 'design')}` },
    { x: result.lambda, y: toPct(result.mean), color: '#555555', label: tt(tr, 'mcMean', 'mean'), dash: '4 3' },
    { x: result.lambda, y: toPct(result.lower), color: '#888888', label: `−${k}σ`, dash: '1 3' },
    { x: result.lambda, y: toPct(result.upper), color: '#888888', label: `+${k}σ`, dash: '1 3' },
  ];
  if (settings.envelope) {
    series.push({ x: result.lambda, y: toPct(result.envLower), color: '#bbbbbb', label: tt(tr, 'mcMin', 'min') },
                { x: result.lambda, y: toPct(result.envUpper), color: '#bbbbbb', label: tt(tr, 'mcMax', 'max') });
  }
  return `<div class="tf-plot">${lineChartSVG({
    width: 720, height, series, xLabel: tt(tr, 'wavelengthNm', 'Wavelength, nm'), yLabel: '%', yMin: 0, yMax: 100,
  })}</div>`;
}

function statsTable(result, settings, k, tr) {
  if (!(settings.tableStep > 0)) return '';
  const c = result.char;
  const headers = ['λ, nm', `${c} ${tt(tr, 'mcNominal', 'design')}, %`, `${c} ${tt(tr, 'mcMean', 'mean')}, %`, `σ, %`, `−${k}σ, %`, `+${k}σ, %`];
  if (settings.envelope) headers.push(`${tt(tr, 'mcMin', 'min')}, %`, `${tt(tr, 'mcMax', 'max')}, %`);
  const rows = stepIndices(result.lambda, settings.tableStep).map(i => {
    const cells = [String(Math.round(result.lambda[i] * 10) / 10), pct(result.theory[i]), pct(result.mean[i]),
      pct(result.stdev[i]), pct(result.lower[i]), pct(result.upper[i])];
    if (settings.envelope) cells.push(pct(result.envLower[i]), pct(result.envUpper[i]));
    return cells;
  });
  const align = headers.map(() => 'r');
  const ncol = headers.length <= 4 ? Math.min(2, Math.max(1, Math.ceil(rows.length / 30))) : 1;
  return flow(splitRows(rows, ncol).map(slice => table(headers.map(escapeHtml), slice, { align })));
}

function specSummary(spec, tr) {
  if (!spec || spec.yield == null) return '';
  const line = typeof tr?.mcYield === 'function'
    ? tr.mcYield(spec.passCount, spec.evaluated, num(spec.yield * 100, 1))
    : `Specification met in ${spec.passCount} of ${spec.evaluated} trials (${num(spec.yield * 100, 1)} %)`;
  const parts = [line];
  if (spec.yieldInterval) {
    const [low, high] = spec.yieldInterval.map(v => num(v * 100, 1));
    parts.push(typeof tr?.mcYieldInterval === 'function' ? tr.mcYieldInterval(low, high) : `95 % interval ${low}–${high} %`);
  }
  const cls = { pass: 'tf-pass', warn: 'tf-warn', fail: 'tf-fail' }[yieldBand(spec.yield)] || '';
  let html = `<p class="tf-verdict ${cls}">${parts.map(escapeHtml).join(' · ')}</p>`;
  const perQualifier = (spec.perQualifier || []).filter(q => q.failRate > 0);
  if (perQualifier.length) {
    html += table([escapeHtml(tt(tr, 'requirement', 'Requirement')), escapeHtml(tt(tr, 'mcFailRate', 'Fail rate'))],
      perQualifier.map(q => [escapeHtml(q.label), `${num(q.failRate * 100, 1)} %`]), { align: ['l', 'r'] });
  }
  return html;
}

export function buildMonteCarlo(ctx) {
  const { tr, settings } = ctx;
  const title = blockTitle(tr, 'monteCarlo', 'Monte-Carlo');
  const { d, fail } = blockData(ctx, 'monteCarlo', title);
  if (fail) return fail;
  if (d.missing || !d.result?.lambda?.length) {
    return wrap('monteCarlo', title, note(escapeHtml(tt(tr, 'mcNoRun',
      'No Monte-Carlo run for this design yet. Run it in the Monte-Carlo window; the block prints the last run.'))),
      { subtitle: subtitleOf(ctx) });
  }
  // The corridor is drawn as the run computed it, at the run's k.
  const k = d.result.settings.corridorSigma;
  const inner = plot(d.result, settings, k, tr)
    + note(runFacts(d.result, tr))
    + specSummary(d.result.spec, tr)
    + statsTable(d.result, settings, k, tr);
  return wrap('monteCarlo', title, inner, { subtitle: subtitleOf(ctx), breakable: settings.tableStep > 0 });
}
