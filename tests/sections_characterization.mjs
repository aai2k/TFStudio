// Unit test for sections.js — one report section per builder.
//
// report_generation.mjs covers the assembled document; this covers each builder
// in isolation: the section wrapper it emits, its localized heading, and the
// catalogue that fixes the order and default-on state of the section list.
// Run: node tests/sections_characterization.mjs
import { REPORT_SECTIONS, buildSection } from '../src/utils/report/sections.js';
import { gatherDesignData } from '../src/utils/report/reportData.js';
import { getLocale } from '../src/constants/locales.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// Same sample design/options as tests/report_generation.mjs, kept in sync
// deliberately so both tests exercise the identical pipeline inputs.
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
const sectionIds = ['design-summary', 'optical-eval', 'color-eval',
                  'ri-profile', 'efield', 'ellipsometry', 'integral-values', 'qualifiers',
                  'merit-function', 'notes'];
const perSection = {
  'design-summary': { optical: true, materialsTable: true },
  'optical-eval': { curves: ['T', 'R'], includeTable: true,
                    lambdaStart: 400, lambdaEnd: 700, lambdaStep: 5, thetas: [0, 30] },
  'color-eval':   { characteristic: 'R', observer: '2', illuminant: 'D65', step: 5 },
  'ellipsometry': { thetas: [65, 70], lambdaStart: 400, lambdaEnd: 700, lambdaStep: 10, quantity: 'both' },
};
const data = gatherDesignData(design, sectionIds, perSection);
const loc = getLocale('en');
const tr = { ...loc.report, kinds: (loc.specification && loc.specification.kinds) || {} };

// Every builder emits its own wrapper and heading. The heading text is the
// localized title, so this also catches a section falling out of the locale.
const HEADINGS = {
  'design-summary':  'Design Summary',
  'optical-eval':    'Optical Evaluation',
  'color-eval':      'Color Evaluation',
  'ri-profile':      'Refractive-Index Profile',
  'efield':          'Electric Field Profile',
  'ellipsometry':    'Ellipsometry',
  'integral-values': 'Integral Values',
  'qualifiers':      'Qualifiers Verdict',
  'merit-function':  'Merit Function Operands',
  'notes':           'Notes',
};

console.log('— buildSection per builder —');
for (const id of sectionIds) {
  const html = buildSection(id, { design, data, opts: perSection[id] || {}, tr });
  ok(`${id}: wrapped in its own section element`,
     html.startsWith(`<section class="report-section" data-section="${id}">`)
     && html.endsWith('</section>'));
  ok(`${id}: localized heading`, html.includes(`<h2>${HEADINGS[id]}</h2>`));
  ok(`${id}: body is not just the heading`,
     html.length > `<section class="report-section" data-section="${id}"><h2>${HEADINGS[id]}</h2></section>`.length);
  ok(`${id}: no unrendered placeholder left behind`, !/undefined|\[object Object\]|NaN/.test(html));
}

// ── Error path: a broken data field renders an inline note, byte-exact ──────
console.log('— broken section degrades to inline note —');
{
  const badData = { ...data, spectrum: { error: 'synthetic failure' } };
  const badHtml = buildSection('optical-eval', { design, data: badData, opts: {}, tr });
  const expect = '<section class="report-section" data-section="optical-eval"><h2>Optical Evaluation</h2><p class="tf-note tf-err">⚠ synthetic failure</p></section>';
  ok('error-path html verbatim', badHtml === expect);
}

// ── Unknown section id returns '' ────────────────────────────────────────────
ok('unknown id -> empty string', buildSection('nonexistent', { design, data, opts: {}, tr }) === '');

// ── Catalogue sanity (order + shape unchanged) ──────────────────────────────
console.log('— REPORT_SECTIONS catalogue —');
const expectedCatalogue = [
  { id: 'cover',           dataKey: null,            defaultOn: true },
  { id: 'design-summary',  dataKey: 'summary',       defaultOn: true },
  { id: 'optical-eval',    dataKey: 'spectrum',      defaultOn: true },
  { id: 'color-eval',      dataKey: 'color',         defaultOn: false },
  { id: 'ri-profile',      dataKey: 'riProfile',     defaultOn: false },
  { id: 'efield',          dataKey: 'efield',        defaultOn: false },
  { id: 'ellipsometry',    dataKey: 'ellipsometry',  defaultOn: false },
  { id: 'integral-values', dataKey: 'integrals',     defaultOn: false },
  { id: 'qualifiers',      dataKey: 'qualifiers',    defaultOn: false },
  { id: 'merit-function',  dataKey: 'merit',         defaultOn: false },
  { id: 'notes',           dataKey: null,            defaultOn: false },
];
ok('REPORT_SECTIONS matches golden catalogue', JSON.stringify(REPORT_SECTIONS) === JSON.stringify(expectedCatalogue));

if (fail === 0) console.log(`PASS: sections_characterization (${pass} checks)`);
else { console.error(`\n${fail} test(s) failed, ${pass} passed.`); process.exit(1); }
