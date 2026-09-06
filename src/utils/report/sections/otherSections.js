/**
 * Table- and plot-based block builders: color, integrals, qualifiers, merit
 * operands, n(z) profile, |E|² profile, notes and signatures.
 *
 * Each takes the block context { design, data, block, settings, tr, designName }
 * and returns one <section>'s HTML. A block whose data carries an `{ error }`
 * renders a note instead.
 */

import { lineChartSVG, escapeHtml } from '../svgChart.js';
import {
  pct, num, deg, tt, blockTitle, errNote, wrap, table, note, plotHeight, subtitleOf,
} from './format.js';

/** The block's computed data, or the section to render when there is none. */
export function blockData(ctx, type, title) {
  const d = ctx.data.blocks[ctx.block.id];
  if (!d) return { fail: wrap(type, title, errNote('not computed'), { subtitle: subtitleOf(ctx) }) };
  if (d.error) return { fail: wrap(type, title, errNote(d.error), { subtitle: subtitleOf(ctx) }) };
  return { d };
}

/** The color block's rows, shared with the comparison table. */
export function colorRows(r, tr) {
  const L = tr || {};
  let dominant = num(null);
  if (r.dom?.dom != null) dominant = `${num(r.dom.dom, 1)} nm (${tt(L, 'purity', 'purity')} ${num(r.dom.purity * 100, 1)}%)`;
  else if (r.dom?.comp != null) dominant = `${tt(L, 'compl', 'compl.')} ${num(r.dom.comp, 1)} nm`;
  return [
    ['x, y, Y', `${num(r.xy.x, 4)}, ${num(r.xy.y, 4)}, ${num(r.XYZ.Y, 3)}`],
    ['L*, a*, b*', `${num(r.Lab.L, 2)}, ${num(r.Lab.a, 2)}, ${num(r.Lab.b, 2)}`],
    ['C*ab, h°ab', `${num(r.Lab.C, 2)}, ${num(r.Lab.h, 1)}°`],
    ["u', v'", `${num(r.uvP.up, 4)}, ${num(r.uvP.vp, 4)}`],
    [tt(L, 'dominantWl', 'Dominant λ'), dominant],
    ['CCT', `${num(r.cct?.cct, 0)} K (Duv ${num(r.cct?.duv, 4)})`],
  ];
}

export function colorCaption(cdata, tr) {
  const L = tr || {};
  const quantity = cdata.characteristic === 'T' ? tt(L, 'transmittance', 'Transmittance') : tt(L, 'reflectance', 'Reflectance');
  return `${escapeHtml(quantity)} · ${escapeHtml(cdata.observer)}° · ${escapeHtml(cdata.illuminant)} · ${escapeHtml(tt(L, 'aoi', 'AOI'))} ${deg(cdata.theta)}°`;
}

export function buildColor(ctx) {
  const { tr } = ctx;
  const title = blockTitle(tr, 'color', 'Color');
  const { d: cdata, fail } = blockData(ctx, 'color', title);
  if (fail) return fail;
  const r = cdata.report;
  const swatch = `<div class="tf-swatch" style="background:${escapeHtml(r.rgb)}"></div>`;
  const rows = table([tt(tr, 'quantity', 'Quantity'), tt(tr, 'value', 'Value')].map(escapeHtml),
    colorRows(r, tr).map(([k, v]) => [escapeHtml(k), escapeHtml(v)]), { align: ['l', 'r'] });
  const inner = `<div class="tf-cols"><div class="tf-swatch-wrap">${swatch}</div><div>${rows}</div></div>`;
  return wrap('color', title, inner, { subtitle: subtitleOf(ctx, colorCaption(cdata, tr)) });
}

export function buildIntegrals(ctx) {
  const { tr } = ctx;
  const title = blockTitle(tr, 'integrals', 'Integral values');
  const { d: iv, fail } = blockData(ctx, 'integrals', title);
  if (fail) return fail;
  const rows = iv.defs.map(def => {
    const v = iv.values[def.key];
    return [escapeHtml(def.label || def.key), v ? pct(v.value, 2) + ' %' : num(null)];
  });
  const sub = `${escapeHtml(tt(tr, 'aoi', 'AOI'))} ${deg(iv.theta)}° · ${escapeHtml(iv.pol)}`;
  return wrap('integrals', title,
    table([tt(tr, 'quantity', 'Quantity'), tt(tr, 'value', 'Value')].map(escapeHtml), rows, { align: ['l', 'r'] }),
    { subtitle: subtitleOf(ctx, sub) });
}

export function verdictMark(pass) {
  if (pass === true) return '<span class="tf-pass">✔</span>';
  if (pass === false) return '<span class="tf-fail">✘</span>';
  return '<span class="tf-skip">–</span>';
}

export function qualifierLabel(ql, tr) {
  const L = tr || {};
  return ql.label || (L.kinds && L.kinds[ql.kind]) || ql.kind;
}

function verdictBanner(v, tr) {
  if (v.total === 0) return '';
  const cls = v.allPass ? 'tf-pass' : 'tf-fail';
  const text = v.allPass ? tt(tr, 'allPass', 'All requirements met') : tt(tr, 'someFail', 'Some requirements not met');
  return `<p class="tf-verdict ${cls}">${escapeHtml(text)} (${v.passing}/${v.total})</p>`;
}

export function buildQualifiers(ctx) {
  const { tr } = ctx;
  const title = blockTitle(tr, 'qualifiers', 'Specification');
  const { d: q, fail } = blockData(ctx, 'qualifiers', title);
  if (fail) return fail;
  if (!q.qualifiers.length) {
    return wrap('qualifiers', title, note(escapeHtml(tt(tr, 'noQualifiers', 'No design requirements defined.'))), { subtitle: subtitleOf(ctx) });
  }
  const rows = q.qualifiers.map((ql, i) => {
    const r = q.results[i] || {};
    return [escapeHtml(qualifierLabel(ql, tr)), escapeHtml(r.displayValue || num(null)), escapeHtml(r.summary || ''), verdictMark(r.pass)];
  });
  const headers = [tt(tr, 'requirement', 'Requirement'), tt(tr, 'value', 'Value'), tt(tr, 'detail', 'Detail'), tt(tr, 'verdict', 'Verdict')].map(escapeHtml);
  return wrap('qualifiers', title, verdictBanner(q.verdict, tr) + table(headers, rows, { align: ['l', 'r', 'l', 'l'] }),
    { subtitle: subtitleOf(ctx) });
}

function operandRange(op) {
  if (op.lambdaStart == null) return num(null);
  return op.lambdaStart === op.lambdaEnd ? num(op.lambdaStart, 0) : `${num(op.lambdaStart, 0)}-${num(op.lambdaEnd, 0)}`;
}

export function buildMerit(ctx) {
  const { tr } = ctx;
  const title = blockTitle(tr, 'merit', 'Merit function operands');
  const { d: m, fail } = blockData(ctx, 'merit', title);
  if (fail) return fail;
  if (!m.length) {
    return wrap('merit', title, note(escapeHtml(tt(tr, 'noOperands', 'No merit-function operands defined.'))), { subtitle: subtitleOf(ctx) });
  }
  const rows = m.map(op => [
    `${op.index}`, escapeHtml(op.type), operandRange(op), `${deg(op.aoi)}°`, escapeHtml(op.pol),
    op.target != null ? num(op.target, 4) : num(null), num(op.weight, 2),
  ]);
  const headers = ['#', tt(tr, 'type', 'Type'), 'λ, nm', tt(tr, 'aoi', 'AOI'), tt(tr, 'pol', 'Pol'),
                   tt(tr, 'target', 'Target'), tt(tr, 'weight', 'Weight')].map(escapeHtml);
  return wrap('merit', title, table(headers, rows, { align: ['r', 'l', 'r', 'r', 'l', 'r', 'r'] }), { subtitle: subtitleOf(ctx) });
}

// A depth profile as one plot, or nothing when the block's plot is switched off.
function profilePlot(series, xLabel, yLabel, settings) {
  const height = plotHeight(settings.plot);
  if (height <= 0) return '';
  return `<div class="tf-plot">${lineChartSVG({ width: 720, height, series, xLabel, yLabel })}</div>`;
}

export function buildRiProfile(ctx) {
  const { tr, settings } = ctx;
  const title = blockTitle(tr, 'riProfile', 'Refractive index profile');
  const { d: rp, fail } = blockData(ctx, 'riProfile', title);
  if (fail) return fail;
  if (!rp.z || !rp.z.length) return wrap('riProfile', title, note(escapeHtml(tt(tr, 'noLayers', 'No layers'))), { subtitle: subtitleOf(ctx) });
  const plot = profilePlot([{ x: rp.z, y: rp.n, color: '#6a1b9a', label: 'n', step: true }],
    tt(tr, 'depthNm', 'Depth z, nm'), 'n', settings);
  return wrap('riProfile', title, plot, { subtitle: subtitleOf(ctx, `λ ${num(rp.lambda, 1)} nm`) });
}

export function buildEField(ctx) {
  const { tr, settings } = ctx;
  const title = blockTitle(tr, 'efield', 'Electric field');
  const { d: ef, fail } = blockData(ctx, 'efield', title);
  if (fail) return fail;
  if (!ef.z || !ef.z.length) return wrap('efield', title, note(escapeHtml(tt(tr, 'noLayers', 'No layers'))), { subtitle: subtitleOf(ctx) });
  const plot = profilePlot([{ x: ef.z, y: ef.e2, color: '#00838f', label: '|E|²' }],
    tt(tr, 'depthNm', 'Depth z, nm'), '|E|²', settings);
  const sub = `λ ${num(ef.lambda, 1)} nm · ${escapeHtml(tt(tr, 'aoi', 'AOI'))} ${deg(ef.theta)}° · ${escapeHtml(ef.pol)}`;
  return wrap('efield', title, plot, { subtitle: subtitleOf(ctx, sub) });
}

export function buildNotes(ctx) {
  const { design, settings, tr } = ctx;
  const title = blockTitle(tr, 'notes', 'Notes');
  const text = (settings.text && settings.text.trim()) ? settings.text : (design.notes || '');
  const body = text.trim()
    ? `<div class="tf-notes">${escapeHtml(text)}</div>`
    : note(escapeHtml(tt(tr, 'noNotes', 'No notes.')));
  return wrap('notes', title, body, { subtitle: subtitleOf(ctx) });
}

export function buildSignatures(ctx) {
  const { tr } = ctx;
  const title = blockTitle(tr, 'signatures', 'Signatures');
  const roles = [tt(tr, 'prepared', 'Prepared'), tt(tr, 'checked', 'Checked'), tt(tr, 'approved', 'Approved')];
  const line = escapeHtml(tt(tr, 'nameDate', 'name, date'));
  const inner = `<div class="tf-sign">${roles.map(r => `<div>${escapeHtml(r)} · ${line}</div>`).join('')}</div>`;
  return wrap('signatures', title, inner);
}
