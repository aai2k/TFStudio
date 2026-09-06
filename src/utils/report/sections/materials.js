/**
 * Materials block: every material in the design with n and k at the reference
 * wavelength, as one legend line by default or as a table on request.
 */

import { escapeHtml } from '../svgChart.js';
import { num, tt, blockTitle, errNote, wrap, table, note, cull, chip } from './format.js';

/** One material as `chip name n k`, shared with the comparison form. */
export function materialLegendItem(m) {
  const k = m.k > 0 ? ` k ${num(m.k, 5)}` : '';
  return `<span class="tf-legend-item">${chip(m.color)}${escapeHtml(cull(m.name, 24))} <span class="tf-nk">n ${num(m.n, 4)}${k}</span></span>`;
}

/** Materials as a table of name, n and k, shared with the comparison form. */
export function materialsTable(materials, tr) {
  return table([escapeHtml(tt(tr, 'material', 'Material')), 'n', 'k'],
    materials.map(m => [chip(m.color) + escapeHtml(cull(m.name, 28)), num(m.n, 4), num(m.k, 5)]),
    { align: ['l', 'r', 'r'] });
}

function materialsAt(tr, lam) {
  return typeof tr?.materialsAt === 'function' ? tr.materialsAt(lam) : `n and k at ${lam} nm`;
}

export function buildMaterials({ data, settings, tr }) {
  const s = data.summary;
  const title = blockTitle(tr, 'materials', 'Materials');
  if (!s) return wrap('materials', title, errNote('no design data'));
  const subtitle = escapeHtml(materialsAt(tr, num(s.referenceWavelength, 0)));
  if (!s.materials.length) return wrap('materials', title, note(escapeHtml(tt(tr, 'noLayers', 'No layers'))), { subtitle });

  const inner = settings.table
    ? materialsTable(s.materials, tr)
    : `<p class="tf-legend">${s.materials.map(materialLegendItem).join('')}</p>`;
  return wrap('materials', title, inner, { subtitle });
}
