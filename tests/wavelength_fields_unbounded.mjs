/**
 * Wavelength and step fields take any positive value.
 *
 * Every window chose its own limits for a wavelength: T/R/A stopped at 20 µm,
 * most analysis windows at 30 µm, the E-field at 10 µm, the Filter Design
 * wizard at 5 µm, and nearly all of them at 100 nm at the short end. Nothing in
 * the physics asked for any of it, and the analysis fields clamped without a
 * word, so 125000 typed into T/R/A became 20000. Step fields were capped the
 * same way. Now a wavelength or a step has one rule, the only one the physics
 * has: it is positive. Zero or a negative entry is refused like unparseable
 * text.
 *
 * Checked here: each kind of input field with typed values, each window's
 * wavelength and step fields declared that way, the Settings registry, the
 * spectrum computed out to 125 µm, and a built-in material copied to a user
 * catalog over its own range.
 *
 * Run: node tests/wavelength_fields_unbounded.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── A React just large enough to type into a field ──────────────────────────

let hooks = null;
globalThis.React = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    Fragment: 'fragment',
    useState: initial => hooks.state(initial),
    useEffect: () => {},
    useRef: initial => ({ current: initial }),
    useCallback: fn => fn,
    useMemo: fn => fn(),
};
globalThis.window = { dispatchEvent() {} };

// Renders `Component` as React would, keeping its state from one render to the next.
function mount(Component, props) {
    const slots = [];
    let index = 0;
    const store = {
        state(initial) {
            const slot = index++;
            if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
            return [slots[slot], next => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }];
        },
    };
    return () => { hooks = store; index = 0; return Component(props); };
}

function inputOf(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'input') return node;
    for (const child of [node.props?.children].flat(Infinity)) {
        const found = inputOf(child);
        if (found) return found;
    }
    return null;
}

// Types `text` into a field that commits on blur, then leaves it.
function enter(Component, props, text) {
    const taken = [];
    const render = mount(Component, { ...props, onChange: value => taken.push(value) });
    inputOf(render()).props.onChange({ target: { value: text } });
    inputOf(render()).props.onBlur();
    return { taken, shown: String(inputOf(render()).props.value) };
}

// Renders the components inside `node` in place, as React would.
function expand(node) {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: [node.props?.children].flat(Infinity).map(expand) } };
}

// A field that takes every keystroke, kept from one render to the next.
function mountField(field, props) {
    return mount(fieldProps => expand(field(fieldProps)), props);
}

// Types `text` into a field that takes every keystroke.
function keystroke(field, props, text) {
    const taken = [];
    inputOf(mountField(field, { ...props, onChange: value => taken.push(value) })()).props.onChange({ target: { value: text } });
    return taken;
}

const c = { field: '#111', text: '#eee', textDim: '#999', border: '#333', bg: '#000', panel: '#111', accent: '#39f' };

// ── Fields that commit on blur ───────────────────────────────────────────────

const { NumInput } = await import('../src/components/windows/analysis/chrome/controls.js');
const { NumberRow } = await import('../src/components/dialogs/settings/analysis/FieldRows.js');

for (const [name, Component, props] of [
    ['analysis field', NumInput, { value: 400, positive: true, step: 10, c }],
    ['Settings row', NumberRow, { value: 400, spec: { def: 400, positive: true, step: 10 }, c, label: 'λ' }],
]) {
    assert.deepEqual(enter(Component, props, '20').taken, [20], `${name}: 20 nm is taken as typed`);
    assert.deepEqual(enter(Component, props, '125000').taken, [125000], `${name}: 125000 nm is taken as typed`);
    assert.deepEqual(enter(Component, props, '0.001').taken, [0.001], `${name}: so is a step of 0.001 nm`);
    for (const refused of ['0', '-5']) {
        const { taken, shown } = enter(Component, props, refused);
        assert.deepEqual(taken, [], `${name}: ${refused} is refused`);
        assert.equal(shown, '400', `${name}: and the field goes back to what it held`);
    }
}

// The arrow keys stop short of zero rather than stepping onto it.
{
    const taken = [];
    const render = mount(NumInput, { value: 5, positive: true, step: 10, c, onChange: value => taken.push(value) });
    inputOf(render()).props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
    assert.deepEqual(taken, [], 'stepping a positive field down to -5 is refused');
    inputOf(render()).props.onKeyDown({ key: 'ArrowUp', preventDefault() {} });
    assert.deepEqual(taken, [15], 'stepping it up still works');
}

// A field with real bounds, an angle, still has them.
assert.deepEqual(enter(NumInput, { value: 0, min: 0, max: 89, c }, '95').taken, [89], 'an angle above 89° is still clamped');

// ── Fields that take every keystroke ─────────────────────────────────────────

const wizard = await import('../src/components/windows/simulation/wizardShared.js');
const filterWizard = await import('../src/components/windows/optimization/filterDesignWizard/ui.js');

for (const [name, field] of [
    ['monitoring wizard cell', wizard.cellNum],
    ['monitoring wizard row', wizard.RowField],
    ['monitoring wizard field', wizard.NumField],
    ['Filter Design field', filterWizard.NumField],
]) {
    const props = { value: 550, positive: true, step: 1, c, label: 'λ' };
    assert.deepEqual(keystroke(field, props, '20'), [20], `${name}: 20 nm is taken`);
    assert.deepEqual(keystroke(field, props, '125000'), [125000], `${name}: 125000 nm is taken`);
    for (const refused of ['0', '-5', '']) {
        assert.deepEqual(keystroke(field, props, refused), [], `${name}: "${refused}" is not taken`);
    }
    // What is typed stays in the field, so 0.5 can be typed into an emptied one.
    const taken = [];
    const render = mountField(field, { ...props, onChange: value => taken.push(value) });
    for (const text of ['', '0', '0.', '0.5']) inputOf(render()).props.onChange({ target: { value: text } });
    assert.equal(String(inputOf(render()).props.value), '0.5', `${name}: shows 0.5 as it is typed`);
    assert.deepEqual(taken, [0.5], `${name}: and takes only 0.5`);
    inputOf(render()).props.onBlur();
    assert.equal(String(inputOf(render()).props.value), '550', `${name}: leaving it shows the value it holds`);
}
assert.deepEqual(keystroke(wizard.RowField, { value: 5, step: 1, c, label: 'drift' }, ''), [0],
    'a wizard field that is not a wavelength still reads an emptied entry as 0');

// ── The spectral range in Settings ───────────────────────────────────────────

const { ANALYSIS_DEFAULTS, numberAllowed } = await import('../src/constants/analysisDefaults.js');
const { resolveAnalysisSettings } = await import('../src/utils/analysisSettings.js');
const { SpectralRangeRows } = await import('../src/components/dialogs/settings/analysis/SpectralRangeRows.js');
const { getLocale } = await import('../src/constants/locales/index.js');

{
    const stored = [];
    const rows = SpectralRangeRows({
        registry: ANALYSIS_DEFAULTS.opticalEvaluation,
        resolved: resolveAnalysisSettings('opticalEvaluation', {}),
        onChange: (section, key, value) => stored.push([key, value]),
        c, t: getLocale('en'),
    }).props.children.filter(child => child && typeof child.type === 'function' && child.props.onCommit);
    const [fromRow, toRow, stepRow] = rows;
    const commitInto = (row, text) => {
        stored.length = 0;
        const render = mount(row.type, row.props);
        inputOf(render()).props.onChange({ target: { value: text } });
        inputOf(render()).props.onBlur();
        return Object.fromEntries(stored);
    };
    assert.deepEqual(commitInto(toRow, '125000'), { lambdaStart: 400, lambdaEnd: 125000 }, 'Settings stores a range out to 125 µm');
    assert.deepEqual(commitInto(fromRow, '20'), { lambdaStart: 20, lambdaEnd: 800 }, 'and one from 20 nm');
    assert.deepEqual(commitInto(stepRow, '0.001'), { lambdaStep: 0.001 }, 'and a step of 0.001 nm');
    assert.deepEqual(commitInto(stepRow, '0'), {}, 'a zero step is refused');
    assert.deepEqual(commitInto(toRow, '-5'), {}, 'so is a negative wavelength');
    assert.deepEqual(commitInto(fromRow, '0.00002'), { lambdaStart: 0.00002, lambdaEnd: 800 },
        'a wavelength of 0.00002 nm is stored as typed, not rounded to 0');
    const small = SpectralRangeRows({
        registry: ANALYSIS_DEFAULTS.opticalEvaluation,
        resolved: resolveAnalysisSettings('opticalEvaluation', { opticalEvaluation: { numbers: { lambdaStart: 0.3 } } }),
        onChange() {}, c, t: getLocale('en'),
    }).props.children.find(child => child && typeof child.type === 'function' && child.props.onCommit);
    assert.equal(small.props.value, 0.3, 'and 0.3 nm is shown as 0.3, not 0');
}

// ── The registry every window and Settings start from ────────────────────────

const REGISTRY_FIELDS = {
    opticalEvaluation: ['lambdaStart', 'lambdaEnd', 'lambdaStep'],
    wavelengthAngleMap: ['lambdaStart', 'lambdaEnd', 'lambdaStep'],
    colorEvaluation: ['step'],
    gdGddEvaluation: ['lamStart', 'lamEnd'],
    materialDispersion: ['start', 'end'],
    ellipsometryEvaluation: ['lambdaStart', 'lambdaEnd', 'lambdaStep'],
    integralValues: ['lambdaStart', 'lambdaEnd', 'lambdaStep'],
    errorAnalysis: ['lambdaStart', 'lambdaEnd', 'lambdaStep'],
    inhomogeneities: ['lambdaStart', 'lambdaEnd', 'lambdaStep'],
    systematicDeviations: ['lambdaStart', 'lambdaEnd', 'lambdaStep'],
    roughnessScattering: ['lambdaStart', 'lambdaEnd', 'lambdaStep'],
};
for (const [windowId, keys] of Object.entries(REGISTRY_FIELDS)) {
    for (const key of keys) {
        const spec = ANALYSIS_DEFAULTS[windowId].numbers[key];
        const where = `${windowId}.${key}`;
        assert.equal(spec.positive, true, `${where} is declared positive`);
        assert.ok(spec.min === undefined && spec.max === undefined, `${where} has no other bound`);
        assert.ok(numberAllowed(spec, 20) && numberAllowed(spec, 125000), `${where} allows 20 and 125000`);
        assert.ok(!numberAllowed(spec, 0) && !numberAllowed(spec, -5), `${where} does not allow 0 or -5`);
    }
}

// ── Each window's own fields ─────────────────────────────────────────────────
//
// The props object a field is given, read from the window's source: it says
// `positive: true` and carries no min or max.

const read = path => readFileSync(new URL(`../src/components/windows/${path}`, import.meta.url), 'utf8');

function propsAround(source, at) {
    let start = at, depth = 0;
    while (start > 0) {
        start--;
        if (source[start] === '}') depth++;
        else if (source[start] === '{') { if (depth === 0) break; depth--; }
    }
    let end = at;
    depth = 0;
    while (end < source.length) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') { if (depth === 0) break; depth--; }
        end++;
    }
    return source.slice(start, end + 1);
}

function fieldProps(path, expr) {
    const source = read(path);
    const at = source.search(new RegExp(`value: ${expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,\\s]`));
    assert.ok(at >= 0, `${path}: a field showing ${expr}`);
    return propsAround(source, at);
}

const WINDOW_FIELDS = {
    'analysis/opticalEvaluation/SetupPanel.js': ['range.start', 'range.end', 'params.lambdaStep'],
    'analysis/gdGddEvaluation/GDControls.js': ['state.lamStart', 'state.lamEnd', 'state.refLam'],
    'analysis/systematicDeviations/SystematicControls.js': ['state.lambdaStart', 'state.lambdaEnd', 'state.lambdaStep'],
    'analysis/errorAnalysis/ErrorControls.js': ['params.lambdaStart', 'params.lambdaEnd', 'params.lambdaStep'],
    'analysis/ellipsometryEvaluation/EllipsometryControls.js':
        ['state.lambdaStart', 'state.lambdaEnd', 'state.lambdaStep', 'state.lambdaNm'],
    'analysis/integralValues/Controls.js':
        ['params.lambdaStart', 'params.lambdaEnd', 'params.lambdaStep', 'builder.bandMin', 'builder.bandMax'],
    'analysis/roughnessScattering/RoughnessControls.js': ['state.lambdaStart', 'state.lambdaEnd', 'state.lambdaStep'],
    'analysis/inhomogeneities/InhomogeneityControls.js': ['state.lambdaStart', 'state.lambdaEnd', 'state.lambdaStep'],
    'analysis/wavelengthAngleMap/MapControls.js': ['state.lambdaStart', 'state.lambdaEnd', 'state.lambdaStep'],
    'analysis/materialDispersion/MaterialDispersionEvaluation.js': ['state.start', 'state.end'],
    'analysis/admittanceDiagram/AdmittanceControls.js': ['state.lambda'],
    'analysis/eFieldEvaluation/EFieldControls.js': ['state.axisRefLambda', 'state.lambda'],
    'analysis/refractiveIndexProfiler/ProfilerControls.js': ['state.lambda'],
    'analysis/layerThicknesses/ThicknessControls.js': ['state.lambda'],
    'analysis/colorEvaluation/ColorControls.js': ['state.step'],
    'analysis/plotEngine/CurveRow.js': ['curve.rangeStep', 'curve.lambdaFixed_nm'],
    'analysis/plotEngine/SurfacePanel.js': ['spec.fixedLambda_nm'],
    'simulation/monoWizard/PageMonoLambdas.js': ['bulk', 'm.lambda ?? 550'],
    'simulation/bbmWizard/PageMonSystem.js': ['p.lamMin', 'p.lamMax'],
    'simulation/monitorWorksheet/WorksheetControls.js': ['state.bulkLambda'],
    'dataExchange/spectrumExchange/ExportTab.js': ['dStart', 'dEnd', 'dStep'],
    'dataExchange/spectrumExchange/MeasuredFitDialog.js': ['fitConfig.stepNm'],
    'dataExchange/measuredEllipsometry/ExportTab.js': ['expStart', 'expEnd', 'expStep'],
    'dataExchange/processSimulator/ProcessControls.js':
        ['setup.lambdaStart', 'setup.lambdaEnd', 'setup.lambdaStep', 'setup.exportStep'],
    'dataExchange/zemaxCoatings/ZemaxLayout.js': ['refNm'],
    'dataExchange/zemaxCoatings/ExportTab.js': ['gStart', 'gEnd', 'gStep'],
    'dataExchange/codevCoatings/ExportTab.js': ['refNm', 'gStart', 'gEnd', 'gStep'],
    'dataExchange/nkCharacterization/CharacterizationControls.js':
        ['Number(settings.lambdaStart) || 0', 'Number(settings.lambdaEnd) || 0'],
    'information/report/BlockSettings.js': ['on ? s.tableStep : 10', 's.lambdaStep', 's.step'],
    'optimization/filterDesignWizard/StepParams.js': ['p.lambda0_nm'],
};
for (const [path, exprs] of Object.entries(WINDOW_FIELDS)) {
    for (const expr of exprs) {
        const props = fieldProps(path, expr);
        assert.match(props, /positive: true/, `${path}: the field showing ${expr} is declared positive`);
        assert.doesNotMatch(props, /\b(min|max):/, `${path}: the field showing ${expr} has no other bound`);
    }
}

// The report's range fields share one declaration.
assert.match(read('information/report/BlockSettings.js'), /const LAMBDA = \{ positive: true \};/,
    'the report range fields are positive with no other bound');
assert.match(fieldProps('information/report/BlockSettings.js', 's.lambdaStart'), /\.\.\.LAMBDA/);

// Native fields that were bounded only through their min and max.
for (const [path, expr] of [
    ['design/stackFormula/FormulaPanel.js', 'state.refLambda'],
    ['design/materialEditor/userMaterialForm.js', 'draft.lambdaMinNm'],
    ['design/materialEditor/userMaterialForm.js', 'draft.lambdaMaxNm'],
]) {
    assert.doesNotMatch(fieldProps(path, expr), /\b(min|max):/, `${path}: the field showing ${expr} has no bound`);
}
assert.match(read('design/stackFormula/FormulaPanel.js'), /if \(v > 0\) state\.setRefLambda\(v\)/,
    'the Stack Formula reference wavelength still refuses zero and below');

// ── Merit Function Editor wizard templates ───────────────────────────────────

const { FILTER_TYPES } = await import('../src/utils/physics/optimizer/filterCatalog.js');
const wavelengthKey = /^(lam|pass|stop|lowStop|highStop|lowPass|highPass)/;
let templateFields = 0;
for (const [typeId, type] of Object.entries(FILTER_TYPES)) {
    for (const field of type.fields.filter(f => wavelengthKey.test(f.key))) {
        templateFields++;
        assert.equal(field.positive, true, `${typeId}.${field.key} is declared positive`);
        assert.ok(field.min === undefined && field.max === undefined, `${typeId}.${field.key} has no other bound`);
    }
}
assert.ok(templateFields >= 50, `every template wavelength is checked (${templateFields})`);
const dmf = read('optimization/meritFunctionEditor/DMFWizard.js');
assert.match(dmf, /positive: def\.positive/, 'the wizard hands a template field its positive rule');
assert.match(dmf, /numberInput\(s, session\.stepNm, [^\n]*\{ positive: true, step: 0\.5 \}\)/,
    'the discrete step is positive with no other bound');

const { buildWizardBlock } = await import('../src/components/windows/optimization/meritFunctionEditor/meritOperandModel.js');
const tw = getLocale('en').meritFunctionEditor.wizard;
const discrete = buildWizardBlock({
    tw, typeId: 'BBAR', params: { lamStart: 13, lamEnd: 14 }, pol: 'avg', targetMode: 'discrete',
    stepNm: 0.05, aoi: 0, aoiEnd: 0, aoiSteps: 1,
    minEnabled: false, maxEnabled: false, totalEnabled: false,
});
const points = [...new Set(discrete.filter(op => op.lambdaStart === op.lambdaEnd && op.lambdaStart > 0).map(op => op.lambdaStart))];
assert.equal(points.length, 21, `a 0.05 nm step over 13-14 nm gives 21 points, not the 0.1 nm floor's 11 (got ${points.length})`);

// ── The spectrum itself, from 2 to 125 µm ────────────────────────────────────

const { evaluateSpectrum } = await import('../src/utils/physics/thinFilmMath.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
{
    const spectrum = evaluateSpectrum({ lambdaStart: 2000, lambdaEnd: 125000, lambdaStep: 100, theta: 0, polarization: 'avg' },
        getMaterial('Air'), getMaterial('Ge'), [{ material: getMaterial('ZrO2'), thickness: 800 }]);
    assert.equal(spectrum.lambda[0], 2000, 'T/R/A starts at 2 µm');
    assert.equal(spectrum.lambda.at(-1), 125000, 'and ends at 125 µm');
    assert.equal(spectrum.lambda.length, 1231, 'every 100 nm in between');
    assert.ok(spectrum.T.every((T, i) => Number.isFinite(T) && T >= 0 && T + spectrum.R[i] <= 1 + 1e-9),
        'with a physical T and R at every wavelength');
}

// ── A built-in material copied to a user catalog ─────────────────────────────

const { initCatalogs, getCatalogs, copyMaterialToCatalog } = await import('../src/utils/materials/catalogManager.js');
const { builtinMaterialRows } = await import('../src/utils/materials/catalogManager/builtinCatalog.js');
const { materialToDraft, draftToMaterial, draftRangeNm } =
    await import('../src/components/windows/design/materialEditor/materialDraft.js');

initCatalogs({ user_lab: { id: 'user_lab', name: 'Lab', source: 'user', materials: {} } });
const builtin = getCatalogs().find(cat => cat.id === 'builtin').materials;
{
    const zro2 = builtin.ZrO2;
    const copy = copyMaterialToCatalog(zro2, 'user_lab');
    assert.deepEqual(copy.tabData, zro2.getNK.tabData, 'a copied table material keeps every row of its own');
    assert.deepEqual([copy.tabData[0][0], copy.tabData.at(-1)[0]], [130.1, 33000], 'ZrO2 from 130 nm to 33 µm');
    const draft = materialToDraft('user_lab', zro2);
    assert.equal(draft.rows.length, zro2.getNK.tabData.length, 'and so does a draft made from it');

    const silica = builtinMaterialRows(builtin.SiO2);
    assert.equal(silica.length, 200, 'a Sellmeier material is sampled at 200 points');
    assert.deepEqual([silica[0][0], silica.at(-1)[0]],
        [Math.round(builtin.SiO2.lambdaMin * 1000), Math.round(builtin.SiO2.lambdaMax * 1000)],
        'over its own range');
}

// ── The Material Editor's stated range ───────────────────────────────────────

{
    const form = { lambdaMinNm: '13.5', lambdaMaxNm: '20' };
    assert.deepEqual(draftRangeNm(form), [13.5, 20], 'a stated range of 13.5 to 20 nm is kept');
    assert.deepEqual(draftRangeNm({ lambdaMinNm: '2000', lambdaMaxNm: '125000' }), [2000, 125000], 'and one to 125 µm');
    assert.deepEqual(draftRangeNm({ lambdaMinNm: '-5', lambdaMaxNm: '' }), [300, 2500],
        'an entry that is not a positive wavelength gives the default');
    assert.deepEqual(draftRangeNm({ lambdaMinNm: '800', lambdaMaxNm: '400' }), [800, 900],
        'an end below the start is put 100 nm past it, as before');
    const saved = draftToMaterial({
        id: 'euv', name: 'EUV', color: 'auto', type: 'formula', formulaNum: 2, coeffs: ['1', '0'],
        kRows: [], rows: [], lambdaMinNm: '13.5', lambdaMaxNm: '20', mechanical: {},
    });
    assert.deepEqual([saved.lambdaMin, saved.lambdaMax], [0.0135, 0.02], 'and saved as stated');
}

// ── Grids from a typed step ──────────────────────────────────────────────────
//
// A grid built by adding the step to a running wavelength never ends once the
// step is too small to move it. These grids count their points instead: the
// finest step gives its grid, or more points than an array holds, and the
// window says so rather than stopping.

const { buildGrid } = await import('../src/utils/io/zemaxCoatingFile.js');
const { computeSpectral } = await import('../src/components/windows/analysis/ellipsometryEvaluation/spectrum.js');
const { computeGdGdd } = await import('../src/utils/report/reportData/dispersion.js');
const { computeEllipsometrySpectrum } = await import('../src/utils/report/reportData/profiles.js');
{
    const design = {
        incidentMedium: 'Air', substrate: { material: 'builtin:BK7' },
        frontLayers: [{ material: 'builtin:SiO2', thickness: 100 }], backLayers: [],
    };
    const ellipsometry = step => computeSpectral(design, {
        side: 'front', lambdaStart: 400, lambdaEnd: 400.001, lambdaStep: step, thetaDeg: 60,
    }).x;
    assert.equal(new Set(ellipsometry(0.0001)).size, 11, 'Ellipsometry: a 0.0001 nm step gives 11 different wavelengths');
    assert.deepEqual(buildGrid(400, 401, 0.3), [400, 400.3, 400.6, 400.9, 401], 'Zemax Coatings: the grid ends on its end');
    const tooFine = 5e-324;
    assert.throws(() => ellipsometry(tooFine), RangeError, 'Ellipsometry: a step too fine to hold is refused');
    assert.throws(() => buildGrid(400, 800, tooFine), RangeError, 'Zemax Coatings: so is its grid');
    const report = { lambdaStart: 400, lambdaEnd: 800, lambdaStep: tooFine };
    assert.throws(() => computeGdGdd(design, report), RangeError, 'report dispersion block: and its grid');
    assert.throws(() => computeEllipsometrySpectrum(design, report), RangeError, 'report ellipsometry block: and its grid');
}

console.log('wavelength_fields_unbounded: passed');
