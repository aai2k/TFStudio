/**
 * Formatting and table helpers shared by the report block builders.
 *
 * Numbers render with a fixed decimal count; a missing or non-finite value
 * prints as a dash so a gap never prints `NaN`. Cell contents handed to `table`
 * are already escaped and formatted by the caller.
 */

import { escapeHtml } from '../svgChart.js';
import { PLOT_SIZES } from '../blocks.js';

export const DASH = '–';

export const pct = (frac, d = 2) => (frac == null || !isFinite(frac)) ? DASH : (frac * 100).toFixed(d);
export const num = (v, d = 2) => (v == null || !isFinite(v)) ? DASH : v.toFixed(d);
export const deg = (t) => Number.isInteger(t) ? `${t}` : t.toFixed(1);

/** Shorten an over-long material name so a layer table stays narrow. */
export function cull(name, max = 18) {
  const s = String(name == null ? '' : name);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function tt(tr, key, fallback) { return (tr && tr[key] != null) ? tr[key] : fallback; }

export function blockTitle(tr, type, fallback) {
  return (tr && tr.sectionTitles && tr.sectionTitles[type]) || fallback;
}

export function errNote(msg) {
  return `<p class="tf-note tf-err">${escapeHtml(msg)}</p>`;
}

export function note(html) {
  return `<p class="tf-note">${html}</p>`;
}

/**
 * One block of the document: a heading, an optional small subtitle on the
 * heading's right, and the body. `breakable` lets a long block (the layer
 * table) split across pages; everything else keeps together.
 */
export function wrap(type, title, inner, { subtitle = '', breakable = false, heading = true } = {}) {
  const cls = `tf-block tf-block-${type}${breakable ? ' tf-breakable' : ''}`;
  const head = heading
    ? `<h2><span>${escapeHtml(title)}</span>${subtitle ? `<span class="tf-sub">${subtitle}</span>` : ''}</h2>`
    : '';
  return `<section class="${cls}" data-block="${type}">${head}${inner}</section>`;
}

/**
 * Heading subtitle for a block: the design's name when several designs render
 * one after another, then whatever the block adds.
 */
export function subtitleOf(ctx, extra = '') {
  const parts = [];
  if (ctx && ctx.designName) {
    const name = escapeHtml(cull(ctx.designName, 40));
    parts.push(ctx.designLabel ? `<b>${escapeHtml(ctx.designLabel)}</b> ${name}` : name);
  }
  if (extra) parts.push(extra);
  return parts.join(' · ');
}

/** Letter label of the i-th design in a comparison: A, B, …, Z, AA, AB, … */
export function designLetter(i) {
  let n = i, out = '';
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
}

/** Smaller heading inside a block, for the front and back coating. */
export function h3(text, right = '') {
  return `<h3><span>${escapeHtml(text)}</span>${right ? `<span class="tf-sub">${right}</span>` : ''}</h3>`;
}

/**
 * HTML table from a header array and row arrays (cells already escaped and
 * formatted). `align[i]` is 'r' for a numeric column. A row may be given as
 * `{ cells, cls }` to carry a class, for the heavy rule at a group boundary.
 */
export function table(headers, rows, opts = {}) {
  const align = opts.align || [];
  const th = headers.map((label, i) =>
    `<th${align[i] === 'r' ? ' class="r"' : ''}>${label}</th>`).join('');
  const trs = rows.map(row => {
    const cells = Array.isArray(row) ? row : row.cells;
    const cls = Array.isArray(row) ? '' : (row.cls ? ` class="${row.cls}"` : '');
    return `<tr${cls}>` + cells.map((cell, i) =>
      `<td${align[i] === 'r' ? ' class="r"' : ''}>${cell}</td>`).join('') + '</tr>';
  }).join('');
  const cls = opts.cls ? ` ${opts.cls}` : '';
  return `<table class="tf-table${cls}"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

/** `rows` cut into `ncol` consecutive slices of near-equal length. */
export function splitRows(rows, ncol) {
  const per = Math.ceil(rows.length / Math.max(1, ncol));
  const out = [];
  for (let k = 0; k < ncol; k++) {
    const slice = rows.slice(k * per, (k + 1) * per);
    if (slice.length) out.push(slice);
  }
  return out;
}

/** Tables laid side by side, each taking an equal share of the width. */
export function flow(tables) {
  if (tables.length === 1) return tables[0];
  return `<div class="tf-flow">${tables.join('')}</div>`;
}

/** Small color square ahead of a material name. */
export function chip(color) {
  return `<span class="tf-chip" style="background:${escapeHtml(color || '#999')}"></span>`;
}

/** Color square plus the (escaped) material name. */
export function matCell(row) {
  return chip(row.color) + escapeHtml(cull(row.material));
}

/** Plot height in px for a size id; 0 means no plot. */
export function plotHeight(size) {
  return PLOT_SIZES[size] ?? PLOT_SIZES.m;
}

/** One color per design in a comparison, in the order the designs are given. */
export const DESIGN_COLORS = ['#c62828', '#1565c0', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f', '#5d4037', '#455a64'];
