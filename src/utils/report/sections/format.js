/**
 * Formatting and table helpers shared by the report section builders.
 *
 * Numbers render with a fixed decimal count; nullish/non-finite values collapse
 * to an em-dash so a missing datum never prints `NaN`. Cell contents passed to
 * `table` are already escaped/formatted by the caller.
 */

import { escapeHtml } from '../svgChart.js';

export const pct = (frac, d = 3) => (frac == null || !isFinite(frac)) ? '—' : (frac * 100).toFixed(d);
export const num = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d);
export const deg = (t) => Number.isInteger(t) ? `${t}` : t.toFixed(1);

// Cull over-long material names so layer tables stay narrow/compact.
export function cull(name, max = 18) {
  const s = String(name == null ? '' : name);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function tt(tr, key, fallback) { return (tr && tr[key] != null) ? tr[key] : fallback; }
export function sectionTitle(tr, id, fallback) {
  return (tr && tr.sectionTitles && tr.sectionTitles[id]) || fallback;
}

export function errNote(msg) {
  return `<p class="tf-note tf-err">⚠ ${escapeHtml(msg)}</p>`;
}

export function wrap(id, title, inner) {
  return `<section class="report-section" data-section="${id}">`
       + `<h2>${escapeHtml(title)}</h2>${inner}</section>`;
}

// HTML table from a header array + row arrays (cells already escaped/formatted).
export function table(headers, rows, opts = {}) {
  const align = opts.align || [];
  const th = headers.map((h, i) =>
    `<th${align[i] === 'r' ? ' class="r"' : ''}>${escapeHtml(h)}</th>`).join('');
  const trs = rows.map(r =>
    '<tr>' + r.map((cell, i) =>
      `<td${align[i] === 'r' ? ' class="r"' : ''}>${cell}</td>`).join('') + '</tr>').join('');
  return `<table class="tf-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

// ── Curve definitions for the optical plot ──────────────────────────────────
const OPTICAL_CURVES = [
  { key: 'T', color: '#1565c0', label: 'T' },
  { key: 'R', color: '#c62828', label: 'R' },
  { key: 'A', color: '#2e7d32', label: 'A' },
];

// Per-series dash pattern: solid for the first AOI, dashed for the rest.
function seriesDash(si) {
  return si === 0 ? null : (si === 1 ? '4 3' : '1 3');
}

// Chart series for the optical plot: one entry per enabled, present curve on
// each spectrum series, with T/R/A percentages and an AOI-tagged label.
export function opticalChartSeries(sp, curves) {
  const series = [];
  sp.series.forEach((s, si) => {
    const suffix = sp.series.length > 1 ? ` @${deg(s.theta)}°` : '';
    OPTICAL_CURVES.filter(cv => curves.includes(cv.key)).forEach(cv => {
      if (!s[cv.key]) return;
      series.push({
        x: sp.lambda, y: s[cv.key].map(v => v * 100),
        color: cv.color, label: cv.label + suffix, dash: seriesDash(si),
      });
    });
  });
  return series;
}

// Sampled data table for the optical section (row count capped near 40).
export function opticalDataTable(sp, curves) {
  const step = Math.max(1, Math.ceil(sp.lambda.length / 40)); // cap rows
  const headers = ['λ (nm)'];
  const cols = [];
  sp.series.forEach((s) => {
    const suffix = sp.series.length > 1 ? ` @${deg(s.theta)}°` : '';
    OPTICAL_CURVES.filter(cv => curves.includes(cv.key)).forEach(cv => {
      if (!s[cv.key]) return;
      headers.push(cv.label + suffix);
      cols.push(s[cv.key]);
    });
  });
  const rows = [];
  for (let i = 0; i < sp.lambda.length; i += step) {
    rows.push([num(sp.lambda[i], 1), ...cols.map(arr => pct(arr[i], 3))]);
  }
  return table(headers, rows, { align: headers.map((_, i) => i === 0 ? '' : 'r') });
}
