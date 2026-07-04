/**
 * Report HTML composition.
 *
 * Produces a single self-contained, print-ready HTML document: inline CSS with
 * @page rules + page-break control, an inline-SVG plot per chart, and HTML
 * tables. No external assets (the optional logo is embedded as a data URL), so
 * the same string renders identically in the live preview iframe, when saved to
 * a .html file, and inside the headless print-to-PDF window.
 */

import { buildSection, REPORT_SECTIONS } from './sections.js';
import { escapeHtml } from './svgChart.js';

const REPORT_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  color: #1a1a1a; background: #f4f4f6; font-size: 12px; line-height: 1.35;
}
.tf-page {
  background: #fff; margin: 12px auto; padding: 16px 20px;
  width: 210mm; max-width: 96vw;
  box-shadow: 0 1px 6px rgba(0,0,0,0.12);
}
h2 { font-size: 14px; margin: 12px 0 5px; padding-bottom: 2px;
     border-bottom: 1.5px solid #1565c0; color: #0d3c75; }
h3 { font-size: 11.5px; margin: 7px 0 3px; color: #333; }
p { margin: 4px 0; }
.report-section { page-break-inside: avoid; margin-bottom: 4px; }
.tf-table { border-collapse: collapse; width: 100%; margin: 4px 0 6px; font-size: 11px; }
.tf-table th, .tf-table td { border: 1px solid #d4d4d4; padding: 2px 6px; text-align: left; }
.tf-table th { background: #eef3fa; font-weight: 600; }
.tf-table td.r, .tf-table th.r { text-align: right; font-variant-numeric: tabular-nums; }
.tf-table tbody tr:nth-child(even) { background: #fafbfc; }
.tf-cols { display: flex; gap: 18px; flex-wrap: wrap; }
.tf-cols > div { flex: 1; min-width: 220px; }
.tf-plot { margin: 4px 0; }
.tf-plot svg { width: 100%; height: auto; border: 1px solid #e0e0e0; }
.tf-note { font-size: 10px; color: #666; margin: 3px 0; }
.tf-facts { font-size: 11px; color: #333; margin: 4px 0 6px; line-height: 1.5; }
.tf-facts b { color: #0d3c75; }
.tf-err { color: #b71c1c; }
.tf-pass { color: #2e7d32; font-weight: 700; }
.tf-fail { color: #c62828; font-weight: 700; }
.tf-skip { color: #999; }
.tf-verdict { font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 4px; display: inline-block; margin: 4px 0; }
.tf-verdict.tf-pass { background: #e8f5e9; }
.tf-verdict.tf-fail { background: #ffebee; }
.tf-swatch { width: 72px; height: 72px; border-radius: 6px; border: 1px solid #bbb; }
.tf-swatch-wrap { flex: 0 0 auto; text-align: center; }
.tf-notes { white-space: pre-wrap; font-size: 11px; }
/* Compact masthead at the top of page 1 (no dedicated cover page). */
.tf-masthead { display: flex; align-items: center; gap: 16px;
  border-bottom: 2px solid #1565c0; padding-bottom: 8px; margin-bottom: 8px; }
.tf-masthead .logo { max-height: 56px; max-width: 150px; flex: 0 0 auto; }
.tf-masthead .mh-main { flex: 1; min-width: 0; }
.tf-masthead .title { font-size: 20px; font-weight: 600; color: #0d3c75; line-height: 1.2; }
.tf-masthead .subtitle { font-size: 12px; color: #555; }
.tf-masthead .meta { font-size: 11px; color: #444; text-align: right; flex: 0 0 auto; }
.tf-masthead .meta .k { color: #888; }
.tf-design-header { margin: 12px 0 3px; font-size: 16px; font-weight: 600;
  color: #0d3c75; border-bottom: 1px solid #1565c0; }
.tf-footer { margin-top: 16px; padding-top: 6px; border-top: 1px solid #ddd;
  font-size: 9px; color: #999; text-align: center; }
@page { size: A4; margin: 12mm; }
@media print {
  body { background: #fff; }
  .tf-page { box-shadow: none; margin: 0; width: auto; padding: 0; }
  .report-section { page-break-inside: avoid; }
  h2 { page-break-after: avoid; }
}
`;

function tt(tr, key, fb) { return (tr && tr[key] != null) ? tr[key] : fb; }

// Compact masthead band at the top of page 1 (replaces the old full title page).
function buildCover({ cover = {}, meta = {}, tr }) {
  const L = tr || {};
  const logo = cover.logoDataUrl
    ? `<img class="logo" src="${escapeHtml(cover.logoDataUrl)}" alt="">`
    : '';
  const rows = [];
  if (cover.customer) rows.push([tt(L, 'customer', 'Customer'), cover.customer]);
  if (cover.project)  rows.push([tt(L, 'project', 'Project'), cover.project]);
  if (cover.designer) rows.push([tt(L, 'designer', 'Designer'), cover.designer]);
  rows.push([tt(L, 'date', 'Date'), cover.date || (meta.generatedAt || '')]);
  const metaHtml = rows.map(([k, v]) =>
    `<div><span class="k">${escapeHtml(k)}:</span> ${escapeHtml(v)}</div>`).join('');
  return `<div class="tf-masthead">${logo}`
    + `<div class="mh-main">`
    + `<div class="title">${escapeHtml(cover.title || tt(L, 'defaultTitle', 'Optical Coating Report'))}</div>`
    + (cover.subtitle ? `<div class="subtitle">${escapeHtml(cover.subtitle)}</div>` : '')
    + `</div>`
    + `<div class="meta">${metaHtml}</div></div>`;
}

/**
 * Compose the full report document.
 *
 * @param {object} args
 *   lang        'en' | 'ru'  (sets <html lang>)
 *   tr          t.report locale object
 *   cover       { title, subtitle, customer, project, designer, date, logoDataUrl }
 *   sections    ordered section ids (may include 'cover' and 'notes')
 *   perSection  { [sectionId]: optionsObject }
 *   designs     [{ design, data }]  — data from gatherDesignData
 *   meta        { appName, version, generatedAt }
 * @returns {string} full HTML document
 */
export function composeReport(args) {
  const { lang = 'en', tr = {}, cover = {}, sections = [], perSection = {},
          designs = [], meta = {} } = args;

  const includeCover = sections.includes('cover');
  const bodySections = sections.filter(id => id !== 'cover');
  const multi = designs.length > 1;

  const parts = [];
  if (includeCover) parts.push(buildCover({ cover, meta, tr }));

  for (const { design, data } of designs) {
    if (multi) parts.push(`<div class="tf-design-header">${escapeHtml(design.name || 'Design')}</div>`);
    for (const id of bodySections) {
      parts.push(buildSection(id, { design, data, opts: perSection[id] || {}, tr }));
    }
  }

  const footer = `<div class="tf-footer">${escapeHtml(
      `${tt(tr, 'generatedBy', 'Generated by')} ${meta.appName || 'TFStudio'}`
      + (meta.version ? ` v${meta.version}` : '')
      + (meta.generatedAt ? ` · ${meta.generatedAt}` : ''))}</div>`;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(cover.title || tt(tr, 'defaultTitle', 'Optical Coating Report'))}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="tf-page">
${parts.join('\n')}
${footer}
</div>
</body>
</html>`;
}

// Ordered default section list (ids), respecting REPORT_SECTIONS defaultOn.
export function defaultSectionSelection() {
  return REPORT_SECTIONS.filter(s => s.defaultOn).map(s => s.id);
}
export function allSectionIds() {
  return REPORT_SECTIONS.map(s => s.id);
}
