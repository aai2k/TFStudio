/**
 * The refractiveindex.info browser imports the whole page and states the range
 * it imports.
 *
 * The importer used to keep 200 to 20000 nm of every page, with table rows
 * thinned to 10 nm apart, a window nothing in the physics asked for: the SiO2
 * page by Franta et al. runs from 27.5 nm to 125 µm and arrived as 986 of its
 * 3659 rows. A table now comes in whole and a formula is evaluated over the
 * range its page states, on a logarithmic grid.
 *
 * The detail panel, the chart and the importer read the same samples, so the
 * span on screen is the span that gets stored.
 *
 * Run: node tests/rii_sampled_range.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const { sampleMaterial, sampledRangeNm } = await import('../src/utils/materials/riiDatabase/sampling.js');
const { riiToMaterialEntry } = await import('../src/utils/materials/riiDatabase/catalogEntry.js');
const { parseMaterialDoc } = await import('../src/utils/materials/riiDatabase/materialParser.js');
const { createTabulatedNKSampler } = await import('../src/utils/materials/pchip.js');

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const spanOf = (entry) => [entry.lambdaMin * 1000, entry.lambdaMax * 1000];

// ── A table from the far ultraviolet to the far infrared ────────────────────
//
// Shaped like the Franta SiO2 page: 3659 rows, log-spaced from 27.5 nm to
// 125 µm. Every row is imported, and the span reported is the rows' own.

const rows = [];
for (let i = 0; i < 3659; i++) {
    const lam = 27.5 * Math.pow(125000 / 27.5, i / 3658);
    rows.push([lam, 1.45 + 0.01 * Math.sin(i), i > 3000 ? 0.2 : 0]);
}
rows[rows.length - 1][0] = 125000;
const wide = {
    type: 'tabulated_nk', tableNK: rows,
    references: 'Franta et al. 2016', comments: '', dataPath: 'main/SiO2/nk/Franta-25C.yml',
};

const entry = riiToMaterialEntry(wide, 'Franta-25C', 'SiO2');
assert.equal(entry.tabData.length, 3659, 'every row of the page is imported');
assert.deepEqual(entry.tabData, rows, 'as the page gives it');
assert.deepEqual(sampledRangeNm(wide), [27.5, 125000], 'the panel states the whole page');
assert.deepEqual(spanOf(entry), [27.5, 125000], 'and that is the span stored');
const plotted = sampleMaterial(wide);
assert.deepEqual([plotted[0][0], plotted.at(-1)[0]], [27.5, 125000], 'and the span plotted');

// ── A page that joins two datasets ───────────────────────────────────────────
//
// Some pages stitch measurements that overlap or repeat a wavelength. The
// import is in wavelength order, and a repeated wavelength keeps the row the
// tabulated sampler computes with, so the stored table and the page give the
// same n and k everywhere.

const stitched = {
    type: 'tabulated_nk',
    tableNK: [[3000, 1.6, 0.01], [2500, 1.62, 0], [2600, 1.61, 0], [3000, 1.59, 0.02], [3100, 1.58, 0.03]],
    references: 'Querry 1987', comments: '', dataPath: 'main/X/nk/Querry.yml',
};
const joined = riiToMaterialEntry(stitched, 'Querry', 'X');
assert.deepEqual(joined.tabData.map(row => row[0]), [2500, 2600, 3000, 3100], 'rows in wavelength order, one per wavelength');
assert.deepEqual(spanOf(joined), [2500, 3100], 'so the stored span runs from the shortest wavelength to the longest');
const fromPage = createTabulatedNKSampler(stitched.tableNK);
const fromEntry = createTabulatedNKSampler(joined.tabData);
for (const lam of [2500, 2550, 2800, 3000, 3050, 3100]) {
    assert.deepEqual(fromEntry(lam), fromPage(lam), `the stored table computes what the page does at ${lam} nm`);
}

// ── A formula stated from 1 nm to 1 mm ───────────────────────────────────────
//
// Evaluated on a grid with each point 1% past the last, ending on the stated
// upper end. A Sellmeier term with its resonance at 0.1 nm keeps n finite over
// the whole span.

const broad = {
    type: 'formula', riiFormulaNum: 1, formulaCoeffs: [0, 1.1, 0.0001],
    wavelengthRange: [1, 1e6], references: 'test', comments: '', dataPath: 'test/formula.yml',
};
const grid = sampleMaterial(broad);
assert.ok(grid.length < 1400, `a formula stated over six decades is ${grid.length} points`);
assert.deepEqual([grid[0][0], grid.at(-1)[0]], [1, 1e6], 'from the stated lower end to the stated upper end');
for (let i = 1; i < grid.length; i++) {
    const ratio = grid[i][0] / grid[i - 1][0];
    assert.ok(ratio > 1 && ratio < 1.0101, `point ${i} is at most 1% past the one before it (${ratio})`);
}
const sellmeier = nm => Math.sqrt(1 + 1.1 * (nm / 1000) ** 2 / ((nm / 1000) ** 2 - 1e-8));
assert.ok(grid.every(([nm, n]) => Math.abs(n - sellmeier(nm)) < 1e-12), 'n is the formula at every grid point');
assert.deepEqual(spanOf(riiToMaterialEntry(broad, 'p', 'b')), [1, 1e6], 'imported over the stated range');

// Malitson fused silica, declared 210 to 6700 nm: the grid starts and ends on
// the page's own range, and the values are the formula's.
const silica = {
    type: 'formula', riiFormulaNum: 1,
    formulaCoeffs: [0, 0.6961663, 0.0684043, 0.4079426, 0.1162414, 0.8974794, 9.896161],
    wavelengthRange: [210, 6700], references: 'Malitson 1965', comments: '', dataPath: 'main/SiO2/nk/Malitson.yml',
};
assert.deepEqual(sampledRangeNm(silica), [210, 6700], 'a formula page keeps its own range');
const near550 = sampleMaterial(silica).reduce((best, row) => (Math.abs(row[0] - 550) < Math.abs(best[0] - 550) ? row : best));
assert.ok(Math.abs(near550[1] - 1.4599) < 2e-3, `fused silica n near 550 nm = ${near550[1]} at ${near550[0]} nm`);

// ── Nothing to sample ────────────────────────────────────────────────────────

assert.equal(sampledRangeNm({ type: 'formula' }), null, 'a record with neither table nor formula reports nothing');
assert.equal(riiToMaterialEntry({ type: 'formula', dataPath: 'x.yml' }, 'p', 'b'), null,
    'and is refused rather than stored empty');
// A logarithmic grid cannot start at zero, so a range that does gives nothing
// rather than a grid that never reaches its end.
assert.deepEqual(sampleMaterial({ ...silica, wavelengthRange: [0, 6700] }), [], 'a range from zero is not sampled');
assert.deepEqual(sampleMaterial({ ...silica, wavelengthRange: [-5, 6700] }), [], 'nor one from below zero');

// ── The three readers share the samples ─────────────────────────────────────

const panel = read('components/windows/design/materialEditor/riiRightPanel.js');
assert.match(panel, /sampledRangeNm\(mat\)/, 'the panel reports the sampled span');
assert.doesNotMatch(panel, /mat\.wavelengthRange/, 'not the range the record declares');
for (const path of ['components/windows/design/materialEditor/riiChart.js',
                    'utils/materials/riiDatabase/catalogEntry.js']) {
    assert.match(read(path), /sampleMaterial\((mat|material)\)/, `${path} reads the samples`);
    assert.doesNotMatch(read(path), /sampleMaterial\([^)]*,/, `${path} passes no window of its own`);
}

// ── The page itself, when the database is checked out ───────────────────────

const frantaPage = new URL('../refractiveindex-db/database/data/main/SiO2/nk/Franta-25C.yml', import.meta.url);
if (existsSync(frantaPage)) {
    const page = parseMaterialDoc(yaml.load(readFileSync(frantaPage, 'utf8')), 'main/SiO2/nk/Franta-25C.yml');
    const franta = riiToMaterialEntry(page, 'Franta-25C', 'SiO2');
    assert.equal(franta.tabData.length, 3659, 'the SiO2 Franta 25 °C page imports all 3659 rows');
    assert.deepEqual(spanOf(franta).map(nm => Number(nm.toPrecision(3))), [27.5, 125000],
        'from 27.5 nm to 125 µm');
} else {
    console.log('rii_sampled_range: refractiveindex-db is not checked out, so the Franta page itself was not read');
}

console.log('rii_sampled_range: passed');
