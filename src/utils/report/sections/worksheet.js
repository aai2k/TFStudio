/**
 * Monitoring worksheet block: one row per deposited layer with the chip it is
 * monitored on, the monitoring wavelength and what the monitor will see, from
 * the same engine as the Monitor Worksheet window, with every column of the
 * window's table.
 */

import { escapeHtml } from '../svgChart.js';
import { num, deg, tt, blockTitle, wrap, table, note, subtitleOf, chip, cull } from './format.js';
import { blockData } from './otherSections.js';

const pctOf = v => (v == null || !Number.isFinite(v) ? num(null) : num(v * 100, 2));

// Column key → header from the Monitor Worksheet strings (`tr.mw`) and cell.
const COLUMNS = {
  step:      { label: () => '#', align: 'r', cell: r => String(r.step) },
  chip:      { label: mw => tt(mw, 'colChip', 'Chip'), align: 'l', cell: r => `${r.chip}-${r.onChip}` },
  material:  { label: mw => tt(mw, 'colMaterial', 'Material'), align: 'l', cell: r => chip(r.color) + escapeHtml(cull(r.materialName || r.material)) },
  lambda:    { label: mw => tt(mw, 'colLambda', 'λ (nm)'), align: 'r', cell: r => String(Math.round(r.lambda)) },
  signal:    { label: mw => tt(mw, 'colSignal', 'Signal (%)'), align: 'r', cell: r => pctOf(r.signal) },
  turning:   { label: mw => tt(mw, 'colTurningPoints', 'Turning points'), align: 'r', cell: r => (r.turningPoints == null ? num(null) : String(r.turningPoints)) },
  amplitude: { label: mw => tt(mw, 'colAmplitude', 'Amplitude (%)'), align: 'r', cell: r => pctOf(r.amplitude) },
  swingIn:   { label: mw => tt(mw, 'colSwingIn', 'Swing in (%)'), align: 'r', cell: r => pctOf(r.swingIn) },
  swingOut:  { label: mw => tt(mw, 'colSwingOut', 'Swing out (%)'), align: 'r', cell: r => pctOf(r.swingOut) },
  cutoff:    { label: mw => tt(mw, 'colCutoff', 'Cutoff ratio'), align: 'r', cell: r => num(r.cutoffRatio, 3) },
  dd:        { label: mw => tt(mw, 'colTermination', 'Δd (nm)'), align: 'r', cell: (r, mw) => terminationCell(r, mw) },
  crystal:   { label: mw => tt(mw, 'colCrystal', 'Crystal (kÅ)'), align: 'r', cell: r => (r.crystalNm == null ? num(null) : num(r.crystalNm / 100, 3)) },
  initial:   { label: mw => tt(mw, 'colInitial', 'Initial level (%)'), align: 'r', cell: r => pctOf(r.initialLevel) },
};

const KEYS = Object.keys(COLUMNS);

function terminationCell(r, mw) {
  if (r.terminationErrNm == null) return `<span class="tf-skip">${escapeHtml(tt(mw, 'onTime', 'on time'))}</span>`;
  const text = Number.isFinite(r.terminationErrNm) ? num(r.terminationErrNm, 2) : '∞';
  return r.poor ? `<span class="tf-fail">${text}</span>` : text;
}

function captionOf(s, tr) {
  const mw = tr?.mw || {};
  return [
    `${tt(mw, 'measured', 'Measured')} ${s.char}`,
    `${tt(tr, 'aoi', 'AOI')} ${deg(s.theta ?? 0)}°`, s.pol,
    `${tt(mw, 'chipGlass', 'Chip glass')} ${s.chipGlass}`,
    `${tt(mw, 'witnessRatio', 'Witness ratio')} ${num(s.witnessRatio, 2)}`,
    `${tt(mw, 'signalError', 'Signal error')} ${num(s.signalErrorPct, 2)} %`,
    `${tt(mw, 'maxTermination', 'Max Δd')} ${num(s.maxTerminationErrPct, 2)} %`,
  ].map(escapeHtml).join(' · ');
}

export function buildWorksheet(ctx) {
  const { tr, data } = ctx;
  const title = blockTitle(tr, 'worksheet', 'Monitoring worksheet');
  const { d, fail } = blockData(ctx, 'worksheet', title);
  if (fail) return fail;
  if (!d.rows.length) return wrap('worksheet', title, note(escapeHtml(tt(tr, 'noLayers', 'No layers'))), { subtitle: subtitleOf(ctx) });
  const mw = tr?.mw || {};
  const colorOf = Object.fromEntries((data.summary?.front || []).map(l => [l.materialId, l.color]));
  const rows = d.rows.map(r => ({ ...r, color: colorOf[r.material] }));
  const headers = KEYS.map(k => escapeHtml(COLUMNS[k].label(mw)));
  const body = rows.map(r => KEYS.map(k => COLUMNS[k].cell(r, mw)));
  const poor = rows.filter(r => r.poor).length;
  // Thirteen columns fit the page only set small, with the headers wrapping.
  let inner = table(headers, body, { align: KEYS.map(k => COLUMNS[k].align), cls: 'tf-dense' }) + note(captionOf(d.settings, tr));
  if (poor) inner += note(`<span class="tf-fail">${escapeHtml(typeof tr?.worksheetPoor === 'function' ? tr.worksheetPoor(poor) : `${poor} layers exceed the allowed termination error`)}</span>`);
  inner += note(escapeHtml(tt(tr, 'worksheetOrder', 'Steps run in deposition order; step 1 is the layer next to the substrate.')));
  const sub = `${d.rows.length} ${escapeHtml(tt(tr, 'layersWord', 'layers'))} · ${d.chips.length} ${escapeHtml(tt(tr, 'chipsWord', 'chips'))}`;
  return wrap('worksheet', title, inner, { subtitle: subtitleOf(ctx, sub), breakable: true });
}
