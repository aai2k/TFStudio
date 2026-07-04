/**
 * Report Generator engine test.
 *
 * Validates the pure report pipeline end-to-end without Electron/React:
 *   reportData.gatherDesignData → sections.buildSection → template.composeReport
 *
 * Asserts: every requested section is computed, the composed document is
 * well-formed (balanced tags, doctype, single <html>/<body>), each section's
 * marker appears, an inline SVG plot is emitted for the optical section, and a
 * deliberately broken section degrades to an inline note instead of throwing.
 *
 * Run: node tests/report_generation.mjs
 */

import { gatherDesignData } from '../src/utils/report/reportData.js';
import { composeReport, defaultSectionSelection, allSectionIds } from '../src/utils/report/template.js';
import { REPORT_SECTIONS } from '../src/utils/report/sections.js';
import { getLocale } from '../src/constants/locales.js';

let fails = 0;
const ok  = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('ok  :', msg); } };

// ── Sample design: TiO2/SiO2 AR-ish stack on BK7 with a qualifier + operand ──
const design = {
  id: 'd1', name: 'AR Test Stack',
  incidentMedium: 'Air',
  substrate: { material: 'BK7', thickness: 1.0 },
  exitMedium: 'Air',
  surfaceMode: 'front_only', mfEvalMode: 'side',
  referenceWavelength: 550,
  frontLayers: [
    { id: 'l1', material: 'TiO2', thickness: 116.7, locked: false },
    { id: 'l2', material: 'SiO2', thickness: 187.3, locked: false },
    { id: 'l3', material: 'TiO2', thickness: 90.0,  locked: true  },
  ],
  backLayers: [],
  notes: 'Sample design for report test.\nSecond line.',
  qualifiers: [
    { id: 'q1', enabled: true, kind: 'R_AVG', channel: 'R', pol: 'avg',
      lambdaStart: 450, lambdaEnd: 650, aoi: 0, cmp: 'le', target: 0.02, tol: 0 },
  ],
  meritOperands: [
    { id: 'o1', type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 },
  ],
};

const sections = ['cover', 'design-summary', 'optical-eval', 'color-eval',
                  'ri-profile', 'efield', 'ellipsometry', 'integral-values', 'qualifiers',
                  'merit-function', 'notes'];

const perSection = {
  'design-summary': { optical: true, materialsTable: true },
  'optical-eval': { curves: ['T', 'R'], includeTable: true,
                    lambdaStart: 400, lambdaEnd: 700, lambdaStep: 5, thetas: [0, 30] },
  'color-eval':   { characteristic: 'R', observer: '2', illuminant: 'D65', step: 5 },
  'ellipsometry': { thetas: [65, 70], lambdaStart: 400, lambdaEnd: 700, lambdaStep: 10, quantity: 'both' },
};

const data = gatherDesignData(design, sections, perSection);

// 1. Each requested section's data is present (cover/notes carry no data).
ok(data.summary && data.summary.frontCount === 3, 'design summary computed (3 layers)');
ok(Math.abs(data.summary.totalThickness - (116.7 + 187.3 + 90)) < 1e-6, 'total thickness summed');
ok(data.spectrum && data.spectrum.series.length === 2, 'spectrum has 2 AOI series');
ok(data.spectrum.lambda.length > 10, 'spectrum λ grid populated');
ok(data.color && data.color.report && isFinite(data.color.report.Lab.L), 'color Lab computed');
ok(data.integrals && data.integrals.values.Tvis && isFinite(data.integrals.values.Tvis.value), 'Tvis integral computed');
ok(data.qualifiers && data.qualifiers.results.length === 1, 'qualifier evaluated');
ok(typeof data.qualifiers.results[0].pass === 'boolean', 'qualifier has a boolean verdict');
ok(Array.isArray(data.merit) && data.merit.length === 1, 'merit operands summarised');
ok(data.riProfile && data.riProfile.z.length > 0, 'RI profile computed');
ok(data.efield && data.efield.z.length > 0, 'E-field profile computed');
ok(data.ellipsometry && data.ellipsometry.series.length === 2, 'ellipsometry: 2 AOI series');
ok(data.ellipsometry.series[0].psi.length === data.ellipsometry.lambda.length, 'ellipsometry Ψ sampled on λ grid');
ok(data.ellipsometry.series[0].psi.every(v => v >= 0 && v <= 90), 'ellipsometry Ψ in [0,90]°');
// Optical-thickness family: QWOT = 4·n·d/λref, OT = n·d.
const l0 = data.summary.front[0];
ok(isFinite(l0.n) && l0.n > 1, 'layer has refractive index at λref');
ok(Math.abs(l0.ot - l0.n * l0.thickness) < 1e-6, 'layer OT = n·d');
ok(Math.abs(l0.qwot - l0.ot / (data.summary.referenceWavelength / 4)) < 1e-6, 'layer QWOT = OT/(λref/4)');
ok(isFinite(data.summary.materials[0].n) && isFinite(data.summary.materials[0].k), 'materials carry n,k @ λref');

// 2. Compose the document.
const html = composeReport({
  lang: 'en', tr: {}, sections, perSection,
  cover: { title: 'AR Coating Report', customer: 'Acme Optics', designer: 'TFS', date: '2026-05-31' },
  designs: [{ design, data }],
  meta: { appName: 'TFStudio', version: '1.0.0', generatedAt: '2026-05-31' },
});

ok(html.startsWith('<!DOCTYPE html>'), 'doctype present');
ok((html.match(/<html/g) || []).length === 1, 'single <html>');
ok((html.match(/<body/g) || []).length === 1, 'single <body>');
ok((html.match(/<\/section>/g) || []).length >= 8, 'at least 8 sections closed');
ok(html.includes('data-section="design-summary"'), 'design-summary section present');
ok(html.includes('data-section="qualifiers"'), 'qualifiers section present');
ok(html.includes('<svg'), 'inline SVG plot emitted');
ok(html.includes('AR Coating Report'), 'cover title rendered');
ok(html.includes('Acme Optics'), 'cover customer rendered');
ok(html.includes('tf-masthead'), 'compact masthead used (not a full title page)');
ok(!/page-break-after:\s*always/.test(html), 'no forced cover page break');
ok(html.includes('data-section="ellipsometry"'), 'ellipsometry section present');
ok(html.includes('QWOT'), 'optical-thickness columns rendered');

// Balanced section tags
const opens = (html.match(/<section/g) || []).length;
const closes = (html.match(/<\/section>/g) || []).length;
ok(opens === closes, `balanced <section> tags (${opens} open / ${closes} close)`);

// 3. A broken section degrades gracefully (inject an error data field).
const badData = { ...data, spectrum: { error: 'synthetic failure' } };
const badHtml = composeReport({ lang: 'en', tr: {}, sections: ['optical-eval'], perSection: {},
  cover: {}, designs: [{ design, data: badData }], meta: {} });
ok(badHtml.includes('synthetic failure'), 'broken section renders error note, no throw');

// 4. Section catalogue + default selection sanity.
ok(allSectionIds().includes('cover'), 'allSectionIds includes cover');
ok(defaultSectionSelection().includes('design-summary'), 'default selection includes design summary');
ok(REPORT_SECTIONS.every(s => s.id), 'every catalogue entry has an id');

// 5. Real locale namespaces are present + drive output headings (EN + RU).
for (const code of ['en', 'ru']) {
  const loc = getLocale(code);
  ok(loc && loc.report, `getLocale('${code}').report exists`);
  ok(loc.report.sectionTitles && loc.report.sectionTitles['optical-eval'], `${code} report.sectionTitles populated`);
  ok(loc.report.wizard && loc.report.wizard.generate, `${code} report.wizard populated`);
  ok(loc.menu.exportReport, `${code} menu.exportReport string present`);
  const tr = { ...loc.report, kinds: (loc.specification && loc.specification.kinds) || {} };
  const doc = composeReport({ lang: code, tr, sections: ['optical-eval', 'qualifiers'], perSection,
    cover: { title: 'X' }, designs: [{ design, data }], meta: {} });
  ok(doc.includes(loc.report.sectionTitles['optical-eval']), `${code} localized optical heading in output`);
  ok(doc.includes(`<html lang="${code}"`), `${code} html lang attribute set`);
}

// EN and RU section headings must actually differ (proves localization, not a stub).
ok(getLocale('en').report.sectionTitles['qualifiers'] !== getLocale('ru').report.sectionTitles['qualifiers'],
   'EN and RU qualifier headings differ');

if (fails) { console.error(`\n${fails} test(s) FAILED`); process.exit(1); }
console.log('\nAll report generation tests passed.');
