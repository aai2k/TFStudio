// Characterization test for sections.js — locks the exact byte output of
// buildSection() for every builder so splitting one-builder-per-file (sibling
// folder sections/) cannot change a single emitted byte. Compared via SHA-256
// (any byte change flips the hash).
// Run: node tests/sections_characterization.mjs
import { createHash } from 'node:crypto';
import { REPORT_SECTIONS, buildSection } from '../src/utils/report/sections.js';
import { gatherDesignData } from '../src/utils/report/reportData.js';
import { getLocale } from '../src/constants/locales.js';

let pass = 0, fail = 0;
const sha = (s) => createHash('sha256').update(s).digest('hex');
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

const GOLDEN = {
  'design-summary':  ['23521dca087d4b61f7da9cb3ebd27719b3bf144a4779f13337472a404264e77b', 1668],
  'optical-eval':     ['bd5db8353037d8250fe1b863fbfde951c40d240266ad62c1b97751ec09463194', 10171],
  'color-eval':       ['d0e9b4bc70c1990ec04512465229edbf93e86bfbad364a5866a95c7a16e4d74d', 840],
  'ri-profile':       ['e5a13bbc988f41f31a9e5ebc45e19cb28d58e7d0d1a37fbb319cbdf0f1984ce9', 2216],
  'efield':           ['24dbc39641b035ac5f8a38add185f8820fb11f6f44f1cc31cc304c7deaefb424', 3886],
  'ellipsometry':     ['1ee91cac9bff166a74f01b9ea0db6a4581e52eea377d6132b037eb713cd7fb9b', 6464],
  'integral-values':  ['8974e0b1ae97bd9a02375e7ad61876c6826a47802f555086eabb1cd002d20934', 730],
  'qualifiers':       ['1d78e56e93ddfb94621c057fea5988dd792b819df0016278fdeb476c2f9ddb46', 433],
  'merit-function':   ['8dc24d2c77f720e09f40a0c44e805f634ad53e20e9c180568365da92e279a17e', 425],
  'notes':            ['65f45cef041b4dd9332ec6a10b8bc129e9306db406c9850ac621c055255a78f8', 151],
};

console.log('— buildSection byte-exact per builder —');
for (const id of sectionIds) {
  const html = buildSection(id, { design, data, opts: perSection[id] || {}, tr });
  const [expectHash, expectLen] = GOLDEN[id];
  ok(`${id}: length`, html.length === expectLen);
  ok(`${id}: sha256`, sha(html) === expectHash);
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
