/**
 * What the Material Editor makes of what is typed into it.
 *
 * The n/k grid takes plain text, and parseFloat stops at the first character it
 * cannot use: an index entered as 2,3 by anyone whose keyboard and locale put a
 * comma there was read as 2, plotted as 2, and saved as 2, with nothing anywhere
 * saying so. Numbers here go through parseNumber, which resolves the separator.
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals, loadApp } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { buildNKFromDraft, draftToMaterial, fitModelsForRows, effectiveFitModel } =
    await import('../src/components/windows/design/materialEditor/materialDraft.js');
const { parseNumberStrict } = await import('../src/utils/misc/numberParsing.js');

function tabularDraft(rows) {
    return {
        type: 'tabular', id: 'ZrO2P', name: 'ZrO2P', color: '#ffffff',
        lambdaMinNm: '350', lambdaMaxNm: '850',
        coeffs: [], kRows: [], formulaNum: 2, dispersionFit: null,
        rows: rows.map((row, index) => ({ _key: index, lam: row[0], n: row[1], k: row[2] })),
    };
}

// ── A comma is a decimal separator ────────────────────────────────────────────

const comma = tabularDraft([
    ['350', '2,3', '0'],
    ['500', '1,955', '0,0004'],
    ['850', '1,95', '0'],
]);

const sampler = buildNKFromDraft(comma);
assert.deepEqual(sampler(350), [2.3, 0], 'the preview plots the index that was typed');
assert.deepEqual(sampler(850), [1.95, 0], 'not the part of it before the comma');
assert.equal(sampler(500)[1], 0.0004, 'and the same in k');

assert.deepEqual(
    draftToMaterial(comma).tabData,
    [[350, 2.3, 0], [500, 1.955, 0.0004], [850, 1.95, 0]],
    'and the material is saved with it, since a wrong index here is a wrong coating',
);

// ── A cell that is not a number is still skipped ──────────────────────────────

const partial = tabularDraft([
    ['350', '2.3', '0'],
    ['500', '', '0'],
    ['600', 'abc', '0'],
    ['850', '1.95', ''],
]);
assert.deepEqual(
    draftToMaterial(partial).tabData, [[350, 2.3, 0], [850, 1.95, 0]],
    'a row still being typed is left out rather than read as an index of zero',
);
assert.ok(Number.isNaN(parseNumberStrict('')), 'an empty cell is not a zero');
assert.ok(Number.isNaN(parseNumberStrict('abc')));
assert.equal(parseNumberStrict('1,5e-3'), 0.0015, 'exponents survive the separator');

// ── Metal models are offered only where there is absorption to fit ────────────

assert.deepEqual(fitModelsForRows(comma.rows), ['cauchy', 'sellmeier', 'drude', 'drude-lorentz'],
    'a table with any absorption in it can carry a metal model');

const transparent = tabularDraft([['350', '2.3', '0'], ['500', '1.955', '0'], ['850', '1.95', '0']]);
assert.deepEqual(fitModelsForRows(transparent.rows), ['cauchy', 'sellmeier'],
    'a table with k = 0 throughout gives a Drude term nothing to fit');

assert.equal(effectiveFitModel({ ...transparent, fitModel: 'drude-lorentz' }), 'cauchy',
    'a model left over from another material does not stay selected once it cannot apply');
assert.equal(effectiveFitModel({ ...transparent, fitModel: 'sellmeier' }), 'sellmeier',
    'a model that still applies is kept');

console.log('PASS: material_editor_input');
