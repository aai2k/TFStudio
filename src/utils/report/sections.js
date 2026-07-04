/**
 * Report section builders.
 *
 * One builder per section. Each takes a context { design, data, opts, tr }
 * (tr = the `t.report` locale object) and returns an HTML string for a single
 * <section>. The template composes the ordered, enabled sections.
 *
 * Numeric results come pre-computed from reportData.gatherDesignData — these
 * builders only format. A section whose data carries an `{ error }` renders a
 * small note instead of throwing, so one failure never aborts the report.
 */

import { lineChartSVG, escapeHtml } from './svgChart.js';

// ── Section catalogue (id → default order / title key) ──────────────────────
// `dataKey` names the gatherDesignData field a section consumes (if any).
export const REPORT_SECTIONS = [
  { id: 'cover',           dataKey: null,            defaultOn: true },
  { id: 'design-summary',  dataKey: 'summary',       defaultOn: true },
  { id: 'optical-eval',    dataKey: 'spectrum',      defaultOn: true },
  { id: 'color-eval',      dataKey: 'color',         defaultOn: false },
  { id: 'ri-profile',      dataKey: 'riProfile',     defaultOn: false },
  { id: 'efield',          dataKey: 'efield',        defaultOn: false },
  { id: 'ellipsometry',    dataKey: 'ellipsometry',  defaultOn: false },
  { id: 'integral-values', dataKey: 'integrals',     defaultOn: false },
  { id: 'qualifiers',      dataKey: 'qualifiers',    defaultOn: false },
  { id: 'merit-function',  dataKey: 'merit',         defaultOn: false },
  { id: 'notes',           dataKey: null,            defaultOn: false },
];

// ── Format helpers ──────────────────────────────────────────────────────────
const pct = (frac, d = 3) => (frac == null || !isFinite(frac)) ? '—' : (frac * 100).toFixed(d);
const num = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d);
const deg = (t) => Number.isInteger(t) ? `${t}` : t.toFixed(1);
// Cull over-long material names so layer tables stay narrow/compact.
function cull(name, max = 18) {
  const s = String(name == null ? '' : name);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function tt(tr, key, fallback) { return (tr && tr[key] != null) ? tr[key] : fallback; }
function sectionTitle(tr, id, fallback) {
  return (tr && tr.sectionTitles && tr.sectionTitles[id]) || fallback;
}

function errNote(msg) {
  return `<p class="tf-note tf-err">⚠ ${escapeHtml(msg)}</p>`;
}

function wrap(id, title, inner) {
  return `<section class="report-section" data-section="${id}">`
       + `<h2>${escapeHtml(title)}</h2>${inner}</section>`;
}

// HTML table from a header array + row arrays (cells already escaped/formatted).
function table(headers, rows, opts = {}) {
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

// ── Builders ─────────────────────────────────────────────────────────────────

function buildDesignSummary({ data, opts, tr }) {
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

function buildOptical({ data, opts, tr }) {
  const title = sectionTitle(tr, 'optical-eval', 'Optical Evaluation');
  const sp = data.spectrum;
  if (!sp) return wrap('optical-eval', title, errNote('not computed'));
  if (sp.error) return wrap('optical-eval', title, errNote(sp.error));

  const L = tr || {};
  const o = opts || {};
  const curves = (o.curves && o.curves.length) ? o.curves : ['T', 'R'];
  const series = [];
  sp.series.forEach((s, si) => {
    const suffix = sp.series.length > 1 ? ` @${deg(s.theta)}°` : '';
    OPTICAL_CURVES.filter(cv => curves.includes(cv.key)).forEach(cv => {
      if (!s[cv.key]) return;
      series.push({
        x: sp.lambda, y: s[cv.key].map(v => v * 100),
        color: cv.color, label: cv.label + suffix,
        dash: si === 0 ? null : (si === 1 ? '4 3' : '1 3'),
      });
    });
  });

  const svg = lineChartSVG({
    width: 720, height: 320, series,
    xLabel: tt(L, 'wavelengthNm', 'Wavelength (nm)'),
    yLabel: tt(L, 'percent', '(%)'),
    yMin: 0, yMax: 100,
  });

  let dataTable = '';
  if (o.includeTable) {
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
    dataTable = table(headers, rows, { align: headers.map((_, i) => i === 0 ? '' : 'r') });
  }

  const cap = `<p class="tf-note">${escapeHtml(tt(L, 'aoi', 'AOI'))}: `
    + sp.series.map(s => `${deg(s.theta)}°`).join(', ')
    + ` · ${escapeHtml(tt(L, 'mode', 'Mode'))}: ${escapeHtml(sp.evalMode)}</p>`;

  return wrap('optical-eval', title, `<div class="tf-plot">${svg}</div>${cap}${dataTable}`);
}

function buildColor({ data, tr }) {
  const title = sectionTitle(tr, 'color-eval', 'Color Evaluation');
  const cdata = data.color;
  if (!cdata) return wrap('color-eval', title, errNote('not computed'));
  if (cdata.error) return wrap('color-eval', title, errNote(cdata.error));
  const L = tr || {};
  const r = cdata.report;

  const swatch = `<div class="tf-swatch" style="background:${escapeHtml(r.rgb)}"></div>`;
  const rows = table(
    [tt(L, 'quantity', 'Quantity'), tt(L, 'value', 'Value')],
    [
      ['x, y, Y', `${num(r.xy.x, 4)}, ${num(r.xy.y, 4)}, ${num(r.XYZ.Y, 3)}`],
      ['X, Y, Z', `${num(r.XYZ.X, 3)}, ${num(r.XYZ.Y, 3)}, ${num(r.XYZ.Z, 3)}`],
      ['L*, a*, b*', `${num(r.Lab.L, 2)}, ${num(r.Lab.a, 2)}, ${num(r.Lab.b, 2)}`],
      ['C*ab, h°ab', `${num(r.Lab.C, 2)}, ${num(r.Lab.h, 1)}°`],
      ['L*, u*, v*', `${num(r.Luv.L, 2)}, ${num(r.Luv.u, 2)}, ${num(r.Luv.v, 2)}`],
      ["u', v'", `${num(r.uvP.up, 4)}, ${num(r.uvP.vp, 4)}`],
      [tt(L, 'dominantWl', 'Dominant λ'),
        r.dom?.dom != null ? `${num(r.dom.dom, 1)} nm (${tt(L, 'purity', 'purity')} ${num(r.dom.purity * 100, 1)}%)`
        : r.dom?.comp != null ? `${tt(L, 'compl', 'compl.')} ${num(r.dom.comp, 1)} nm`
        : '—'],
      ['CCT', `${num(r.cct?.cct, 0)} K  (Duv ${num(r.cct?.duv, 4)})`],
    ]
  );
  const cap = `<p class="tf-note">${escapeHtml(cdata.characteristic === 'T' ? tt(L, 'transmittance', 'Transmittance') : tt(L, 'reflectance', 'Reflectance'))}`
    + ` · ${escapeHtml(cdata.observer)}° · ${escapeHtml(cdata.illuminant)} · AOI ${deg(cdata.theta)}°</p>`;
  return wrap('color-eval', title,
    `<div class="tf-cols"><div class="tf-swatch-wrap">${swatch}<div class="tf-note">${escapeHtml(cdata.illuminant)}</div></div><div>${rows}</div></div>${cap}`);
}

function buildIntegrals({ data, tr }) {
  const title = sectionTitle(tr, 'integral-values', 'Integral Values');
  const iv = data.integrals;
  if (!iv) return wrap('integral-values', title, errNote('not computed'));
  if (iv.error) return wrap('integral-values', title, errNote(iv.error));
  const L = tr || {};
  const rows = iv.defs.map(def => {
    const v = iv.values[def.key];
    return [escapeHtml(def.label || def.key), v ? pct(v.value, 3) + ' %' : '—'];
  });
  const cap = `<p class="tf-note">AOI ${deg(iv.theta)}° · ${escapeHtml(iv.pol)}</p>`;
  return wrap('integral-values', title,
    table([tt(L, 'quantity', 'Quantity'), tt(L, 'value', 'Value')], rows, { align: ['', 'r'] }) + cap);
}

function buildQualifiers({ data, tr }) {
  const title = sectionTitle(tr, 'qualifiers', 'Qualifiers Verdict');
  const q = data.qualifiers;
  if (!q) return wrap('qualifiers', title, errNote('not computed'));
  if (q.error) return wrap('qualifiers', title, errNote(q.error));
  const L = tr || {};
  if (!q.qualifiers.length)
    return wrap('qualifiers', title, `<p class="tf-note">${escapeHtml(tt(L, 'noQualifiers', 'No design requirements defined.'))}</p>`);

  const rows = q.qualifiers.map((ql, i) => {
    const r = q.results[i] || {};
    const mark = r.pass === true ? '<span class="tf-pass">✔</span>'
               : r.pass === false ? '<span class="tf-fail">✘</span>'
               : '<span class="tf-skip">–</span>';
    return [
      escapeHtml(ql.label || (L.kinds && L.kinds[ql.kind]) || ql.kind),
      escapeHtml(r.displayValue || '—'),
      escapeHtml(r.summary || ''),
      mark,
    ];
  });
  const v = q.verdict;
  const banner = v.total === 0 ? ''
    : v.allPass
      ? `<p class="tf-verdict tf-pass">${escapeHtml(tt(L, 'allPass', 'All requirements met'))} (${v.passing}/${v.total})</p>`
      : `<p class="tf-verdict tf-fail">${escapeHtml(tt(L, 'someFail', 'Some requirements not met'))} (${v.passing}/${v.total})</p>`;
  return wrap('qualifiers', title, banner + table(
    [tt(L, 'requirement', 'Requirement'), tt(L, 'value', 'Value'), tt(L, 'detail', 'Detail'), tt(L, 'verdict', 'Verdict')],
    rows, { align: ['', 'r', '', ''] }));
}

function buildMerit({ data, tr }) {
  const title = sectionTitle(tr, 'merit-function', 'Merit Function Operands');
  const m = data.merit;
  if (!m) return wrap('merit-function', title, errNote('not computed'));
  if (m.error) return wrap('merit-function', title, errNote(m.error));
  const L = tr || {};
  if (!m.length)
    return wrap('merit-function', title, `<p class="tf-note">${escapeHtml(tt(L, 'noOperands', 'No merit-function operands defined.'))}</p>`);
  const rows = m.map(op => [
    `${op.index}`, escapeHtml(op.type),
    (op.lambdaStart != null ? (op.lambdaStart === op.lambdaEnd ? `${num(op.lambdaStart, 0)}` : `${num(op.lambdaStart, 0)}–${num(op.lambdaEnd, 0)}`) : '—'),
    `${deg(op.aoi)}°`, escapeHtml(op.pol),
    op.target != null ? num(op.target, 4) : '—',
    num(op.weight, 2),
  ]);
  return wrap('merit-function', title, table(
    ['#', tt(L, 'type', 'Type'), 'λ (nm)', tt(L, 'aoi', 'AOI'), tt(L, 'pol', 'Pol'),
     tt(L, 'target', 'Target'), tt(L, 'weight', 'Weight')],
    rows, { align: ['', '', '', 'r', '', 'r', 'r'] }));
}

function buildRiProfile({ data, tr }) {
  const title = sectionTitle(tr, 'ri-profile', 'Refractive-Index Profile');
  const rp = data.riProfile;
  if (!rp) return wrap('ri-profile', title, errNote('not computed'));
  if (rp.error) return wrap('ri-profile', title, errNote(rp.error));
  const L = tr || {};
  if (!rp.z || !rp.z.length)
    return wrap('ri-profile', title, `<p class="tf-note">${escapeHtml(tt(L, 'noLayers', 'No layers'))}</p>`);
  const svg = lineChartSVG({
    width: 720, height: 260,
    series: [{ x: rp.z, y: rp.n, color: '#6a1b9a', label: 'n', step: true }],
    xLabel: tt(L, 'depthNm', 'Depth z (nm)'), yLabel: 'n',
  });
  const cap = `<p class="tf-note">λ = ${num(rp.lambda, 1)} nm</p>`;
  return wrap('ri-profile', title, `<div class="tf-plot">${svg}</div>${cap}`);
}

function buildEField({ data, tr }) {
  const title = sectionTitle(tr, 'efield', 'Electric Field Profile');
  const ef = data.efield;
  if (!ef) return wrap('efield', title, errNote('not computed'));
  if (ef.error) return wrap('efield', title, errNote(ef.error));
  const L = tr || {};
  if (!ef.z || !ef.z.length)
    return wrap('efield', title, `<p class="tf-note">${escapeHtml(tt(L, 'noLayers', 'No layers'))}</p>`);
  const svg = lineChartSVG({
    width: 720, height: 300,
    series: [{ x: ef.z, y: ef.e2, color: '#00838f', label: '|E|²' }],
    xLabel: tt(L, 'depthNm', 'Depth z (nm)'), yLabel: '|E|² (norm.)',
  });
  const cap = `<p class="tf-note">λ = ${num(ef.lambda, 1)} nm · AOI ${deg(ef.theta)}° · ${escapeHtml(ef.pol)}</p>`;
  return wrap('efield', title, `<div class="tf-plot">${svg}</div>${cap}`);
}

function buildEllipsometry({ data, opts, tr }) {
  const title = sectionTitle(tr, 'ellipsometry', 'Ellipsometry');
  const e = data.ellipsometry;
  if (!e) return wrap('ellipsometry', title, errNote('not computed'));
  if (e.error) return wrap('ellipsometry', title, errNote(e.error));
  const L = tr || {};
  const o = opts || {};
  const which = o.quantity || 'both'; // 'psi' | 'delta' | 'both'

  const psiSeries = [], deltaSeries = [];
  e.series.forEach((s, si) => {
    const suffix = e.series.length > 1 ? ` @${deg(s.theta)}°` : '';
    const dash = si === 0 ? null : (si === 1 ? '4 3' : '1 3');
    psiSeries.push({ x: e.lambda, y: s.psi, color: '#1565c0', label: 'Ψ' + suffix, dash });
    deltaSeries.push({ x: e.lambda, y: s.delta, color: '#c62828', label: 'Δ' + suffix, dash });
  });

  let plots = '';
  if (which === 'psi' || which === 'both')
    plots += `<div class="tf-plot">${lineChartSVG({ width: 720, height: 240, series: psiSeries,
      xLabel: tt(L, 'wavelengthNm', 'Wavelength (nm)'), yLabel: 'Ψ (°)', yMin: 0, yMax: 90 })}</div>`;
  if (which === 'delta' || which === 'both')
    plots += `<div class="tf-plot">${lineChartSVG({ width: 720, height: 240, series: deltaSeries,
      xLabel: tt(L, 'wavelengthNm', 'Wavelength (nm)'), yLabel: 'Δ (°)', yMin: 0, yMax: 360 })}</div>`;

  const cap = `<p class="tf-note">${escapeHtml(tt(L, 'aoi', 'AOI'))}: `
    + e.series.map(s => `${deg(s.theta)}°`).join(', ') + `</p>`;
  return wrap('ellipsometry', title, plots + cap);
}

function buildNotes({ design, opts, tr }) {
  const title = sectionTitle(tr, 'notes', 'Notes');
  const L = tr || {};
  const text = (opts && opts.text != null) ? opts.text : (design.notes || '');
  const body = text.trim()
    ? `<div class="tf-notes">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`
    : `<p class="tf-note">${escapeHtml(tt(L, 'noNotes', 'No notes.'))}</p>`;
  return wrap('notes', title, body);
}

const BUILDERS = {
  'design-summary': buildDesignSummary,
  'optical-eval':   buildOptical,
  'color-eval':     buildColor,
  'integral-values':buildIntegrals,
  'qualifiers':     buildQualifiers,
  'merit-function': buildMerit,
  'ri-profile':     buildRiProfile,
  'efield':         buildEField,
  'ellipsometry':   buildEllipsometry,
  'notes':          buildNotes,
};

/** Build one section's HTML. Returns '' for unknown / cover (cover is template). */
export function buildSection(id, ctx) {
  const fn = BUILDERS[id];
  if (!fn) return '';
  try { return fn(ctx); }
  catch (e) { return wrap(id, sectionTitle(ctx.tr, id, id), errNote(e.message || String(e))); }
}
