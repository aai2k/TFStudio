import { getLocale } from '../../../../constants/locales.js';
import { gatherDesignData } from '../../../../utils/report/reportData.js';
import { composeReport } from '../../../../utils/report/template.js';
import { REPORT_SECTIONS } from '../../../../utils/report/sections.js';

export function todayISO() {
  // Renderer context — Date is available (this is not a workflow script).
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Comma/space-separated AOI list → number[] (0..89, deduped). Empty → [0].
export function parseAoiList(str, fallback = 0) {
  const xs = String(str || '').split(/[,\s]+/).map(s => parseFloat(s))
    .filter(v => Number.isFinite(v) && v >= 0 && v < 90)
    .map(v => Math.round(v * 10) / 10);
  const out = [...new Set(xs)];
  return out.length ? out : [fallback];
}

// Sections (ordered) — start from the catalogue order honoring defaultOn.
export function initialSections() {
  return REPORT_SECTIONS.map(s => ({ id: s.id, on: s.defaultOn }));
}

export function initialPerSection() {
  return {
    'design-summary': { optical: false, materialsTable: false },
    'optical-eval': { curves: ['T', 'R'], includeTable: false,
                      lambdaStart: 400, lambdaEnd: 800, lambdaStep: 2, thetas: [0] },
    'color-eval':   { characteristic: 'R', observer: '2', illuminant: 'D65', step: 5 },
    'integral-values': { aoi: 0, pol: 'avg' },
    'ri-profile':   { lambda: null },
    'efield':       { pol: 's', lambda: null },
    'ellipsometry': { thetas: [65], lambdaStart: 400, lambdaEnd: 800, lambdaStep: 5, quantity: 'both' },
    'notes':        {},
  };
}

export function initialCover(folderName) {
  return {
    title: '', subtitle: '', customer: '', project: folderName || '',
    designer: '', date: todayISO(), logoDataUrl: null,
  };
}

// The locale object whose t.report drives the OUTPUT document strings.
export function resolveReportLocale(lang) {
  const loc = getLocale(lang) || {};
  const rep = loc.report || {};
  return { ...rep, kinds: (loc.specification && loc.specification.kinds) || {} };
}

export function sectionTitleOf(id, reportTr, W) {
  return (reportTr.sectionTitles && reportTr.sectionTitles[id]) || (W.sectionNames && W.sectionNames[id]) || id;
}

// Build the report document from the numbers gathered from the same
// validated engines as the analysis windows (utils/report/reportData.js),
// composed as a single self-contained HTML string (utils/report/template.js).
export function buildReportDocument({ chosenDesigns, orderedSectionIds, perSection, lang, reportTr, cover }) {
  const renderList = chosenDesigns.map(design => ({
    design,
    data: gatherDesignData(design, orderedSectionIds, perSection),
  }));
  return composeReport({
    lang, tr: reportTr,
    sections: orderedSectionIds, perSection,
    cover: { ...cover },
    designs: renderList,
    meta: { appName: 'TFStudio', generatedAt: cover.date || todayISO() },
  });
}

export function presetPayload({ presetName, sections, perSection, lang, format, cover }) {
  return {
    name: presetName.trim(),
    sections, perSection, lang, format,
    cover: { ...cover, logoDataUrl: undefined }, // logo not stored in preset
  };
}
