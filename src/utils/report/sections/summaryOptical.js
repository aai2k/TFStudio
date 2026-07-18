/**
 * Design-summary and optical-evaluation section builders.
 *
 * Each takes the report context { data, opts, tr } and returns one <section>'s
 * HTML. Numeric results arrive pre-computed in `data`; these builders only format.
 */

import { lineChartSVG, escapeHtml } from '../svgChart.js';
import {
  pct, num, deg, cull, tt, sectionTitle, errNote, wrap, table,
  opticalChartSeries, opticalDataTable,
} from './format.js';

export function buildDesignSummary({ data, opts, tr }) {
  const s = data.summary;
  const title = sectionTitle(tr, 'design-summary', 'Design Summary');
  if (!s) return wrap('design-summary', title, errNote('no design data'));

  const L = tr || {};
  const o = opts || {};
  const showOptical = !!o.optical;       // add n / OT / QWOT / FWOT columns
  const showMatTable = !!o.materialsTable; // tabulate materials with n,k @ λref

  // Compact one-line facts strip (saves vertical space vs a 6-row table).
  const sub = s.substrate + (s.substrateThickness != null ? ` ${num(s.substrateThickness, 2)} mm` : '');
  const facts = `<p class="tf-facts">`
    + `<b>${escapeHtml(tt(L, 'incidentMedium', 'Incident'))}:</b> ${escapeHtml(cull(s.incidentMedium, 22))} · `
    + `<b>${escapeHtml(tt(L, 'substrate', 'Substrate'))}:</b> ${escapeHtml(cull(sub, 26))} · `
    + `<b>${escapeHtml(tt(L, 'exitMedium', 'Exit'))}:</b> ${escapeHtml(cull(s.exitMedium, 22))} · `
    + `<b>λ<sub>ref</sub>:</b> ${s.referenceWavelength != null ? num(s.referenceWavelength, 0) + ' nm' : '—'} · `
    + `<b>${escapeHtml(tt(L, 'layerCount', 'Layers'))}:</b> ${s.frontCount}${s.backCount ? '+' + s.backCount : ''} · `
    + `<b>${escapeHtml(tt(L, 'totalThickness', 'Total'))}:</b> ${num(s.totalThickness, 1)} nm</p>`;

  const headers = ['#', tt(L, 'material', 'Material'), tt(L, 'thicknessNm', 'd (nm)')];
  const align = ['', '', 'r'];
  if (showOptical) {
    headers.push('n', tt(L, 'opticalNm', 'OT (nm)'), 'QWOT', 'FWOT');
    align.push('r', 'r', 'r', 'r');
  }
  // Designed padlock glyph for locked layers (replaces the 🔒 emoji so the
  // printed report uses a clean vector mark instead of the OS emoji font).
  const LOCK_SVG = ' <svg width="9" height="9" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-left:3px">' +
    '<path d="M5 7V5.2a3 3 0 0 1 6 0V7" stroke="#777" stroke-width="1.5"/>' +
    '<rect x="3.25" y="7" width="9.5" height="6.75" rx="1.4" fill="#777"/></svg>';
  const mkRows = (layers) => layers.map(l => {
    const r = [`${l.index}`, escapeHtml(cull(l.material)),
               num(l.thickness, 2) + (l.locked ? LOCK_SVG : '')];
    if (showOptical) r.push(num(l.n, 3), num(l.ot, 1), num(l.qwot, 3), num(l.fwot, 3));
    return r;
  });

  const layerTable = s.front.length
    ? table(headers, mkRows(s.front), { align })
    : `<p class="tf-note">${escapeHtml(tt(L, 'noLayers', 'No layers'))}</p>`;

  let backTable = '';
  if (s.back.length) {
    backTable = `<h3>${escapeHtml(tt(L, 'backCoating', 'Back coating'))}</h3>`
      + table(headers, mkRows(s.back), { align });
  }

  let matsBlock;
  if (showMatTable) {
    const mrows = s.materials.map(m => [escapeHtml(cull(m.name, 28)), num(m.n, 4), num(m.k, 5)]);
    matsBlock = `<h3>${escapeHtml(tt(L, 'materials', 'Materials'))}</h3>`
      + table([tt(L, 'material', 'Material'), `n@λ<sub>ref</sub>`, `k@λ<sub>ref</sub>`], mrows, { align: ['', 'r', 'r'] });
  } else {
    const mats = s.materials.map(m => escapeHtml(cull(m.name, 24))).join(', ') || '—';
    matsBlock = `<p class="tf-note"><strong>${escapeHtml(tt(L, 'materials', 'Materials'))}:</strong> ${mats}</p>`;
  }

  const inner = facts
    + (s.front.length ? `<h3>${escapeHtml(tt(L, 'frontCoating', 'Front coating'))}</h3>` : '')
    + layerTable + backTable + matsBlock;
  return wrap('design-summary', title, inner);
}

export function buildOptical({ data, opts, tr }) {
  const title = sectionTitle(tr, 'optical-eval', 'Optical Evaluation');
  const sp = data.spectrum;
  if (!sp) return wrap('optical-eval', title, errNote('not computed'));
  if (sp.error) return wrap('optical-eval', title, errNote(sp.error));

  const L = tr || {};
  const o = opts || {};
  const curves = (o.curves && o.curves.length) ? o.curves : ['T', 'R'];

  const svg = lineChartSVG({
    width: 720, height: 320, series: opticalChartSeries(sp, curves),
    xLabel: tt(L, 'wavelengthNm', 'Wavelength (nm)'),
    yLabel: tt(L, 'percent', '(%)'),
    yMin: 0, yMax: 100,
  });

  const dataTable = o.includeTable ? opticalDataTable(sp, curves) : '';

  const cap = `<p class="tf-note">${escapeHtml(tt(L, 'aoi', 'AOI'))}: `
    + sp.series.map(s => `${deg(s.theta)}°`).join(', ')
    + ` · ${escapeHtml(tt(L, 'mode', 'Mode'))}: ${escapeHtml(sp.evalMode)}</p>`;

  return wrap('optical-eval', title, `<div class="tf-plot">${svg}</div>${cap}${dataTable}`);
}
