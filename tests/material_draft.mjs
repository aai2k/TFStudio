/**
 * Unit — Material Editor draft model and converters (materialDraft.js).
 *
 * Pins the pure draft logic that backs the Material Editor's user-material form:
 *   - buildNKFromDraft: PCHIP interpolation (empty / single / multi-row, with
 *     endpoint clamping) and formula-mode sampling via evalN + a k-table.
 *   - materialToDraft ↔ draftToMaterial roundtrip for both material types.
 *   - validateDraft rules (name / id / duplicate-id).
 *
 * These functions were split out of MaterialEditor.js; buildNKFromDraft in
 * particular was refactored from one monolithic function into a tabular sampler
 * + a formula sampler, so this locks the interpolation math against regression.
 *
 * Run: node tests/material_draft.mjs
 */

const {
    buildNKFromDraft, materialToDraft, draftToMaterial, validateDraft, emptyDraft,
    coefficientSlots, withFormula, withAddedTerm,
} = await import('../src/components/windows/design/materialEditor/materialDraft.js');
const { evalN } = await import('../src/utils/materials/dispersionFormulas.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('  ✓', msg); } };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

const tabDraft = (rows) => ({ type: 'tabular', rows: rows.map(([lam, n, k]) => ({ lam: String(lam), n: String(n), k: String(k ?? 0) })) });

// ── 1. Tabular sampler — empty / single / multi with clamping ─────────────────
ok(buildNKFromDraft(tabDraft([])) === null, 'empty tabular draft → null sampler');

const one = buildNKFromDraft(tabDraft([[500, 1.5, 0.01]]));
ok(typeof one === 'function', 'single-row draft → constant sampler function');
{ const [n, k] = one(200); ok(n === 1.5 && k === 0.01, 'single row: constant below'); }
{ const [n, k] = one(9000); ok(n === 1.5 && k === 0.01, 'single row: constant above'); }

const two = buildNKFromDraft(tabDraft([[400, 1.5, 0.00], [600, 1.7, 0.02]]));
{ const [n, k] = two(300); ok(n === 1.5 && k === 0.00, 'multi: clamp to first endpoint below range'); }
{ const [n, k] = two(700); ok(n === 1.7 && k === 0.02, 'multi: clamp to last endpoint above range'); }
{ const [n, k] = two(500); ok(close(n, 1.6) && close(k, 0.01), 'two points: straight-line interpolation at midpoint'); }
{ const [n, k] = two(450); ok(close(n, 1.55) && close(k, 0.005), 'two points: straight-line interpolation at quarter'); }

const shaped = buildNKFromDraft(tabDraft([
    [1, 1, 0], [1.7, 2.4, 0.2], [2.9, 2.1, 0.1], [4, 4, 0.3], [6.5, 3.7, 0.2],
]));
{ const [n, k] = shaped(3.5); ok(close(n, 3.179188580015026, 2e-14), 'multi-row n uses shape-preserving PCHIP'); ok(k >= 0.1 && k <= 0.3, 'multi-row k remains inside its segment envelope'); }

// Unsorted input must be sorted before interpolation.
const unsorted = buildNKFromDraft(tabDraft([[600, 1.7, 0.02], [400, 1.5, 0.0]]));
{ const [n] = unsorted(500); ok(close(n, 1.6), 'unsorted rows are sorted before interpolation'); }

// ── 2. Formula sampler — evalN for n, k-table interpolation for k ─────────────
// Sellmeier-1 (formula 1): n^2 = 1 + Σ Bᵢ λ² / (λ² − Cᵢ). Fused silica-ish coeffs.
const formulaDraft = {
    type: 'formula', formulaNum: 1,
    coeffs: ['0.6961663', '0.0684043', '0.4079426', '0.1162414', '0.8974794', '9.896161', '', '', '', ''],
    kRows: [{ lam: '400', k: '0.0' }, { lam: '800', k: '0.4' }],
};
const fs = buildNKFromDraft(formulaDraft);
ok(typeof fs === 'function', 'valid formula draft → sampler function');
{ const [n, k] = fs(600); ok(isFinite(n) && n > 0, `formula n(600nm) finite & positive (got ${n.toFixed(4)})`); ok(close(k, 0.2, 1e-9), 'formula k interpolated at 600nm midpoint'); }
{ const [, k] = fs(300); ok(k === 0.0, 'formula k clamps below k-table range'); }
{ const [, k] = fs(1000); ok(k === 0.4, 'formula k clamps above k-table range'); }

// A degenerate formula (all-zero coeffs → n=1 at 0.55µm is not >0 test path) still
// returns a sampler for formula 1 (n=1 is finite & >0), so guard the null path via
// a formula that cannot evaluate to a positive index: empty coeffs on Sellmeier
// give n^2 = 1 → n = 1 (valid). Use formula 2 with coeffs forcing non-finite.
const badDraft = { type: 'formula', formulaNum: 1, coeffs: Array(10).fill('0'), kRows: [] };
{ const s = buildNKFromDraft(badDraft); ok(typeof s === 'function', 'all-zero Sellmeier → n=1 sampler (finite, valid)'); const [n] = s(550); ok(close(n, 1.0), 'all-zero Sellmeier gives n=1'); }

// ── 3. materialToDraft ↔ draftToMaterial roundtrip (tabular) ──────────────────
const tabMat = {
    id: 'MyTab', name: 'My Tabular', formulaNum: -1,
    tabData: [[400, 1.5, 0], [700, 1.45, 0.001]],
    lambdaMin: 0.4, lambdaMax: 0.7, coefficients: [], kTable: [], color: 'auto',
    dispersionFit: {
        active: true, rangeNm: [400, 700], source: 'tabulated n/k',
        n: { kind: 'cauchy', coefficients: [1.4, .01] },
        k: { kind: 'zero', coefficients: [] },
        residuals: {
            n: { rms: .001, max: .002, points: 2 },
            k: { rms: 0, max: 0, points: 2 },
        },
    },
};
const tabD = materialToDraft('user_cat', tabMat);
ok(tabD.type === 'tabular' && tabD.rows.length === 2, 'materialToDraft: tabular → 2 rows');
ok(tabD.id === 'MyTab' && tabD.originalId === 'MyTab', 'materialToDraft: id + originalId set');
const tabBack = draftToMaterial(tabD);
ok(tabBack.formulaNum === -1 && tabBack.tabData.length === 2, 'draftToMaterial: tabular roundtrip keeps rows');
ok(close(tabBack.tabData[0][0], 400) && close(tabBack.tabData[1][1], 1.45), 'draftToMaterial: tabular values preserved');
ok(tabBack.interp === 'pchip', 'draftToMaterial: tabular rule is stored');
ok(
    JSON.stringify(tabBack.dispersionFit) === JSON.stringify(tabMat.dispersionFit),
    'tabular roundtrip preserves the material-owned dispersion fit',
);

const metalFit = {
    active: true, rangeNm: [400, 800], source: 'tabulated n/k',
    complex: {
        kind: 'drude-lorentz', epsilonInfinity: 3, plasmaEnergyEv: 8.8,
        drudeDampingEv: 0.1,
        oscillators: [
            { strengthEv2: 5, resonanceEv: 2.7, dampingEv: 0.6 },
            { strengthEv2: 2, resonanceEv: 4.1, dampingEv: 0.9 },
        ],
    },
    residuals: {
        n: { rms: .01, max: .02, points: 20 },
        k: { rms: .01, max: .02, points: 20 },
    },
};
const metalDraft = materialToDraft('user_cat', { ...tabMat, dispersionFit: metalFit });
ok(metalDraft.fitModel === 'drude-lorentz',
    'materialToDraft restores the model a stored fit was made with');
ok(JSON.stringify(draftToMaterial(metalDraft).dispersionFit) === JSON.stringify(metalFit),
    'Drude-Lorentz fit survives the material roundtrip');

// ── 4. materialToDraft ↔ draftToMaterial roundtrip (formula) ──────────────────
const formMat = {
    id: 'MyForm', name: 'My Formula', formulaNum: 2,
    coefficients: [1.1, 0.05, 0.2, 0.03], kTable: [{ lam_um: 0.4, k: 0 }, { lam_um: 0.8, k: 0.1 }],
    lambdaMin: 0.3, lambdaMax: 2.0, tabData: [], color: '#c39bd3',
};
const formD = materialToDraft('user_cat', formMat);
ok(formD.type === 'formula' && formD.formulaNum === 2, 'materialToDraft: formula type/num');
ok(formD.kRows.length === 2 && formD.kRows[0].lam === '400', 'materialToDraft: kTable → kRows in nm');
const formBack = draftToMaterial(formD);
ok(formBack.formulaNum === 2 && formBack.kTable.length === 2, 'draftToMaterial: formula roundtrip keeps kTable');
ok(close(formBack.coefficients[0], 1.1) && close(formBack.kTable[1].k, 0.1), 'draftToMaterial: formula coeffs/k preserved');
ok(formBack.interp === 'pchip', 'draftToMaterial: k-table rule is stored');

// ── 5. validateDraft ──────────────────────────────────────────────────────────
const me = {
    validationNoName: 'no-name',
    validationBadId: 'bad-id',
    validationDuplicateId: (id) => `dup:${id}`,
};
ok(validateDraft({ ...emptyDraft('c'), name: '' }, [], me) === 'no-name', 'validate: empty name rejected');
ok(validateDraft({ ...emptyDraft('c'), name: 'X', id: 'bad id!' }, [], me) === 'bad-id', 'validate: illegal id chars rejected');
ok(validateDraft({ ...emptyDraft('c'), name: 'X', id: 'good_id', isNew: false }, [], me) === null, 'validate: valid non-new draft passes');
const catsDup = [{ id: 'c', materials: { taken: { id: 'taken' } } }];
ok(validateDraft({ ...emptyDraft('c'), name: 'X', id: 'taken', isNew: true, catalogId: 'c' }, catsDup, me) === 'dup:taken', 'validate: duplicate id in new draft rejected');
ok(validateDraft({ ...emptyDraft('c'), name: 'X', id: 'fresh', isNew: true, catalogId: 'c' }, catsDup, me) === null, 'validate: unused id in new draft passes');

// ── 6. Open-ended series keep exactly the terms they carry ───────────────────
const cauchyMat = {
    id: 'cau', name: 'Cauchy', formulaNum: 102, coefficients: [2.25, -0.014, 0.0099, 0.0002],
    lambdaMin: 0.36, lambdaMax: 1.0, kTable: [], tabData: [], color: 'auto',
};
const cauchyDraft = materialToDraft('user_cat', cauchyMat);
ok(cauchyDraft.coeffs[3] === '0.0002', 'materialToDraft: fourth Cauchy term kept');
ok(draftToMaterial(cauchyDraft).coefficients.length === 4, 'draftToMaterial: four-term Cauchy stays four terms');
ok(draftToMaterial({ ...cauchyDraft, coeffs: ['2.25', '-0.014', '0.0099', '', '', '', '', '', '', ''] }).coefficients.length === 3,
    'draftToMaterial: empty trailing Cauchy fields are not terms');
const sellDraft = materialToDraft('user_cat', { ...cauchyMat, formulaNum: 101, coefficients: [1, 1.03, 0.006, 0.23, 0.02, 1.01, 103.5, 0.5, 0] });
ok(draftToMaterial(sellDraft).coefficients.length === 9, 'draftToMaterial: a Sellmeier pair with one zero half stays a whole pair');
ok(draftToMaterial({ ...sellDraft, coeffs: sellDraft.coeffs.map((v, i) => (i >= 7 ? '' : v)) }).coefficients.length === 7,
    'draftToMaterial: an empty extra Sellmeier pair is dropped');
ok(draftToMaterial(formD).coefficients.length === 10, 'draftToMaterial: fixed formulas keep their coefficient slots');

// ── 7. Shown coefficient fields: explicit count, formula switch, Add term ────
ok(coefficientSlots(cauchyDraft) === 4, 'coefficientSlots: an imported four-term Cauchy shows four fields');
ok(coefficientSlots({ ...cauchyDraft, coeffs: ['2.25', '-0.014', '0.0099', '', '', '', '', '', '', ''] }) === 4,
    'coefficientSlots: emptying the last field to retype it keeps the field');
ok(coefficientSlots({ ...cauchyDraft, coeffSlots: undefined }) === 4, 'coefficientSlots: a draft without the count falls back to the values');
ok(coefficientSlots(formD) === 6, 'coefficientSlots: fixed formula shows its own list');
ok(coefficientSlots(emptyDraft('c')) === 6, 'coefficientSlots: empty draft');

const sellmeier5 = materialToDraft('user_cat', { ...cauchyMat, formulaNum: 11, coefficients: [1.03, 0.006, 0.23, 0.02, 1.01, 103.5, 0.1, 0.5, 0.2, 1.2] });
const switched = withFormula(sellmeier5, 102);
ok(switched.formulaNum === 102 && coefficientSlots(switched) === 3, 'withFormula: switching to Cauchy shows three fields');
ok(switched.coeffs.slice(3).every(v => v === ''), 'withFormula: slots beyond the new formula are cleared');
{
    const saved = draftToMaterial(switched);
    ok(saved.coefficients.length === 3, 'withFormula: stale values do not become Cauchy terms');
    const l2 = 0.55 * 0.55;
    ok(close(evalN(102, saved.coefficients, 0.55), 1.03 + 0.006 / l2 + 0.23 / (l2 * l2)),
        'withFormula: the saved index is the three-term Cauchy of the kept slots, not of all ten');
}
const grown = withAddedTerm(cauchyDraft);
ok(coefficientSlots(grown) === 5 && grown.coeffs[4] === '', 'withAddedTerm: one more empty Cauchy field');
ok(draftToMaterial(grown).coefficients.length === 4, 'withAddedTerm: an empty added term is not saved');
const sellGrown = withAddedTerm(sellDraft);
ok(coefficientSlots(sellGrown) === 11, 'withAddedTerm: a Sellmeier term is a pair');
ok(withAddedTerm(formD) === formD, 'withAddedTerm: no-op on a fixed formula');

// k-table wavelengths keep their decimals through the draft.
const finek = materialToDraft('user_cat', { ...cauchyMat, kTable: [{ lam_um: 0.1204, k: 0.001 }, { lam_um: 0.1208, k: 0.0009 }] });
ok(finek.kRows[0].lam === '120.4' && finek.kRows[1].lam === '120.8', 'materialToDraft: sub-nanometre k rows stay distinct');

if (fails) { console.error(`\n${fails} test(s) FAILED`); process.exit(1); }
console.log('\nAll tests passed.');
