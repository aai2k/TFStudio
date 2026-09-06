/**
 * Monte-Carlo block: the last run the Monte-Carlo window made for the design.
 * The design curve, the mean over the trials and the ±kσ corridor as a plot,
 * the statistics per wavelength as a table, and the specification yield when
 * the run evaluated one.
 */

import { lineChartSVG, escapeHtml } from '../svgChart.js';
import {
  pct, num, deg, tt, blockTitle, wrap, table, note, plotHeight, subtitleOf, splitRows, flow,
} from './format.js';
import { stepIndices } from './spectrum.js';
import { blockData } from './otherSections.js';
import { yieldBand } from '../../physics/errorAnalysis/mcResult.js';

const COLORS = { T: '#1565c0', R: '#c62828', A: '#2e7d32' };

function runFacts(result, settings, tr) {
  const dist = (tr?.mcDistribution || {})[settings.distribution] || settings.distribution || '';
  const parts = [
    typeof tr?.mcTrials === 'function' ? tr.mcTrials(result.nTrials) : `${result.nTrials} trials`,
    typeof tr?.mcThickness === 'function' ? tr.mcThickness(num(settings.rmsRelPct, 2), num(settings.rmsAbsNm, 2))
      : `thickness σ ${num(settings.rmsRelPct, 2)} % + ${num(settings.rmsAbsNm, 2)} nm`,
  ];
  if (settings.rmsReN > 0 || settings.rmsImN > 0) {
    parts.push(typeof tr?.mcIndex === 'function' ? tr.mcIndex(num(settings.rmsReN, 4), num(settings.rmsImN, 4))
      : `index σ ${num(settings.rmsReN, 4)} (n), ${num(settings.rmsImN, 4)} (k)`);
  }
  if (dist) parts.push(dist);
  parts.push(`${tt(tr, 'aoi', 'AOI')} ${deg(settings.theta ?? 0)}°`, settings.polarization || 'avg');
  return parts.map(escapeHtml).join(' · ');
}

function plot(result, settings, tr) {
  const height = plotHeight(settings.plot);
  if (height <= 0) return '';
  const color = COLORS[result.char] || '#1565c0';
  const toPct = arr => arr.map(v => v * 100);
  const series = [
    { x: result.lambda, y: toPct(result.theory), color, label: `${result.char} ${tt(tr, 'mcNominal', 'design')}` },
    { x: result.lambda, y: toPct(result.mean), color: '#555555', label: tt(tr, 'mcMean', 'mean'), dash: '4 3' },
    { x: result.lambda, y: toPct(result.lower), color: '#888888', label: `−${settings.corridorSigma ?? 1}σ`, dash: '1 3' },
    { x: result.lambda, y: toPct(result.upper), color: '#888888', label: `+${settings.corridorSigma ?? 1}σ`, dash: '1 3' },
  ];
  if (settings.envelope) {
    series.push({ x: result.lambda, y: toPct(result.envLower), color: '#bbbbbb', label: tt(tr, 'mcMin', 'min') },
                { x: result.lambda, y: toPct(result.envUpper), color: '#bbbbbb', label: tt(tr, 'mcMax', 'max') });
  }
  return `<div class="tf-plot">${lineChartSVG({
    width: 720, height, series, xLabel: tt(tr, 'wavelengthNm', 'Wavelength, nm'), yLabel: '%', yMin: 0, yMax: 100,
  })}</div>`;
}

function statsTable(result, settings, tr) {
  if (!(settings.tableStep > 0)) return '';
  const k = settings.corridorSigma ?? 1;
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
  const cls = { pass: 'tf-pass', warn: 'tf-warn', fail: 'tf-fail' }[yieldBand(spec.yield)] || '';
  let html = `<p class="tf-verdict ${cls}">${escapeHtml(line)}</p>`;
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
  const run = { ...(d.settings || {}), corridorSigma: d.settings?.corridorSigma ?? 1 };
  const inner = plot(d.result, { ...settings, ...run }, tr)
    + note(runFacts(d.result, run, tr))
    + specSummary(d.result.spec, tr)
    + statsTable(d.result, { ...settings, corridorSigma: run.corridorSigma }, tr);
  return wrap('monteCarlo', title, inner, { subtitle: subtitleOf(ctx), breakable: settings.tableStep > 0 });
}
