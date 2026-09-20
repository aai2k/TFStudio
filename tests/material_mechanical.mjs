/**
 * The thermo-mechanical constants a material carries beside its dispersion.
 *
 * These are the inputs of the film stress model, so a value that reaches it
 * scaled, rounded or invented is a wrong prediction about a real part. What is
 * checked here is the path from the editor to the record: the unit the form
 * shows is not always the unit the record stores, an empty field means unknown
 * rather than zero, and a material with nothing entered carries no block at
 * all, so a missing constant can always be told from a constant of zero.
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { draftFingerprint, draftToMaterial, emptyDraft, materialToDraft, validateDraft } =
    await import('../src/components/windows/design/materialEditor/materialDraft.js');
const { MECHANICAL_FIELDS, MECHANICAL_UNITS, mechanicalBoundViolation, normalizeMechanical } =
    await import('../src/utils/materials/mechanical.js');
const { parseAGF } = await import('../src/utils/materials/agfParser.js');

// Silica as a coater would type it in: the two temperature coefficients in
// ppm/K, every other field in the unit printed on its label.
const TYPED = {
    youngsModulusGPa: '73',
    poissonsRatio: '0.17',
    linearExpansionPerK: '0.55',
    dnDtPerK: '9.6',
    intrinsicStressMPa: '-180',
    referenceTemperatureC: '250',
    surfaceEnergyJm2: '0.31',
};

// The same seven numbers as the record holds them: SI for the coefficients,
// MPa for the stress because that is the unit a wafer-bow measurement is
// quoted in.
const STORED = {
    youngsModulusGPa: 73,
    poissonsRatio: 0.17,
    linearExpansionPerK: 0.55e-6,
    dnDtPerK: 9.6e-6,
    intrinsicStressMPa: -180,
    referenceTemperatureC: 250,
    surfaceEnergyJm2: 0.31,
};

// Twelve digits is past any measured constant and short of the noise a change
// of scale leaves in the last bits.
const rounded = (value) => Number(value.toPrecision(12));

function draftWith(mechanical) {
    const base = emptyDraft('user_lab');
    return {
        ...base,
        id: 'silica', name: 'Silica',
        rows: [{ _key: 1, lam: '400', n: '1.47', k: '0' }, { _key: 2, lam: '800', n: '1.45', k: '0' }],
        mechanical: { ...base.mechanical, ...mechanical },
    };
}

// Message stubs standing in for the locale, so a failure names the field and
// the rule rather than a sentence in one language.
const me = {
    validationNoName: 'no name',
    validationBadId: 'bad id',
    validationDuplicateId: (id) => `duplicate ${id}`,
    mechanicalFields: Object.fromEntries(MECHANICAL_FIELDS.map(field => [field, field])),
    mechanicalBounds: { positive: 'positive', poisson: 'poisson', nonNegative: 'nonNegative' },
    validationMechanicalNumber: (field) => `${field} is not a number`,
    validationMechanicalBound: (field, rule) => `${field} ${rule}`,
};

// ── Every field states a unit ─────────────────────────────────────────────────

for (const field of MECHANICAL_FIELDS) {
    assert.ok(field in MECHANICAL_UNITS, `${field} states the unit it is shown in`);
}

// ── The form's unit and the record's unit ─────────────────────────────────────

const saved = draftToMaterial(draftWith(TYPED)).mechanical;
for (const field of MECHANICAL_FIELDS) {
    assert.equal(rounded(saved[field]), STORED[field], `${field} is stored in the unit the model reads`);
}
assert.equal(rounded(saved.linearExpansionPerK), 5.5e-7,
    'an expansion coefficient typed as 0.55 ppm/K is 5.5e-7 per kelvin in the record');
assert.equal(rounded(saved.dnDtPerK), 9.6e-6, 'and dn/dT the same way');

assert.deepEqual(
    materialToDraft('user_lab', { id: 'silica', name: 'Silica', formulaNum: -1, tabData: [[400, 1.47, 0]], mechanical: STORED }).mechanical,
    TYPED,
    'and comes back to the form in ppm/K, the way every catalog prints it',
);

assert.equal(
    rounded(draftToMaterial(draftWith({ linearExpansionPerK: '0,55' })).mechanical.linearExpansionPerK),
    5.5e-7,
    'a comma is the decimal separator here as in the n/k grid',
);

// ── Unknown is not zero ───────────────────────────────────────────────────────

const empty = draftToMaterial(draftWith({}));
assert.ok(!('mechanical' in empty), 'a material with nothing entered carries no block, not a block of zeros');

assert.deepEqual(
    draftToMaterial(draftWith({ intrinsicStressMPa: '-320' })).mechanical,
    { intrinsicStressMPa: -320 },
    'a stress measured without the elastic constants is stored on its own',
);

assert.deepEqual(
    materialToDraft('user_lab', { id: 'x', name: 'x', formulaNum: -1, tabData: [[400, 2, 0]] }).mechanical,
    Object.fromEntries(MECHANICAL_FIELDS.map(field => [field, ''])),
    'a material that has no block opens with every field blank',
);

const formula = draftToMaterial({ ...draftWith(TYPED), type: 'formula', coeffs: ['1', '0.6961663', '0.00467914826'] });
assert.deepEqual(formula.mechanical, saved, 'a dispersion-formula material carries the block as well');

assert.notEqual(
    draftFingerprint(draftWith({ youngsModulusGPa: '73' })),
    draftFingerprint(draftWith({})),
    'typing a constant makes the draft dirty',
);

// ── Only physical values ──────────────────────────────────────────────────────

assert.equal(validateDraft(draftWith(TYPED), [], me), null, 'a complete and physical set saves');
assert.equal(validateDraft(draftWith({ youngsModulusGPa: '0' }), [], me), 'youngsModulusGPa positive',
    'a modulus of zero is not a material');
assert.equal(validateDraft(draftWith({ poissonsRatio: '0.5' }), [], me), 'poissonsRatio poisson',
    'the incompressible limit is not reached by a solid');
assert.equal(validateDraft(draftWith({ poissonsRatio: '-0.2' }), [], me), null,
    'an auxetic material is physical and is allowed');
assert.equal(validateDraft(draftWith({ surfaceEnergyJm2: '-1' }), [], me), 'surfaceEnergyJm2 nonNegative');
assert.equal(validateDraft(draftWith({ intrinsicStressMPa: '-4000' }), [], me), null,
    "a compressive stress of any size is the user's number, not ours to bound");
assert.equal(validateDraft(draftWith({ youngsModulusGPa: 'stiff' }), [], me), 'youngsModulusGPa is not a number',
    'something typed that is not a number is reported rather than silently dropped');

assert.equal(mechanicalBoundViolation(undefined), null, 'no block breaks no bound');
assert.deepEqual(mechanicalBoundViolation({ youngsModulusGPa: -1 }), { field: 'youngsModulusGPa', reason: 'positive' });

// ── What normalizing keeps ────────────────────────────────────────────────────

assert.equal(normalizeMechanical({}), undefined);
assert.equal(normalizeMechanical({ youngsModulusGPa: NaN }), undefined, 'NaN is not a value');
assert.equal(normalizeMechanical({ youngsModulusGPa: Infinity }), undefined);
assert.equal(normalizeMechanical({ youngsModulusGPa: '70' }), undefined, 'and neither is the string "70"');
assert.deepEqual(
    normalizeMechanical({ youngsModulusGPa: 70, taperFactor: 1 }),
    { youngsModulusGPa: 70 },
    'a field the model does not read is not carried along',
);

// ── What an AGF catalog brings with it ────────────────────────────────────────

// The ED line carries the expansion coefficient and the MD line the modulus
// and Poisson's ratio (OpticStudio User Manual 2026 R1, p. 1416), which is
// most of what a glass substrate has to state.
const AGF = [
    'CC Test catalog',
    'NM TESTGLASS 2 0 1.51680 64.17 0 0 0',
    'ED 7.1 8.3 2.51 -0.0009 0',
    'CD 1.03961212 0.00600069867 0.231792344 0.0200179144 1.01046945 103.560653 0 0 0 0',
    'MD 82 0.206 610 858 1.114',
    'LD 0.3 2.5',
].join('\n');

const glass = parseAGF(AGF, 'test').materials.TESTGLASS;
assert.equal(rounded(glass.mechanical.linearExpansionPerK), 7.1e-6,
    'the -30/70 °C coefficient of the ED line reaches the field the thermal stress reads');
assert.equal(glass.mechanical.youngsModulusGPa, 82, 'the MD line states the modulus in GPa, the unit the record keeps');
assert.equal(glass.mechanical.poissonsRatio, 0.206, 'and Poisson\'s ratio beside it');
assert.deepEqual(Object.keys(glass.mechanical).sort(),
    ['linearExpansionPerK', 'poissonsRatio', 'youngsModulusGPa'],
    'and nothing else about the glass is inferred from the file');

const zeroed = parseAGF(['NM ZEROED 1 0 1.5 60 0 0 0', 'ED 0 0 2.2 0 0', 'MD 0 0 0 0 0'].join('\n'), 'test').materials.ZEROED;
assert.equal(zeroed.mechanical, undefined, 'a catalog that writes zeros in those fields has stated nothing');

const noEd = parseAGF(['NM PLAIN 1 0 1.5 60 0 0 0', 'CD 1 0 0 0 0 0 0 0 0 0'].join('\n'), 'test').materials.PLAIN;
assert.equal(noEd.mechanical, undefined, 'and a file with neither line gives no block at all');

// ── The two pages of the detail pane ─────────────────────────────────────────

const { UserMaterialForm } = await import('../src/components/windows/design/materialEditor/userMaterialForm.js');
const { renderReadOnlyMaterial } = await import('../src/components/windows/design/materialEditor/materialEditorReadOnly.js');

const c = makeTheme();
const t = makeLocale();
const mel = t.materialEditor;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const has = (html, text) => html.includes(esc(text));

const renderForm = (draft, detailTab) => renderToStaticMarkup(React.createElement(UserMaterialForm, {
    draft, onChange() {}, onSave() {}, onRevert() {}, onDelete() {},
    dirty: false, catalogs: [], detailTab, setDetailTab() {}, c, t,
}));

const nkPage = renderForm(draftWith(TYPED), 'nk');
assert.ok(has(nkPage, mel.nkTab) && has(nkPage, mel.mechanicalTab),
    'both pages are named on either one, so neither is hidden');
assert.ok(has(nkPage, mel.materialId) && has(nkPage, mel.saveMaterial),
    'what identifies the material and the way to save it sit outside the pages');
assert.ok(!has(nkPage, mel.mechanicalHint), 'the constants are not on the n and k page');

const mechanicalPage = renderForm(draftWith(TYPED), 'mechanical');
for (const field of MECHANICAL_FIELDS) {
    assert.ok(has(mechanicalPage, mel.mechanicalFields[field]), `${field} is labelled on the mechanical page`);
    const unit = MECHANICAL_UNITS[field];
    if (unit) assert.ok(has(mechanicalPage, `(${unit})`), `${field} states its unit beside the label`);
}
assert.ok(mechanicalPage.includes('value="0.55"'),
    'the expansion coefficient is offered for editing in ppm/K, not as 5.5e-7');
assert.ok(has(mechanicalPage, mel.materialId) && has(mechanicalPage, mel.saveMaterial),
    'and the header, the identity fields and Save are still there');
assert.ok(!has(mechanicalPage, mel.nkTable), 'while the n/k grid is on the other page');

const bk7 = {
    id: 'bk7', name: 'BK7', formulaNum: 2, coefficients: [1, 1.03961212, 0.006000699],
    lambdaMin: 0.3, lambdaMax: 2.5,
    mechanical: { youngsModulusGPa: 82, linearExpansionPerK: 7.1e-6 },
};
const readOnly = (mat, detailTab) => renderToStaticMarkup(renderReadOnlyMaterial({
    selectedMat: mat, sampledTable: [], chartRef: { current: null },
    openCopyPicker() {}, designConflict: null, detailTab, setDetailTab() {}, me: mel, t, c,
}));

const bk7Mechanical = readOnly(bk7, 'mechanical');
assert.ok(has(bk7Mechanical, mel.mechanicalFields.youngsModulusGPa), 'a catalog material lists what it states');
assert.ok(bk7Mechanical.includes('>7.1<'), 'in the same unit the editor takes');
assert.ok(!has(bk7Mechanical, mel.mechanicalFields.surfaceEnergyJm2),
    'and says nothing about the fields it does not state');
assert.ok(!has(bk7Mechanical, mel.formula), 'the dispersion is on the other page here too');
assert.ok(has(readOnly(bk7, 'nk'), mel.formula), 'which is where it is');

const plain = { ...bk7, mechanical: undefined };
assert.ok(has(readOnly(plain, 'mechanical'), mel.mechanicalNone),
    'a material that carries no constants says so rather than showing seven blanks');

console.log('material_mechanical: ok');
