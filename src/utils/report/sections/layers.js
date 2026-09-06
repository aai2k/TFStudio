/**
 * Layer table block.
 *
 * A long stack is the report's density problem: one row per layer at full page
 * width put a hundred-layer design on a page and a half. The table therefore
 * flows into side-by-side columns once it is long enough to save height, and
 * can group identical periods (see ./layerGroups.js).
 *
 * Layers are numbered as the Design Editor numbers them: layer 1 is next to
 * the substrate, on both sides. The page says so under the table.
 */

import { escapeHtml } from '../svgChart.js';
import {
  num, tt, blockTitle, errNote, wrap, h3, table, splitRows, flow, matCell, note,
} from './format.js';
import { groupPeriods } from './layerGroups.js';

// Vector padlock for a locked layer, so the printed report does not depend on
// the OS emoji font.
export const LOCK_SVG = '<svg class="tf-lock" width="9" height="9" viewBox="0 0 16 16" fill="none">'
  + '<path d="M5 7V5.2a3 3 0 0 1 6 0V7" stroke="#777" stroke-width="1.5"></path>'
  + '<rect x="3.25" y="7" width="9.5" height="6.75" rx="1.4" fill="#777"></rect></svg>';

// Rows per column before the table flows into another column, and the most
// columns a field set fits across an A4 page: three of the four-field table,
// two of the seven-field one.
const ROWS_PER_COLUMN = 34;

/** How many side-by-side columns a layer table of `count` rows is set in. */
export function layerColumnCount(count, extended, columns = 'auto') {
  if (columns !== 'auto' && columns != null) {
    return Math.min(4, Math.max(1, Math.round(Number(columns)) || 1));
  }
  const max = extended ? 2 : 3;
  return Math.min(max, Math.max(1, Math.ceil(count / ROWS_PER_COLUMN)));
}

function layerHeaders(tr, extended) {
  const headers = ['#', escapeHtml(tt(tr, 'material', 'Material')), escapeHtml(tt(tr, 'dNm', 'd, nm'))];
  const align = ['r', 'l', 'r'];
  if (extended) { headers.push('n', escapeHtml(tt(tr, 'otNm', 'OT, nm'))); align.push('r', 'r'); }
  headers.push('QWOT'); align.push('r');
  if (extended) { headers.push('FWOT'); align.push('r'); }
  return { headers, align };
}

function thicknessCell(l) {
  return num(l.thickness, 2) + (l.locked ? LOCK_SVG : '');
}

function layerCells(l, extended) {
  const cells = [String(l.index), matCell(l), thicknessCell(l)];
  if (extended) cells.push(num(l.n, 4), num(l.ot, 1));
  cells.push(num(l.qwot, 3));
  if (extended) cells.push(num(l.fwot, 3));
  return cells;
}

function plainTable(layers, settings, tr) {
  const { headers, align } = layerHeaders(tr, settings.extended);
  const ncol = layerColumnCount(layers.length, settings.extended, settings.columns);
  return flow(splitRows(layers, ncol).map(slice =>
    table(headers, slice.map(l => layerCells(l, settings.extended)), { align })));
}

function groupRow(g) {
  const range = g.from === g.to ? String(g.from) : `${g.from}-${g.to}`;
  const period = g.period.map(l => matCell(l)).join(' / ');
  const structure = g.repeats > 1 ? `(${period}) × ${g.repeats}` : period;
  const d = g.period.map(thicknessCell).join(' / ');
  const total = g.repeats * g.period.reduce((sum, l) => sum + (l.thickness || 0), 0);
  return [range, structure, d, num(total, 1)];
}

function groupedTable(layers, tr) {
  const headers = [tt(tr, 'layersCol', 'Layers'), tt(tr, 'structure', 'Structure'),
                   tt(tr, 'dNm', 'd, nm'), tt(tr, 'totalNm', 'Total, nm')].map(escapeHtml);
  return table(headers, groupPeriods(layers, 2).map(groupRow), { align: ['l', 'l', 'r', 'r'] });
}

function coatingTable(layers, settings, tr) {
  return settings.groupPeriods ? groupedTable(layers, tr) : plainTable(layers, settings, tr);
}

// Both coatings under their own heading, or the one coating the design has.
function coatingsHtml(s, settings, tr) {
  if (!s.front.length && !s.back.length) return note(escapeHtml(tt(tr, 'noLayers', 'No layers')));
  if (s.front.length && !s.back.length) return coatingTable(s.front, settings, tr);
  const word = escapeHtml(tt(tr, 'layersWord', 'layers'));
  const side = (layers, name, total) => layers.length
    ? h3(name, `${layers.length} ${word} · ${num(total, 1)} nm`) + coatingTable(layers, settings, tr)
    : '';
  return side(s.front, tt(tr, 'frontCoating', 'Front coating'), s.frontThickness)
       + side(s.back, tt(tr, 'backCoating', 'Back coating'), s.backThickness);
}

function tableNotes(s, settings, tr) {
  const notes = [escapeHtml(tt(tr, 'orderNote', 'Layer 1 is next to the substrate.'))];
  if ([...s.front, ...s.back].some(l => l.locked)) notes.push(LOCK_SVG + ' ' + escapeHtml(tt(tr, 'lockedNote', 'thickness locked')));
  if (settings.groupPeriods) notes.push(escapeHtml(tt(tr, 'groupedNote', 'Identical periods are grouped; only rows identical at the printed precision merge.')));
  return note(notes.join(' · '));
}

export function buildLayers({ data, settings, tr }) {
  const s = data.summary;
  const title = blockTitle(tr, 'layers', 'Layer table');
  if (!s) return wrap('layers', title, errNote('no design data'));
  const word = escapeHtml(tt(tr, 'layersWord', 'layers'));
  const count = `${s.frontCount}${s.backCount ? ' + ' + s.backCount : ''} ${word}`;
  const subtitle = `${count} · ${escapeHtml(tt(tr, 'qwotAt', 'QWOT at'))} ${num(s.referenceWavelength, 0)} nm · ${num(s.totalThickness, 1)} nm`;
  return wrap('layers', title, coatingsHtml(s, settings, tr) + tableNotes(s, settings, tr), { subtitle, breakable: true });
}

/**
 * The compact recipe used when several designs sit side by side: number,
 * material and thickness, with the optical thickness columns when `extended`
 * is set, or the grouped form when `groupPeriods` is.
 */
export function recipeTable(layers, tr, settings = {}) {
  if (settings.groupPeriods) return groupedTable(layers, tr);
  const headers = ['#', escapeHtml(tt(tr, 'material', 'Material')), escapeHtml(tt(tr, 'dNm', 'd, nm'))];
  const align = ['r', 'l', 'r'];
  if (settings.extended) {
    headers.push('n', escapeHtml(tt(tr, 'otNm', 'OT, nm')), 'QWOT', 'FWOT');
    align.push('r', 'r', 'r', 'r');
  }
  const cells = l => {
    const row = [String(l.index), matCell(l), num(l.thickness, 2)];
    if (settings.extended) row.push(num(l.n, 4), num(l.ot, 1), num(l.qwot, 3), num(l.fwot, 3));
    return row;
  };
  return table(headers, layers.map(cells), { align });
}
