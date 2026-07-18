/**
 * Table- and plot-based report section builders (color, integrals, qualifiers,
 * merit, RI profile, E-field, ellipsometry, notes).
 *
 * Each takes the report context { data, opts, tr } and returns one <section>'s
 * HTML. A section whose data carries an `{ error }` renders a note instead.
 */

import { lineChartSVG, escapeHtml } from '../svgChart.js';
import { pct, num, deg, tt, sectionTitle, errNote, wrap, table } from './format.js';

export function buildColor({ data, tr }) {
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

export function buildIntegrals({ data, tr }) {
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

export function buildQualifiers({ data, tr }) {
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

export function buildMerit({ data, tr }) {
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

export function buildRiProfile({ data, tr }) {
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

export function buildEField({ data, tr }) {
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

export function buildEllipsometry({ data, opts, tr }) {
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

export function buildNotes({ design, opts, tr }) {
  const title = sectionTitle(tr, 'notes', 'Notes');
  const L = tr || {};
  const text = (opts && opts.text != null) ? opts.text : (design.notes || '');
  const body = text.trim()
    ? `<div class="tf-notes">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`
    : `<p class="tf-note">${escapeHtml(tt(L, 'noNotes', 'No notes.'))}</p>`;
  return wrap('notes', title, body);
}
