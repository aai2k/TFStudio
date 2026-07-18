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
  'optical-eval':     ['918965be46354f0b744612be9c087f19088d2828491a1890208f7b8e44d83111', 10171],
  'color-eval':       ['86c6b143f998f95c04c7df60209821f58a21462af5e28bb366a1531064059a3c', 840],
  'ri-profile':       ['e5a13bbc988f41f31a9e5ebc45e19cb28d58e7d0d1a37fbb319cbdf0f1984ce9', 2216],
  'efield':           ['faf41ef08522365fe455d13adfef01bee46fbdae0f91dbbc44c7ece30ea4baaa', 3886],
  'ellipsometry':     ['475d99169899177f3db3fdf3ba9f79b16ce484aa84a8f299a4f23e8786181dff', 6464],
  'integral-values':  ['8eb6763a45b80fc1bbaed7a468848a32aae5bff98b8be366f19f812953ad0657', 730],
  'qualifiers':       ['866bdef2363adbf95d5cb15944b29d423341ed7ea1812ead2f1b463fb0d39948', 433],
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
