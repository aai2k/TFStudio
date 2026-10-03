/**
 * A refractiveindex.info formula page is stored as its formula, and the
 * database's nine formulas are in the Material Editor's one list of formulas.
 *
 * Every page imported as a table: the formula on a 1% grid, the page's k
 * interpolated onto the same grid. The database's formulas lived apart from
 * the catalog's, and the editor offered only Zemax 1 to 13 and 101 to 106.
 * They are now formulas 201 to 209 of the catalog's registry; a formula page
 * imports as one, with its coefficients, its range and its k table, and gives
 * what the formula gives past its range and no index where it has none.
 *
 * Run: node tests/rii_formula_catalog.mjs
 */

import assert from 'node:assert/strict';

const { riiToMaterialEntry, sampleMaterial } = await import('../src/utils/materials/riiDatabase.js');
const { makeGetNK } = await import('../src/utils/materials/catalogManager/dispersion.js');
const {
    FORMULA_LATEX, coefficientNames, evalN, formulaLatex, formulasBySource, isSupportedFormula,
} = await import('../src/utils/materials/dispersionFormulas.js');
const {
    buildNKFromDraft, coefficientSlots, draftToMaterial, materialToDraft,
} = await import('../src/components/windows/design/materialEditor/materialDraft.js');

const page = (dataPath, riiFormulaNum, formulaCoeffs, wavelengthRange, extra = {}) => ({
    type: 'formula', dataPath, riiFormulaNum, formulaCoeffs, wavelengthRange,
    references: 'A reference.', comments: 'A comment.', ...extra,
});

// ── Stored as the formula ────────────────────────────────────────────────────

const withK = page('main/X/nk/Y.yml', 2, [0, 1.1, 0.01, 0.2, 100], [300, 5000],
    { tableK: [[300, 0.002, 0], [600, 0.0005, 0], [1000, 0, 0]] });
const entry = riiToMaterialEntry(withK, 'Y', 'X');
assert.equal(entry.formulaNum, 202, 'database formula 2 is catalog formula 202');
assert.deepEqual(entry.coefficients, withK.formulaCoeffs, 'with the coefficients as the page gives them');
assert.notEqual(entry.coefficients, withK.formulaCoeffs, 'copied, not shared with the parsed page');
assert.deepEqual([entry.lambdaMin, entry.lambdaMax], [0.3, 5], 'over the range the page states, in µm');
assert.equal(entry.rangeDeclared, true);
assert.deepEqual(entry.kTable, [{ lam_um: 0.3, k: 0.002 }, { lam_um: 0.6, k: 0.0005 }, { lam_um: 1, k: 0 }],
    'the page k table beside it, in µm');
assert.equal(entry.interp, 'pchip', 'read as the sampler read it');
assert.deepEqual(entry.tabData, [], 'and no table of samples');
assert.equal(entry.comment, 'A comment.\nA reference.');
assert.equal(entry.dataPath, withK.dataPath);

const getNK = makeGetNK(entry);
for (const [lam, n, k] of sampleMaterial(withK)) {
    const [storedN, storedK] = getNK(lam);
    assert.equal(storedN, n, `n at ${lam} nm is the sampled n`);
    assert.ok(Math.abs(storedK - k) <= 1e-15, `k at ${lam} nm is the sampled k`);
}

const zerosK = riiToMaterialEntry({ ...withK, tableK: [[280, 0, 0], [290, 0, 0]] }, 'Y', 'X');
assert.deepEqual(zerosK.kTable, [], 'a k table of zeros only is not stored');
assert.equal(zerosK.interp, undefined, 'and needs no rule');
assert.equal(makeGetNK(zerosK)(550)[1], 0, 'k is 0 either way');

const tablePage = { type: 'tabulated_nk', tableNK: [[400, 2.2, 0.01], [600, 2.1, 0], [800, 2.05, 0]], references: '', comments: '', dataPath: 'main/T/nk/U.yml' };
const tableEntry = riiToMaterialEntry(tablePage, 'U', 'T');
assert.equal(tableEntry.formulaNum, -1, 'a table page is still stored as its rows');
assert.deepEqual(tableEntry.tabData, sampleMaterial(tablePage));

// ── Past the range, and inside a pole band ───────────────────────────────────
// Andrey, 2026-10-03: the formula is evaluated past the range as it gives it,
// like every formula material, and where it gives no real n there is no value.

const tio2 = makeGetNK(riiToMaterialEntry(page('main/TiO2/nk/Devore-o.yml', 4, [5.913, 0.2441, 0, 0.0803, 1, 0, 0, 0, 1], [430, 1530]), 'o', 'TiO2'));
assert.ok(Math.abs(tio2(300)[0] - 5.57476) < 1e-5, `TiO2 Devore-o at 300 nm, past its range: ${tio2(300)[0]}`);
assert.ok(Number.isNaN(tio2(270)[0]), 'and no index past its pole at 283 nm');
assert.ok(Math.abs(tio2(2000)[0] - 2.44444) < 1e-5, `at 2000 nm, past its range: ${tio2(2000)[0]}`);

const cs2 = makeGetNK(riiToMaterialEntry(page('main/CS2/nk/Chemnitz.yml', 1, [0, 1.499426, 0.178763, 0.089531, 6.591946], [300, 12000]), 'Chemnitz', 'CS2'));
assert.ok(Number.isNaN(cs2(6525)[0]), 'CS2 has no index inside its pole band');
assert.ok(Math.abs(cs2(6428.42)[0] - 0.87344) < 1e-5 && cs2(6620)[0] > 3.6, 'and its own index either side');

// A page's negative k is stored as written and read never below zero, by the
// browser's samples as by the stored material (HIKARI LAK09 has one such row).
{
    const lak = page('specs/hikari/optical/LAK09.yml', 2, [0, 1.1, 0.01, 0.2, 100], [400, 1000],
        { tableK: [[600, 2e-6, 0], [700, -1.4e-5, 0], [800, 1e-6, 0]] });
    const stored = makeGetNK(riiToMaterialEntry(lak, 'LAK09', 'HIKARI'));
    assert.equal(riiToMaterialEntry(lak, 'LAK09', 'HIKARI').kTable[1].k, -1.4e-5, 'the negative row is kept as written');
    for (const [lam, , k] of sampleMaterial(lak)) {
        assert.ok(k >= 0 && Math.abs(k - stored(lam)[1]) <= 1e-15, `k at ${lam} nm is the stored material's, ${k}`);
    }
}

// ── Where the material has no index ──────────────────────────────────────────
// Before formula imports no material that resolves gave NaN n, so the paths
// below never met one. A worst-case or argmax operand over a band with such a
// point has no value, as a band average already had none, and the Zemax
// coating export writes no n it does not have.
{
    const { buildEvalContext, calcMF, evaluateOperands, makeOperand } = await import('../src/utils/physics/optimizer.js');
    const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
    const { tfLayersToCoat, tfMaterialToMate } = await import('../src/utils/io/zemaxCoatingFile.js');
    const cs2Entry = riiToMaterialEntry(page('main/CS2/nk/Chemnitz.yml', 1, [0, 1.499426, 0.178763, 0.089531, 6.591946], [300, 12000]), 'Chemnitz', 'CS2');
    const cs2Material = { ...cs2Entry, id: 'user:CS2', getNK: makeGetNK(cs2Entry) };
    const design = {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'SiO2', thickness: 1 },
        frontLayers: [{ id: 'L1', material: 'user:CS2', thickness: 1000, locked: false }],
        backLayers: [], surfaceMode: 'front_only',
    };
    const context = buildEvalContext(design, id => (id === 'user:CS2' ? cs2Material : getMaterial(id)));
    for (const type of ['TMN', 'TMX', 'TAV', 'MNWT']) {
        const operands = [makeOperand({ type, lambdaStart: 6400, lambdaEnd: 6700, target: type === 'MNWT' ? 6500 : 0.9, weight: 1 })];
        const values = evaluateOperands(operands, context);
        assert.equal(values[0], null, `${type} over a band with no index in it has no value`);
        assert.equal(calcMF(operands, values), Infinity, `and ${type} leaves the merit undefined`);
    }
    const outside = [makeOperand({ type: 'TMN', lambdaStart: 6700, lambdaEnd: 6900, target: 0.9, weight: 1 })];
    assert.ok(Number.isFinite(evaluateOperands(outside, context)[0]), 'a band clear of it still has one');

    const mate = tfMaterialToMate('CS2', cs2Material.getNK, [6400, 6525, 6620]);
    assert.deepEqual(mate.points.map(([lamUm]) => lamUm), [6.4, 6.62], 'the coating file leaves out the wavelength with no index');
    const coat = tfLayersToCoat('STACK', [{ material: 'user:CS2', thickness: 1000 }], {
        zemaxName: () => 'CS2', mode: 'relative', refWavelengthUm: 6.525,
        realIndex: (id, lamNm) => cs2Material.getNK(lamNm)[0],
    });
    assert.deepEqual(coat.layers[0], { material: 'CS2', thickness: 1, isAbsolute: 1 },
        'a layer with no index at the reference wavelength is written in µm, not as 0 waves');
}

// ── One list ────────────────────────────────────────────────────────────────

const groups = formulasBySource();
assert.deepEqual(groups.map(group => group.source), ['zemax', 'general', 'rii'], 'Zemax, general and OptiLayer, refractiveindex.info');
const listed = groups.flatMap(group => group.formulas.map(formula => formula.formulaNum));
assert.deepEqual(listed, Object.keys(FORMULA_LATEX).map(Number), 'every formula in the registry, once');
assert.deepEqual(groups[0].formulas.map(formula => formula.number), Array.from({ length: 13 }, (_, i) => i + 1));
assert.deepEqual(groups[2].formulas.map(({ number, name }) => `${number}: ${name}`), [
    '1: Sellmeier', '2: Sellmeier-2', '3: Polynomial', '4: RefractiveIndex.INFO', '5: Cauchy',
    '6: Gases', '7: Herzberger', '8: Retro', '9: Exotic',
], 'the database formulas under the numbers and names the database gives them');
assert.ok(listed.every(isSupportedFormula), 'each listed formula has an evaluator');
for (const formulaNum of [201, 202, 203, 204, 205, 206, 207, 208, 209]) {
    assert.ok(formulaLatex(formulaNum, 11).startsWith(formulaNum === 208 ? '\\dfrac{n^2 - 1}' : 'n'), `formula ${formulaNum} is written out`);
}
assert.deepEqual(coefficientNames(201, 7), ['C₁', 'C₂', 'C₃', 'C₄', 'C₅', 'C₆', 'C₇'], 'named C₁, C₂, … as the database names them');
assert.deepEqual(coefficientNames(204, 11).slice(8), ['C₉', 'C₁₀', 'C₁₁']);

// ── Edited in the Material Editor ────────────────────────────────────────────

const malitson = riiToMaterialEntry(page('main/SiO2/nk/Malitson.yml', 1,
    [0, 0.6961663, 0.0684043, 0.4079426, 0.1162414, 0.8974794, 9.896161], [210, 6700]), 'Malitson', 'SiO2');
const draft = materialToDraft('user', malitson);
assert.equal(draft.type, 'formula', 'opens as a formula');
assert.equal(coefficientSlots(draft), 7, 'with a field for each coefficient');
const saved = draftToMaterial({ ...draft, name: 'Fused silica' });
assert.equal(saved.formulaNum, 201);
assert.deepEqual(saved.coefficients, malitson.coefficients, 'saved with its coefficients');
assert.equal(saved.dataPath, malitson.dataPath, 'keeps its page');
assert.equal(saved.sourceUrl, malitson.sourceUrl, 'and its link');
assert.equal(saved.rangeDeclared, true, 'and its range stays the stated one');
assert.equal(saved.comment, malitson.comment, 'and its comment');
for (const lam of [250, 587.6, 1550, 6000]) {
    assert.equal(makeGetNK(saved)(lam)[0], makeGetNK(malitson)(lam)[0], `the same n at ${lam} nm`);
}

// A formula page whose range is far from 550 nm still previews in the editor.
const icenogle = materialToDraft('user', riiToMaterialEntry(page('main/Ge/nk/Icenogle.yml', 2,
    [8.28156, 6.72880, 0.44105, 0.21307, 3870.1], [2500, 12000]), 'Icenogle', 'Ge'));
assert.ok(Number.isNaN(evalN(202, [8.28156, 6.72880, 0.44105, 0.21307, 3870.1], 0.55)), 'Ge Icenogle has no n at 550 nm');
const preview = buildNKFromDraft(icenogle);
assert.ok(preview && preview(5000)[0] > 4, 'but its preview draws over its own range');

console.log('rii_formula_catalog: passed');
