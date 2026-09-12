/**
 * A tabulated extinction coefficient below zero is read as zero.
 *
 * Essential Macleod's own materials and some refractiveindex.info tables hold
 * points with a slightly negative k, the residue of the fit that produced
 * them. A negative k in n + ik is gain, and interpolation carried it across
 * the whole span between two such points; in a stack that resonates the
 * effect is millions of times the size of the point itself.
 *
 *  1. Every sampler floors k at zero under both rules: the n,k sampler, the
 *     k table of a formula material, and the Material Editor previews of
 *     both. n is untouched and the record keeps the values as written.
 *  2. The floor is applied to the points, so the derivatives of a piece agree
 *     with its values.
 *  3. A quarter-wave stack of such a material keeps R + T at or below 1
 *     everywhere, where the raw table gave it gain.
 *  4. The Material Editor marks the rows and says how many; the import dialog
 *     marks the file in its list and names the count in the preview.
 *
 * Run: node tests/negative_k.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { createInterpolator, createTabulatedNKSampler } = await import('../src/utils/materials/pchip.js');
const { makeGetNK, interpK, negativeKPoints } = await import('../src/utils/materials/catalogManager/dispersion.js');
const { buildNKFromDraft, materialToDraft } = await import('../src/components/windows/design/materialEditor/materialDraft.js');
const { tmm } = await import('../src/utils/physics/thinFilmMath.js');
const { UserMaterialForm } = await import('../src/components/windows/design/materialEditor/userMaterialForm.js');
const { MaterialImportDialog } = await import('../src/components/windows/design/materialEditor/materialImportDialog.js');
const { DEFAULT_IMPORT_UNITS } = await import('../src/utils/materials/materialFileImport.js');

const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: got ${actual}, expected ${expected}, tolerance ${tolerance}`);

// A table shaped like Essential Macleod's TiO2: two points with k slightly
// below zero between positive neighbours. The two negative rows are the ones
// the program's file holds.
const rows = [
    [550, 2.31, 1e-5],
    [570.6, 2.303, 4e-6],
    [590.599975585938, 2.29600486769309, -2.8840684113368e-15],
    [610.5, 2.28700004272105, -2.11821316042915e-9],
    [630.6, 2.279, 3e-9],
    [650, 2.272, 0],
];
const frozen = JSON.stringify(rows);

// ── 1. Samplers ───────────────────────────────────────────────────────────────

for (const interp of ['pchip', 'linear']) {
    const nk = createTabulatedNKSampler(rows, interp);
    const nAt = createInterpolator(rows.map(r => [r[0], r[1]]), interp);
    const rawK = createInterpolator(rows.map(r => [r[0], r[2]]), interp);
    let rawNegative = 0;
    for (let lam = 540; lam <= 660; lam += 0.25) {
        const [n, k] = nk(lam);
        assert.ok(k >= 0, `${interp}: sampled k at ${lam} nm is ${k}`);
        assert.equal(n, nAt(lam), `${interp}: n is untouched at ${lam} nm`);
        if (rawK(lam) < 0) rawNegative++;
    }
    assert.ok(rawNegative > 0, `${interp}: the raw table goes negative between its points`);
    assert.equal(nk(600)[1], 0, `${interp}: k = 0 across the span between two negative points`);
    assert.equal(nk(610.5)[1], 0, `${interp}: and at the point itself`);
    assert.equal(nk(570.6)[1], 4e-6, `${interp}: a positive point is read as written`);
    assert.equal(nk.tabData[3][2], -2.11821316042915e-9, `${interp}: the sampler's table keeps the value`);
}
assert.equal(JSON.stringify(rows), frozen, 'the rows are left as written');

// A formula material with a k table holding negative points.
const formula = {
    id: 'sell', name: 'Sellmeier with a k table', formulaNum: 2,
    coefficients: [0.6961663, 0.0684043 ** 2, 0.4079426, 0.1162414 ** 2, 0.8974794, 9.896161 ** 2],
    kTable: [{ lam_um: 0.4, k: 1e-6 }, { lam_um: 0.5, k: -3e-9 }, { lam_um: 0.6, k: -1e-9 }, { lam_um: 0.7, k: 2e-6 }],
};
const formulaNK = makeGetNK(formula);
for (let lam = 380; lam <= 720; lam += 1) assert.ok(formulaNK(lam)[1] >= 0, `formula material: k at ${lam} nm is ${formulaNK(lam)[1]}`);
assert.equal(formulaNK(550)[1], 0, 'formula material: k = 0 between two negative points');
assert.equal(interpK(formula.kTable, 0.55), 0, 'interpK reads the same floor');
assert.equal(formula.kTable[1].k, -3e-9, 'the k table keeps the value');

// The Material Editor previews evaluate the same floored curve.
const table = { id: 'tio2', name: 'TiO2', formulaNum: -1, tabData: rows, coefficients: [], kTable: [], lambdaMin: 0.55, lambdaMax: 0.65 };
const draft = materialToDraft('user_lab', table);
assert.equal(buildNKFromDraft(draft)(600)[1], 0, 'the tabular preview draws the floored curve');
assert.equal(buildNKFromDraft(materialToDraft('user_lab', formula))(550)[1], 0, 'so does the formula preview');

// ── 2. Derivatives ────────────────────────────────────────────────────────────

const linear = createTabulatedNKSampler(rows, 'linear');
const flat = linear.kInterpolator.derivativesAt(600);
assert.deepEqual([flat.value, flat.derivatives[0]], [0, 0], 'a piece between two floored points is flat: value and slope both zero');
const rising = linear.kInterpolator.derivativesAt(620);
near(rising.derivatives[0], 3e-9 / (630.6 - 610.5), 1e-24, 'the piece after a floored point rises from zero, not from the negative value');

// ── 3. A quarter-wave stack ──────────────────────────────────────────────────

// (HL)^10 H at 600 nm, the high index from the table under the program's own
// linear rule, over a lossless low index on glass. Across the span the
// negative points cover, at normal and oblique incidence, the raw table gives
// the stack gain and the floored one never does. The kernel floors the
// absorptance it reports at zero, so gain shows as R + T above 1; the energy
// balance 1 - R - T is what is measured here.
const rawLinearK = createInterpolator(rows.map(r => [r[0], r[2]]), 'linear');
const raw = lam => [linear(lam)[0], rawLinearK(lam)];
const low = 1.46;
const dH = 600 / (4 * linear(600)[0]);
const dL = 600 / (4 * low);
function leastEnergyBalance(high) {
    let least = Infinity;
    for (let lam = 585; lam <= 640; lam += 0.5) {
        const layers = [];
        for (let pair = 0; pair < 10; pair++) layers.push({ n: high(lam), d: dH }, { n: [low, 0], d: dL });
        layers.push({ n: high(lam), d: dH });
        for (const angle of [0, 60]) {
            for (const pol of ['s', 'p']) {
                const { R, T } = tmm(lam, angle, pol, [1, 0], [1.52, 0], layers);
                least = Math.min(least, 1 - R - T);
            }
        }
    }
    return least;
}
const rawLeast = leastEnergyBalance(raw);
const flooredLeast = leastEnergyBalance(linear);
assert.ok(rawLeast < -1e-10, `the raw table gives the stack gain (least 1 - R - T is ${rawLeast})`);
assert.ok(flooredLeast >= -1e-12, `the floored table does not (least 1 - R - T is ${flooredLeast})`);

// ── 4. What the user sees ───────────────────────────────────────────────────

assert.deepEqual(negativeKPoints(table), [[590.599975585938, -2.8840684113368e-15], [610.5, -2.11821316042915e-9]], 'the negative points of an n,k table');
assert.deepEqual(negativeKPoints(formula), [[500, -3e-9], [600, -1e-9]], 'the negative points of a k table, in nm');
assert.deepEqual(negativeKPoints({ tabData: [[500, 1.5, 0]], kTable: [] }), [], 'none in a clean table');

const c = makeTheme();
const t = makeLocale();
const me = t.materialEditor;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const has = (html, text) => html.includes(esc(text));
const count = (html, text) => html.split(esc(text)).length - 1;

const renderForm = d => renderToStaticMarkup(React.createElement(UserMaterialForm, {
    draft: d, onChange() {}, onSave() {}, onRevert() {}, onDelete() {}, dirty: false, catalogs: [], c, t,
}));
{
    const html = renderForm(draft);
    assert.ok(has(html, me.negativeKRows(2)), 'the form says how many rows hold a k below zero');
    assert.equal(count(html, me.negativeKCell), 2, 'and marks each of their k cells');
    const formulaHtml = renderForm(materialToDraft('user_lab', formula));
    assert.ok(has(formulaHtml, me.negativeKRows(2)) && count(formulaHtml, me.negativeKCell) === 2, 'the k table of a formula material is marked the same way');
    const clean = renderForm(materialToDraft('user_lab', { ...table, tabData: rows.map(([lam, n, k]) => [lam, n, Math.max(0, k)]) }));
    assert.ok(!has(clean, me.negativeKCell), 'a clean table shows no mark');
}

const tfx = points => `<?xml version="1.0"?>\r\n<EssentialMacleodMaterial Name="TiO2" NType="1" KType="1" TType="-1"><NKPoints>${points.map(([w, n, k]) => `<NKPoint W="${w}" n="${n}" k="${k}"/>`).join('')}</NKPoints></EssentialMacleodMaterial>\r\n`;
{
    const html = renderToStaticMarkup(React.createElement(MaterialImportDialog, {
        fileImport: {
            files: [
                { name: 'M7', ext: 'tfx', dir: 'Standard', text: tfx(rows) },
                { name: 'M1', ext: 'tfx', dir: 'Standard', text: tfx(rows.map(([lam, n, k]) => [lam, n, Math.max(0, k)])).replace('Name="TiO2"', 'Name="Clean"') },
            ],
            units: DEFAULT_IMPORT_UNITS,
        },
        setFileImport() {}, catalogs: [{ id: 'user_1', name: 'User', source: 'user' }], onCommit() {}, me, c,
    }));
    assert.ok(has(html, me.importNegativeK(2)), 'the import dialog names the count of points with k below zero');
    assert.equal(count(html, 'k < 0'), 1, 'and marks that file in the list, not the clean one');
}

console.log('PASS: negative_k');
