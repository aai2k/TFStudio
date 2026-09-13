/**
 * The refractiveindex.info browser states the range it will actually import.
 *
 * The detail panel used to print the range the database record declares, while
 * the chart beside it and the importer behind the button both sampled a fixed
 * 200 to 20000 nm window written out separately in each file. Infrared records
 * make the two disagree wildly: one declares 0.5 to 1000 µm and delivers 0.5 to
 * about 20, so the panel offered a material a thousand times wider than the one
 * that arrived.
 *
 * The window is now one constant and the displayed span is read back from the
 * samples themselves, so the panel, the plot and the stored entry cannot drift.
 *
 * Run: node tests/rii_sampled_range.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { sampleMaterial, sampledRangeNm, RII_SAMPLE_RANGE_NM } =
    await import('../src/utils/materials/riiDatabase/sampling.js');
const { riiToMaterialEntry } = await import('../src/utils/materials/riiDatabase/catalogEntry.js');

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

const [WINDOW_LO, WINDOW_HI] = RII_SAMPLE_RANGE_NM;
assert.deepEqual(RII_SAMPLE_RANGE_NM, [200, 20000], 'the sampling window is the documented one');

// ── A tabulated record that runs past the window ─────────────────────────────
//
// Shaped like Ta2O5 (Bright, amorphous): rows from 500 nm out to a millimetre,
// declaring the full span. The rows are unevenly spaced so the last one inside
// the window is not the window edge, which is what the panel used to round away.

const rows = [];
for (let lam = 500; lam <= 20000; lam += 347) rows.push([lam, 2.1, 0.01]);
for (const lam of [50000, 200000, 1000000]) rows.push([lam, 2.6, 0.4]);

const infrared = {
    type: 'tabulated nk',
    tableNK: rows,
    wavelengthRange: [500, 1000000],
    references: 'Bright et al. 2013',
    comments: '',
    dataPath: 'main/Ta2O5/nk/Bright-amorphous.yml',
};

const lastInside = rows.filter(([lam]) => lam <= WINDOW_HI).at(-1)[0];
assert.ok(lastInside < WINDOW_HI, 'the fixture ends short of the window edge, as a real table does');

const range = sampledRangeNm(infrared);
assert.deepEqual(range, [500, lastInside],
    'the reported span is the data inside the window, not the declared range');
assert.notEqual(range[1], 1000000, 'the declared upper bound is never reported');

// It agrees with what the chart plots, because it is read from the same samples.
const samples = sampleMaterial(infrared, ...RII_SAMPLE_RANGE_NM, 10);
assert.deepEqual([samples[0][0], samples.at(-1)[0]], range,
    'the span and the plotted curve start and end together');

// And with what the button stores. The entry keeps µm.
const entry = riiToMaterialEntry(infrared, 'Bright-amorphous', 'Ta2O5');
assert.deepEqual([entry.lambdaMin * 1000, entry.lambdaMax * 1000], range,
    'the imported material covers exactly the span the panel offered');

// ── A formula record that stops inside the window ────────────────────────────
//
// Malitson fused silica: declared 210 to 6700 nm, comfortably inside, so nothing
// is clipped and the panel reports the record's own range.

const silica = {
    type: 'formula',
    riiFormulaNum: 1,
    formulaCoeffs: [0, 0.6961663, 0.0684043, 0.4079426, 0.1162414, 0.8974794, 9.896161],
    wavelengthRange: [210, 6700],
    references: 'Malitson 1965',
    comments: '',
    dataPath: 'main/SiO2/nk/Malitson.yml',
};

const silicaRange = sampledRangeNm(silica);
assert.equal(silicaRange[0], 210, 'an unclipped record keeps its own lower bound');
assert.ok(silicaRange[1] <= 6700 && silicaRange[1] > 6600,
    `an unclipped record keeps its own upper bound, got ${silicaRange[1]}`);

// A sanity check that the fixture is a real dispersion rather than a flat line:
// fused silica is about 1.4599 at 550 nm.
const at550 = sampleMaterial(silica, 550, 550, 10)[0];
assert.ok(Math.abs(at550[1] - 1.4599) < 2e-3, `fused silica n(550) = ${at550[1]}`);

// ── No overlap at all ────────────────────────────────────────────────────────

assert.equal(sampledRangeNm({ type: 'tabulated nk', tableNK: [[50, 1.5, 0]] }), null,
    'a record entirely below the window reports nothing rather than an empty span');
assert.equal(sampledRangeNm({ type: 'formula' }), null,
    'a record with neither table nor formula reports nothing');

// ── The three readers share one window ───────────────────────────────────────

assert.match(read('components/windows/design/materialEditor/riiRightPanel.js'),
    /sampledRangeNm\(mat\)/,
    'the panel reports the sampled span');
assert.doesNotMatch(read('components/windows/design/materialEditor/riiRightPanel.js'),
    /mat\.wavelengthRange/,
    'and no longer prints the declared range');

for (const path of ['components/windows/design/materialEditor/riiChart.js',
                    'utils/materials/riiDatabase/catalogEntry.js']) {
    assert.match(read(path), /RII_SAMPLE_RANGE_NM/, `${path} reads the shared window`);
    assert.doesNotMatch(read(path), /sampleMaterial\([^)]*\b20000\b/,
        `${path} must not write the window out again`);
}

console.log('rii_sampled_range: passed');
