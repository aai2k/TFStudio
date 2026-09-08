/**
 * The report's merit-function table under one header row.
 *
 * Operand families do not take the same arguments: a band average spans two
 * wavelengths, a thickness constraint two layer numbers, a total-thickness row
 * a comparison, a math row the other rows it reads, a comment row nothing at
 * all. One column header cannot say all of that, so every cell names its own
 * unit and the rows that score no ray print no angle or polarization.
 */

import assert from 'node:assert/strict';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { meritOperandsSummary } = await import('../src/utils/report/reportData/sectionData.js');
const { buildMerit } = await import('../src/utils/report/sections/otherSections.js');
const { DASH } = await import('../src/utils/report/sections/format.js');
const { getLocale } = await import('../src/constants/locales.js');

const design = {
  meritOperands: [
    { id: 'a', type: 'RAV',  lambdaStart: 450, lambdaEnd: 650,  aoi: 0,  pol: 'avg', target: 0.005, weight: 1 },
    { id: 'b', type: 'T',    lambdaStart: 550, lambdaEnd: 650,  aoi: 45, pol: 's',   target: 0.99,  weight: 2 },
    { id: 'c', type: 'GD',   lambdaStart: 800, lambdaEnd: 900,  aoi: 0,  pol: 'avg', target: 0,     weight: 1 },
    { id: 'd', type: 'MNT',  lambdaStart: 1,   lambdaEnd: 1000, aoi: 0,  pol: 'avg', target: 10,    weight: 1 },
    { id: 'e', type: 'MXT',  lambdaStart: 4,   lambdaEnd: 4,    aoi: 0,  pol: 'avg', target: 300,   weight: 1 },
    { id: 'f', type: 'TT',   cmp: 'le',                         aoi: 0,  pol: 'avg', target: 1000,  weight: 1 },
    { id: 'g', type: 'OPGT', refId: 'a',                                             target: 0.9,   weight: 1 },
    { id: 'h', type: 'DIFF', refId1: 'a', refId2: 'b',                               target: 0,     weight: 1 },
    { id: 'i', type: 'ABSO', refId: 'gone',                                          target: 0,     weight: 1 },
    { id: 'j', type: 'BLNK', comment: 'AR band',                                                    weight: 1 },
  ],
};

// ── The data layer resolves what the table cannot look up itself ─────────────
const summary = meritOperandsSummary(design);
assert.equal(summary.length, 10);
assert.equal(summary[6].ref1, 1, 'a single-ref math row names the row number it reads');
assert.deepEqual([summary[7].ref1, summary[7].ref2], [1, 2], 'a pair-ref math row names both');
assert.equal(summary[8].ref1, null, 'a reference to a deleted row resolves to nothing');
assert.equal(summary[5].cmp, 'le');
assert.equal(summary[9].comment, 'AR band');

// ── The table ────────────────────────────────────────────────────────────────
function cellsOf(html) {
  return html.split('<tr>').slice(1)
    .map(chunk => [...chunk.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(m => m[1]))
    .filter(cells => cells.length);
}

function render(lang) {
  const tr = getLocale(lang).report;
  const block = { id: 'blk', type: 'merit' };
  return buildMerit({ block, tr, data: { blocks: { blk: meritOperandsSummary(design) } } });
}

const html = render('en');
const rows = cellsOf(html);
assert.equal(rows.length, 10, 'one row per operand');

const RANGE = 2, AOI = 3, POL = 4;
assert.equal(rows[0][RANGE], '450-650 nm', 'a band average prints both wavelengths');
assert.equal(rows[1][RANGE], '550 nm', 'a single-wavelength operand prints one, not the λEnd it still carries');
assert.equal(rows[2][RANGE], '800 nm', 'group delay is evaluated at one wavelength');
assert.equal(rows[3][RANGE], 'Layers 1-1000', 'a thickness constraint covers layers, not wavelengths');
assert.equal(rows[4][RANGE], 'Layer 4', 'a constraint on one layer reads singular');
assert.equal(rows[5][RANGE], '≤', 'a total-thickness row prints its comparison');
assert.equal(rows[6][RANGE], '#1', 'a math row prints the row it reads');
assert.equal(rows[7][RANGE], '#1, #2', 'a two-reference math row prints both');
assert.equal(rows[8][RANGE], DASH, 'a reference to a deleted row prints a dash');
assert.equal(rows[9][RANGE], 'AR band', 'a comment row prints its text');

assert.deepEqual([rows[0][AOI], rows[0][POL]], ['0°', 'avg']);
assert.deepEqual([rows[1][AOI], rows[1][POL]], ['45°', 's']);
for (const i of [3, 4, 5, 6, 7, 8, 9]) {
  assert.deepEqual([rows[i][AOI], rows[i][POL]], [DASH, DASH],
    `row ${i + 1} scores no ray and prints no angle or polarization`);
}

// ── The header and the layer wording follow the locale ───────────────────────
for (const lang of ['en', 'ru', 'zh']) {
  const loc = getLocale(lang).report;
  assert.ok(typeof loc.lambdaOrLayer === 'string' && loc.lambdaOrLayer, `${lang} column header present`);
  assert.equal(typeof loc.layerRange, 'function', `${lang} layer range present`);
  const doc = render(lang);
  assert.ok(new RegExp(`<th[^>]*>${loc.lambdaOrLayer}</th>`).test(doc), `${lang} header in the table`);
  assert.ok(doc.includes(loc.layerRange(1, 1000)), `${lang} layer range in the table`);
}
assert.notEqual(getLocale('en').report.lambdaOrLayer, getLocale('ru').report.lambdaOrLayer,
  'EN and RU headers differ');

// An empty merit function still renders its note rather than an empty table.
const empty = buildMerit({
  block: { id: 'blk', type: 'merit' }, tr: getLocale('en').report,
  data: { blocks: { blk: [] } },
});
assert.ok(empty.includes(getLocale('en').report.noOperands));
assert.ok(!empty.includes('<table'));

console.log('report_merit_operands: ok');
