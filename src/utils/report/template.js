/**
 * Report HTML composition.
 *
 * Produces a single self-contained, print-ready HTML document: inline CSS with
 * @page rules, an inline-SVG plot per chart, and HTML tables. No external
 * assets (the optional logo is embedded as a data URL), so the same string
 * renders identically in the live preview, when saved to a .html file, and
 * inside the headless print-to-PDF window.
 *
 * Page furniture: the first page opens with a masthead carrying the branding
 * profile and the document fields. In the HTML file a footer line closes the
 * document; the PDF carries a running header and a footer with the page number
 * instead, built by `pdfHeaderTemplate` and `pdfFooterTemplate`.
 */

import { buildBlock, buildComparisonBlock, rendersOnce } from './sections.js';
import { buildDesignKey } from './sections/comparison.js';
import { escapeHtml } from './svgChart.js';
import { DESIGN_COLORS, designLetter, cull } from './sections/format.js';

export const PAPERS = {
  A4:     { width: '210mm', pageSize: 'A4' },
  Letter: { width: '8.5in', pageSize: 'Letter' },
};

export const DEFAULT_ACCENT = '#1f3a5f';

function reportCss({ paper, accent }) {
  const p = PAPERS[paper] || PAPERS.A4;
  return `
:root { --tf-accent: ${accent}; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  color: #1a1a1a; background: #eceef1; font-size: 11px; line-height: 1.35;
}
.tf-page {
  background: #fff; margin: 12px auto; padding: 12mm 12mm 14mm;
  width: ${p.width}; max-width: 100%;
  box-shadow: 0 1px 6px rgba(0,0,0,0.12);
}
h2 { display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
     font-size: 12.5px; font-weight: 600; margin: 10px 0 4px; padding-bottom: 2px;
     border-bottom: 1px solid var(--tf-accent); color: var(--tf-accent); }
h3 { display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
     font-size: 11px; font-weight: 600; margin: 6px 0 2px; color: #333; }
.tf-sub { font-size: 9.5px; font-weight: 400; color: #6b6f76; text-align: right; }
p { margin: 3px 0; }
.tf-block { break-inside: avoid; page-break-inside: avoid; margin-bottom: 6px; }
.tf-block.tf-breakable { break-inside: auto; page-break-inside: auto; }
.tf-table { border-collapse: collapse; width: 100%; margin: 3px 0 4px; font-size: 10.5px; }
.tf-table th, .tf-table td { padding: 1px 5px; text-align: left; border-bottom: 1px solid #e3e5e9; white-space: nowrap; }
.tf-table th { background: #eef1f5; font-weight: 600; border-bottom: 1px solid #c9ced6;
  white-space: normal; vertical-align: bottom; line-height: 1.2; }
.tf-table.tf-dense { font-size: 9.5px; }
.tf-table.tf-dense th, .tf-table.tf-dense td { padding: 1px 3px; }
.tf-table td.r, .tf-table th.r { text-align: right; font-variant-numeric: tabular-nums; }
.tf-table.tf-key { width: auto; min-width: 40%; }
.tf-table.tf-key td:last-child { white-space: normal; }
.tf-block-designs { margin-bottom: 4px; }
.tf-flow { display: flex; gap: 12px; align-items: flex-start; }
.tf-flow > .tf-table { flex: 1 1 0; min-width: 0; width: auto; }
.tf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; align-items: start; }
.tf-recipe-head { font-size: 10.5px; font-weight: 600; margin: 2px 0 2px; }
.tf-recipe-side { font-size: 9.5px; color: #6b6f76; margin-top: 4px; }
.tf-cols { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.tf-cols > div { flex: 1 1 220px; min-width: 0; }
.tf-plot { margin: 3px 0; }
.tf-plot svg { width: 100%; height: auto; display: block; }
.tf-note { font-size: 9.5px; color: #666; margin: 2px 0; }
.tf-facts { display: flex; flex-wrap: wrap; gap: 3px 14px; font-size: 10.5px; color: #333; margin: 3px 0 5px; }
.tf-facts b { color: var(--tf-accent); font-weight: 600; margin-right: 3px; }
.tf-stackwrap { margin: 2px 0 4px; }
.tf-stackwrap svg { max-width: 100%; height: auto; display: block; }
.tf-chip { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
.tf-legend { display: flex; flex-wrap: wrap; gap: 3px 16px; font-size: 10.5px; margin: 3px 0; align-items: baseline; }
.tf-nk { color: #555; }
.tf-lock { vertical-align: middle; margin-left: 3px; }
.tf-err { color: #b71c1c; }
.tf-pass { color: #2e7d32; font-weight: 700; }
.tf-fail { color: #c62828; font-weight: 700; }
.tf-warn { color: #b26a00; font-weight: 700; }
.tf-skip { color: #999; }
.tf-verdict { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 3px; display: inline-block; margin: 3px 0; }
.tf-verdict.tf-pass { background: #e8f5e9; }
.tf-verdict.tf-warn { background: #fff3e0; }
.tf-verdict.tf-fail { background: #ffebee; }
.tf-swatch { width: 56px; height: 56px; border-radius: 4px; border: 1px solid #bbb; }
.tf-swatch.tf-swatch-sm { display: inline-block; width: 28px; height: 14px; vertical-align: middle; }
.tf-swatch-wrap { flex: 0 0 auto !important; }
.tf-notes { white-space: pre-wrap; font-size: 10.5px; }
.tf-sign { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; margin-top: 26px; }
.tf-sign > div { border-top: 1px solid #444; padding-top: 3px; font-size: 9.5px; color: #666; }
.tf-masthead { display: flex; align-items: center; gap: 14px;
  border-bottom: 2px solid var(--tf-accent); padding-bottom: 7px; margin-bottom: 8px; }
.tf-masthead .logo { max-height: 44px; max-width: 140px; flex: 0 0 auto; }
.tf-masthead .mh-main { flex: 1; min-width: 0; }
.tf-masthead .brand { font-size: 9.5px; color: #6b6f76; text-transform: uppercase; letter-spacing: 0.04em; }
.tf-masthead .title { font-size: 17px; font-weight: 600; color: var(--tf-accent); line-height: 1.2; }
.tf-masthead .subtitle { font-size: 10.5px; color: #555; }
.tf-masthead .meta { display: grid; grid-template-columns: auto auto; column-gap: 8px; row-gap: 1px;
  font-size: 9.5px; color: #333; text-align: right; flex: 0 0 auto; }
.tf-masthead .meta .k { color: #888; }
.tf-footer { margin-top: 14px; padding-top: 5px; border-top: 1px solid #ddd;
  font-size: 8.5px; color: #888; display: flex; justify-content: space-between; gap: 12px; }
@page { size: ${p.pageSize}; margin: 14mm 12mm 16mm; }
@media print {
  body { background: #fff; }
  .tf-page { box-shadow: none; margin: 0; width: auto; max-width: none; padding: 0; }
  .tf-footer { display: none; }
  h2, h3 { break-after: avoid; page-break-after: avoid; }
}
`;
}

function tt(tr, key, fallback) { return (tr && tr[key] != null) ? tr[key] : fallback; }

/** File-name stem for the saved report: the title, else the first design's name. */
export function reportFileBase(doc, designs) {
  const base = (doc?.title || designs?.[0]?.design?.name || designs?.[0]?.name || 'TFStudio_Report');
  return String(base).replace(/[^\p{L}\p{N}_\-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'TFStudio_Report';
}

function brandLine(brand) {
  return [brand?.company, brand?.line2].filter(s => s && String(s).trim()).map(s => escapeHtml(s)).join(' · ');
}

function metaRows(doc, tr) {
  const rows = [];
  if (doc.docNo)    rows.push([tt(tr, 'docNo', 'Doc no.'), doc.docNo]);
  if (doc.revision) rows.push([tt(tr, 'revision', 'Rev'), doc.revision]);
  if (doc.date)     rows.push([tt(tr, 'date', 'Date'), doc.date]);
  if (doc.customer) rows.push([tt(tr, 'customer', 'Customer'), doc.customer]);
  if (doc.designer) rows.push([tt(tr, 'designer', 'Designer'), doc.designer]);
  return rows;
}

// The designs covered, in one short phrase: the name of a single design, or
// how many there are. The names of several designs live in the key.
function designsPhrase(designs, tr) {
  if (designs.length === 1) return cull(designs[0].name || '', 80);
  if (designs.length === 0) return '';
  return typeof tr?.designsCount === 'function' ? tr.designsCount(designs.length) : `${designs.length} designs`;
}

// Masthead at the top of page 1: logo, brand line, title, the designs covered,
// and the document fields on the right.
function buildMasthead({ brand, doc, tr, designs }) {
  const logo = brand?.logoDataUrl
    ? `<img class="logo" src="${escapeHtml(brand.logoDataUrl)}" alt="">`
    : '';
  const line = brandLine(brand);
  const phrase = designsPhrase(designs, tr);
  const meta = metaRows(doc, tr).map(([k, v]) =>
    `<span class="k">${escapeHtml(k)}</span><span>${escapeHtml(v)}</span>`).join('');
  return `<header class="tf-masthead">${logo}`
    + `<div class="mh-main">`
    + (line ? `<div class="brand">${line}</div>` : '')
    + `<div class="title">${escapeHtml(doc.title || tt(tr, 'defaultTitle', 'Optical coating report'))}</div>`
    + (phrase ? `<div class="subtitle">${escapeHtml(phrase)}</div>` : '')
    + `</div>`
    + (meta ? `<div class="meta">${meta}</div>` : '')
    + `</header>`;
}

function generatedLine({ tr, meta, designs }) {
  const phrase = designsPhrase(designs, tr);
  return `${tt(tr, 'generatedBy', 'Generated by')} ${meta.appName || 'TFStudio'}`
    + (meta.version ? ` ${meta.version}` : '')
    + (phrase ? ` · ${phrase}` : '')
    + (meta.generatedAt ? ` · ${meta.generatedAt}` : '');
}

/**
 * Compose the full report document.
 *
 * @param {object} args
 *   lang      'en' | 'ru' | 'zh' | 'it'  (sets <html lang>)
 *   tr        t.report locale object
 *   brand     { company, line2, accent, footer, designer, logoDataUrl }
 *   doc       { title, customer, docNo, revision, date, designer }
 *   paper     'A4' | 'Letter'
 *   blocks    ordered blocks [{ id, type, on, settings }]
 *   designs   [{ design, data }], data from gatherDesignData for the same blocks
 *   meta      { appName, version, generatedAt }
 * @returns {string} full HTML document
 */
// The designs as the composer sees them: a display name, a color and, in a
// comparison, the letter the tables and legends refer to it by.
function designItems(designs) {
  return designs.map((d, i) => ({
    ...d, name: d.design?.name || d.name || `Design ${i + 1}`,
    label: designLetter(i),
    color: DESIGN_COLORS[i % DESIGN_COLORS.length],
  }));
}

// The sections one block contributes. With several designs a block renders
// once in its comparison form when it has one, else once per design.
function blockSections(block, items, tr) {
  if (block.type === 'title' || !items.length) return [];
  if (rendersOnce(block.type) || items.length === 1) {
    const first = items[0];
    return [buildBlock(block, { design: first.design, data: first.data, tr })];
  }
  const once = buildComparisonBlock(block, { designs: items, tr });
  if (once != null) return [once];
  return items.map(item => buildBlock(block, {
    design: item.design, data: item.data, tr, designName: item.name, designLabel: item.label,
  }));
}

export function composeReport(args) {
  const { lang = 'en', tr = {}, brand = {}, doc = {}, paper = 'A4', blocks = [],
          designs = [], meta = {} } = args;
  const items = designItems(designs);
  const enabled = blocks.filter(b => b.on);
  const parts = enabled.some(b => b.type === 'title') ? [buildMasthead({ brand, doc, tr, designs: items })] : [];
  if (items.length > 1) parts.push(buildDesignKey(items, tr));
  for (const block of enabled) parts.push(...blockSections(block, items, tr));

  const footer = `<footer class="tf-footer">`
    + `<span>${escapeHtml(brand.footer || '')}</span>`
    + `<span>${escapeHtml(generatedLine({ tr, meta, designs: items }))}</span></footer>`;

  const accent = /^#[0-9a-fA-F]{6}$/.test(brand.accent || '') ? brand.accent : DEFAULT_ACCENT;
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title || tt(tr, 'defaultTitle', 'Optical coating report'))}</title>
<style>${reportCss({ paper, accent })}</style>
</head>
<body>
<div class="tf-page">
${parts.join('\n')}
${footer}
</div>
</body>
</html>`;
}

const PDF_FONT = 'font-family: \'Segoe UI\', system-ui, -apple-system, sans-serif;';
const pdfBar = (left, right) =>
  `<div style="${PDF_FONT} font-size: 8px; color: #777; width: 100%; padding: 0 12mm; display: flex; justify-content: space-between; align-items: baseline;">`
  + `<span>${left}</span><span>${right}</span></div>`;

/** Running header for the PDF: the title with the document number and revision, and the date. */
export function pdfHeaderTemplate({ tr = {}, doc = {}, designs = [] }) {
  const phrase = designsPhrase(designItems(designs), tr);
  const left = [doc.title || tt(tr, 'defaultTitle', 'Optical coating report'),
    doc.docNo ? `${tt(tr, 'docNo', 'Doc no.')} ${doc.docNo}` : '',
    doc.revision ? `${tt(tr, 'revision', 'Rev')} ${doc.revision}` : '',
    !doc.title ? phrase : '']
    .filter(Boolean).map(escapeHtml).join(' · ');
  return pdfBar(left, escapeHtml(doc.date || ''));
}

/** Running footer for the PDF: the brand's footer line, the generator line, and page N of M. */
export function pdfFooterTemplate({ tr = {}, brand = {}, meta = {}, designs = [] }) {
  const items = designItems(designs);
  const left = [brand.footer, generatedLine({ tr, meta, designs: items })]
    .filter(s => s && String(s).trim()).map(escapeHtml).join(' · ');
  const number = '<span class="pageNumber"></span>';
  const total = '<span class="totalPages"></span>';
  const right = typeof tr.pageOf === 'function' ? tr.pageOf(number, total) : `Page ${number} of ${total}`;
  return pdfBar(left, right);
}
