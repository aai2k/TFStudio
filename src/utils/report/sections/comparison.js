/**
 * Blocks rendered once for several designs, with a column per design.
 *
 * A report over two or three candidates is read across, not down: the same
 * fact for every design on one row. Designs are referred to by their letter
 * (A, B, C, …) from the key under the masthead, so a long name never widens a
 * column, and a table with more designs than fit across the page is set as
 * several tables of at most MAX_COLUMNS designs each. Blocks with no comparison
 * form (profiles, ellipsometry, merit operands, notes) render per design.
 *
 * `designs` is [{ label, name, color, design, data }].
 */

import { escapeHtml } from '../svgChart.js';
import { pct, num, tt, blockTitle, errNote, wrap, table, note } from './format.js';
import { recipeTable } from './layers.js';
import { materialLegendItem, materialsTable } from './materials.js';
import { factPairs, stackDiagramSVG } from './facts.js';
import { colorRows, colorCaption, verdictMark, qualifierLabel } from './otherSections.js';

const MAX_COLUMNS = 6;

function labelCell(d) {
  return `<span class="tf-chip" style="background:${escapeHtml(d.color)}"></span>${escapeHtml(d.label)}`;
}

/**
 * Rows of `{ label, cells }`, one cell per design, as one table per group of
 * MAX_COLUMNS designs. The row label column repeats in every table.
 */
function comparisonTables(designs, rows) {
  const parts = [];
  for (let start = 0; start < designs.length; start += MAX_COLUMNS) {
    const group = designs.slice(start, start + MAX_COLUMNS);
    const headers = ['', ...group.map(labelCell)];
    const body = rows.map(r => [r.label, ...group.map((_, i) => r.cells[start + i] ?? '')]);
    parts.push(table(headers, body, { align: ['l', ...group.map(() => 'r')] }));
  }
  return parts.join('');
}

/** The key: each design's letter, color and full name. Rendered once, under the masthead. */
export function buildDesignKey(designs, tr) {
  const title = blockTitle(tr, 'designs', 'Designs');
  const rows = designs.map(d => [labelCell(d), escapeHtml(d.name)]);
  return wrap('designs', title, table(['', escapeHtml(tt(tr, 'design', 'Design'))], rows, { align: ['l', 'l'], cls: 'tf-key' }));
}

/** The design's letter in its color, heading its part of a per-design layout. */
function letterHead(d, detail = '') {
  return `<div class="tf-recipe-head" style="color:${escapeHtml(d.color)}">${escapeHtml(d.label)}${detail}</div>`;
}

export function buildFactsComparison({ designs, settings, tr }) {
  const title = blockTitle(tr, 'facts', 'Design facts');
  const columns = designs.map(d => factPairs(d.data.summary, d.data.evalMode, tr));
  const rows = columns[0].map(([key], i) => ({ label: escapeHtml(key), cells: columns.map(col => col[i]?.[1] ?? '') }));
  const diagrams = settings.stackDiagram ? designs.map(d => letterHead(d) + stackDiagramSVG(d.data.summary)).join('') : '';
  return wrap('facts', title, comparisonTables(designs, rows) + diagrams);
}

function recipeCell(d, settings, tr) {
  const s = d.data.summary;
  const word = tt(tr, 'layersWord', 'layers');
  const side = (layers, name) => layers.length
    ? (name ? `<div class="tf-recipe-side">${escapeHtml(name)}</div>` : '') + recipeTable(layers, tr, settings)
    : '';
  const body = s.front.length && s.back.length
    ? side(s.front, tt(tr, 'frontCoating', 'Front coating')) + side(s.back, tt(tr, 'backCoating', 'Back coating'))
    : side(s.front.length ? s.front : s.back, '');
  const head = letterHead(d, ` · ${s.frontCount}${s.backCount ? ' + ' + s.backCount : ''} ${escapeHtml(word)} · ${num(s.totalThickness, 0)} nm`);
  return `<div>${head}${body || note(escapeHtml(tt(tr, 'noLayers', 'No layers')))}</div>`;
}

// The block's column count is not applied here: the designs are the columns.
export function buildLayersComparison({ designs, settings, tr }) {
  const title = blockTitle(tr, 'layers', 'Layer table');
  const notes = [escapeHtml(tt(tr, 'orderNote', 'Layer 1 is next to the substrate.'))];
  if (settings.groupPeriods) notes.push(escapeHtml(tt(tr, 'groupedNote', 'Identical periods are grouped; only rows identical at the printed precision merge.')));
  const inner = `<div class="tf-grid">${designs.map(d => recipeCell(d, settings, tr)).join('')}</div>` + note(notes.join(' · '));
  return wrap('layers', title, inner, { breakable: true });
}

export function buildMaterialsComparison({ designs, settings, tr }) {
  const title = blockTitle(tr, 'materials', 'Materials');
  const parts = designs.map(d => {
    const s = d.data.summary;
    const head = `<b style="color:${escapeHtml(d.color)}">${escapeHtml(d.label)}</b> <span class="tf-nk">(${num(s.referenceWavelength, 0)} nm)</span>`;
    return settings.table
      ? `<p class="tf-legend">${head}</p>${materialsTable(s.materials, tr)}`
      : `<p class="tf-legend">${head} ${s.materials.map(materialLegendItem).join('')}</p>`;
  });
  return wrap('materials', title, parts.join(''));
}

function qualifierLabels(results, tr) {
  const labels = [];
  for (const q of results) {
    for (const ql of (q?.qualifiers || [])) {
      const label = qualifierLabel(ql, tr);
      if (!labels.includes(label)) labels.push(label);
    }
  }
  return labels;
}

function qualifierCell(q, label, tr) {
  const i = (q?.qualifiers || []).findIndex(ql => qualifierLabel(ql, tr) === label);
  if (i < 0) return num(null);
  const r = q.results[i] || {};
  return `${escapeHtml(r.displayValue || '')} ${verdictMark(r.pass)}`;
}

function verdictCell(q) {
  const v = q?.verdict;
  if (!v || v.total === 0) return num(null);
  return `<span class="${v.allPass ? 'tf-pass' : 'tf-fail'}">${v.passing}/${v.total}</span>`;
}

export function buildQualifiersComparison({ designs, block, tr }) {
  const title = blockTitle(tr, 'qualifiers', 'Specification');
  const results = designs.map(d => d.data.blocks[block.id]);
  const bad = results.find(q => q?.error);
  const labels = qualifierLabels(results, tr);
  if (bad || !labels.length) {
    return wrap('qualifiers', title, bad ? errNote(bad.error) : note(escapeHtml(tt(tr, 'noQualifiers', 'No design requirements defined.'))));
  }
  const rows = labels.map(label => ({ label: escapeHtml(label), cells: results.map(q => qualifierCell(q, label, tr)) }));
  rows.push({ label: escapeHtml(tt(tr, 'verdict', 'Verdict')), cells: results.map(verdictCell) });
  return wrap('qualifiers', title, comparisonTables(designs, rows));
}

export function buildIntegralsComparison({ designs, block, tr }) {
  const title = blockTitle(tr, 'integrals', 'Integral values');
  const results = designs.map(d => d.data.blocks[block.id]);
  const bad = results.find(iv => iv?.error);
  const first = results.find(iv => iv && iv.defs);
  if (bad || !first) return wrap('integrals', title, errNote(bad ? bad.error : 'not computed'));
  const rows = first.defs.map(def => ({
    label: escapeHtml(def.label || def.key),
    cells: results.map(iv => { const v = iv?.values?.[def.key]; return v ? pct(v.value, 2) + ' %' : num(null); }),
  }));
  const sub = `${escapeHtml(tt(tr, 'aoi', 'AOI'))} ${first.theta}° · ${escapeHtml(first.pol)}`;
  return wrap('integrals', title, comparisonTables(designs, rows), { subtitle: sub });
}

export function buildColorComparison({ designs, block, tr }) {
  const title = blockTitle(tr, 'color', 'Color');
  const results = designs.map(d => d.data.blocks[block.id]);
  const bad = results.find(cd => cd?.error);
  const first = results.find(cd => cd && cd.report);
  if (bad || !first) return wrap('color', title, errNote(bad ? bad.error : 'not computed'));
  const perDesign = results.map(cd => cd?.report ? colorRows(cd.report, tr) : null);
  const rows = colorRows(first.report, tr).map(([key], i) =>
    ({ label: escapeHtml(key), cells: perDesign.map(r => r ? escapeHtml(r[i][1]) : num(null)) }));
  rows.unshift({ label: '', cells: results.map(cd => cd?.report
    ? `<span class="tf-swatch tf-swatch-sm" style="background:${escapeHtml(cd.report.rgb)}"></span>` : '') });
  return wrap('color', title, comparisonTables(designs, rows), { subtitle: colorCaption(first, tr) });
}
