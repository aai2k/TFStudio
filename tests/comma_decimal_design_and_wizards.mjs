/**
 * The design windows and the wizards take a comma decimal, on any Windows locale.
 *
 * A native `type="number"` box on an English Windows drops the comma keystroke
 * before the code sees it, so 94,2 typed into one arrives as 942. Each section
 * types 94,2 into a window's decimal boxes, leaves them, and checks that 94.2
 * reaches the window's handler or state; a count box is checked to be a text
 * field that still takes a typed count.
 *
 *   1. Monitoring wizards (BBM and Mono): the field, the row field and the
 *      table cell, and a cell on the Parameters Deviation page.
 *   2. Filter Design wizard: the field and the count, and every box on step 2.
 *   3. Settings, Analysis page: a number row, and the spectral range in nm
 *      and in µm.
 *   4. Stack Formula: the reference wavelength, which still refuses zero.
 *   5. Design Editor: the round and perturb dialogs, through their Apply button.
 *   6. Material Editor: the stated range and the fit range, through the draft.
 *
 * Run: node tests/comma_decimal_design_and_wizards.mjs
 */
import assert from 'node:assert/strict';
import { mount } from './_typeIntoField.mjs';

const c = { field: '#111', text: '#eee', textDim: '#999', border: '#333', bg: '#000', panel: '#111', accent: '#39f' };

// The values a field hands on after `text` is typed into it and it is left.
function typed(Component, props, text = '94,2', pick) {
    const values = [];
    mount(Component, { ...props, onChange: value => values.push(value) }, pick).type(text).leave();
    return values;
}

const isText = (Component, props) => mount(Component, { ...props, onChange() {} }).input().props.type === 'text';

// Every button in a rendered tree, in the order they are drawn.
function buttonsOf(node, found = []) {
    if (!node || typeof node !== 'object') return found;
    if (node.type === 'button') found.push(node);
    [node.props?.children].flat(Infinity).forEach(child => buttonsOf(child, found));
    return found;
}

// ── 1. Monitoring wizards ────────────────────────────────────────────────────
{
    const wizard = await import('../src/components/windows/simulation/wizardShared.js');
    for (const [name, field] of [['field', wizard.NumField], ['row field', wizard.RowField], ['table cell', wizard.cellNum]]) {
        for (const positive of [false, true]) {
            const props = { value: 5, step: 0.1, positive, c, label: 'x' };
            const what = `monitoring wizard ${name}${positive ? ', positive' : ''}`;
            assert.deepEqual(typed(field, props), [94.2], `${what}: 94,2 is 94.2`);
            assert.ok(isText(field, props), `${what}: is a text field`);
        }
    }
    // A count, such as a monitoring order, from 1 to 12.
    const order = { value: 1, step: 1, min: 1, max: 12, c };
    assert.deepEqual(typed(wizard.cellNum, order, '3'), [3], 'monitoring wizard count: 3 arrives as 3');
    assert.ok(isText(wizard.cellNum, order), 'monitoring wizard count: is a text field');

    const { PageDeviations } = await import('../src/components/windows/simulation/wizardKit/PageDeviations.js');
    const stored = [];
    const page = mount(PageDeviations, {
        p: { matDev: {}, layers: [{}], shutterMean: 0, shutterRms: 0 },
        set: (key, value) => stored.push([key, value]),
        materialIds: ['SiO2'], layers: [{ material: 'SiO2', thickness: 100 }],
        resolveMat: () => null, c, B: {},
    // Three material cells, then the layer's checkbox and its thickness error.
    }, inputs => inputs.filter(input => input.props.type !== 'checkbox')[3]);
    page.type('94,2').leave();
    assert.deepEqual(stored, [['layers', [{ relThkErr: 94.2 }]]],
        'Parameters Deviation: a relative thickness error of 94,2 % is stored as 94.2');
}

// ── 2. Filter Design wizard ──────────────────────────────────────────────────
{
    const ui = await import('../src/components/windows/optimization/filterDesignWizard/ui.js');
    for (const positive of [false, true]) {
        const props = { value: 5, step: 0.1, positive, c, label: 'x' };
        const what = `Filter Design field${positive ? ', positive' : ''}`;
        assert.deepEqual(typed(ui.NumField, props), [94.2], `${what}: 94,2 is 94.2`);
        assert.ok(isText(ui.NumField, props), `${what}: is a text field`);
    }
    const count = { value: 2, min: 1, max: 10, c, label: 'N' };
    assert.deepEqual(typed(ui.IntField, count, '3'), [3], 'Filter Design count: 3 arrives as 3');
    assert.ok(isText(ui.IntField, count), 'Filter Design count: is a text field');

    const { DEFAULTS } = await import('../src/components/windows/optimization/filterDesignWizard/model.js');
    const { StepParams } = await import('../src/components/windows/optimization/filterDesignWizard/StepParams.js');
    const { getLocale } = await import('../src/constants/locales/index.js');
    // Step 2 draws λ0, the two half-widths, the shape factor and the two levels.
    const step2 = (index, text) => {
        const stored = [];
        mount(StepParams, { p: DEFAULTS, set: (key, value) => stored.push([key, value]), c, t: getLocale('en') },
            inputs => inputs[index]).type(text).leave();
        return stored;
    };
    assert.deepEqual(step2(0, '94,2'), [['lambda0_nm', 94.2]], 'Filter Design step 2: λ0 of 94,2 nm is 94.2');
    assert.deepEqual(step2(1, '94,2'), [['passHalf_nm', 94.2]], 'Filter Design step 2: the pass half-width');
    assert.deepEqual(step2(2, '94,2'), [['stopHalf_nm', 94.2]], 'Filter Design step 2: the stop half-width');
    assert.deepEqual(step2(3, '2,5'), [['stopHalf_nm', DEFAULTS.passHalf_nm * 2.5]],
        'Filter Design step 2: a shape factor of 2,5 sets the stop half-width');
    assert.deepEqual(step2(4, '94,2'), [['passLevel', 94.2]], 'Filter Design step 2: the pass level');
    assert.deepEqual(step2(5, '0,2'), [['stopLevel', 0.2]], 'Filter Design step 2: the stop level');
}

// ── 3. Settings, Analysis page ───────────────────────────────────────────────
{
    const { NumberRow } = await import('../src/components/dialogs/settings/analysis/FieldRows.js');
    const { SpectralRangeRows } = await import('../src/components/dialogs/settings/analysis/SpectralRangeRows.js');
    const { ANALYSIS_DEFAULTS } = await import('../src/constants/analysisDefaults.js');
    const { resolveAnalysisSettings } = await import('../src/utils/analysisSettings.js');
    const { getLocale } = await import('../src/constants/locales/index.js');

    const row = { value: 5, spec: { def: 5, step: 0.1 }, c, label: 'x' };
    assert.deepEqual(typed(NumberRow, row), [94.2], 'Settings row: 94,2 is 94.2');
    assert.ok(isText(NumberRow, row), 'Settings row: is a text field');

    // The range rows in the unit `spectralUnit`, each with the text typed into it.
    const range = (spectralUnit, texts) => texts.map((text, index) => {
        const stored = [];
        const rows = SpectralRangeRows({
            registry: ANALYSIS_DEFAULTS.opticalEvaluation,
            resolved: resolveAnalysisSettings('opticalEvaluation', { opticalEvaluation: { enums: { spectralUnit } } }),
            onChange: (section, key, value) => stored.push([key, value]),
            c, t: getLocale('en'),
        }).props.children.filter(child => child && typeof child.type === 'function' && child.props.onCommit);
        if (text != null) mount(rows[index].type, rows[index].props).type(text).leave();
        return Object.fromEntries(stored);
    });
    assert.deepEqual(range('nm', ['94,2', '940,5', '0,25']), [
        { lambdaStart: 94.2, lambdaEnd: 800 }, { lambdaStart: 400, lambdaEnd: 940.5 }, { lambdaStep: 0.25 },
    ], 'Settings range in nm: from 94,2, to 940,5 and a step of 0,25');
    assert.deepEqual(range('um', [null, '0,9']), [{}, { lambdaStart: 400, lambdaEnd: 900 }],
        'Settings range in µm: an end of 0,9 µm is stored as 900 nm');
}

// ── 4. Stack Formula ─────────────────────────────────────────────────────────
{
    const { FormulaPanel } = await import('../src/components/windows/design/stackFormula/FormulaPanel.js');
    const { getLocale } = await import('../src/constants/locales/index.js');
    const t = getLocale('en');
    // The reference wavelength each text sets, typed into the panel's first box.
    const refLambda = text => {
        const stored = [];
        const state = {
            text: 'HL', parsed: { ok: true }, compiled: { ok: true }, symRows: [],
            refLambda: 550, setRefLambda: value => stored.push(value),
            startFromSubstrate: false, setStartFromSubstrate() {},
            showIncident: false, showExit: false, substrateMat: 'builtin:BK7', setSubstrateMat() {},
        };
        mount(FormulaPanel, { state, c, t, sf: t.stackFormula }).type(text).leave();
        return stored;
    };
    assert.deepEqual(refLambda('94,2'), [94.2], 'Stack Formula: a reference wavelength of 94,2 nm is 94.2');
    assert.deepEqual(['0', '-5'].map(refLambda), [[], []], 'Stack Formula: and zero and below are refused');
}

// ── 5. Design Editor ─────────────────────────────────────────────────────────
//
// The round and perturb dialogs keep what is typed and preview it as it is
// typed, so the check is the design the Apply button hands on.
{
    const { QuantizeDialog, PerturbDialog } = await import('../src/components/windows/design/designEditor/LayerToolDialogs.js');
    const { makePerturbationMap, perturbDesignSide } = await import('../src/components/windows/design/designEditor/layerTools.js');
    const { getLocale } = await import('../src/constants/locales/index.js');
    const t = getLocale('en');
    const design = { referenceWavelength: 550, frontLayers: [{ id: 'a', material: 'builtin:SiO2', thickness: 100.13 }] };
    // What Apply hands on after `text` is typed, or null while Apply is greyed out.
    const applied = (Dialog, text, pick) => {
        const designs = [];
        const dialog = mount(Dialog, { design, side: 'front', c, t, onApply: next => designs.push(next), onClose() {} }, pick);
        dialog.type(text);
        const apply = buttonsOf(dialog.render()).at(-1);
        if (apply.props.disabled) return null;
        apply.props.onClick();
        return designs[0];
    };

    const rounded = applied(QuantizeDialog, '94,2');
    assert.equal(rounded?.frontLayers[0].thickness, 94.2, 'Round: a controller step of 94,2 nm rounds 100.13 nm to 94.2');
    assert.ok(isText(QuantizeDialog, { design, side: 'front', c, t }), 'Round: the step is a text field');

    const random = Math.random;
    Math.random = () => 0.9;
    try {
        const kicked = applied(PerturbDialog, '94,2');
        assert.deepEqual(kicked, perturbDesignSide(design, 'front', 94.2, makePerturbationMap(design.frontLayers)),
            'Perturb: a kick of 94,2 % is a kick of 94.2 %');
    } finally {
        Math.random = random;
    }
    assert.ok(isText(PerturbDialog, { design, side: 'front', c, t }), 'Perturb: the kick is a text field');
}

// ── 6. Material Editor ───────────────────────────────────────────────────────
//
// The form keeps what is typed in its draft and reads the range from there, so
// the check is the range the draft gives after the text is typed.
{
    const { UserMaterialForm } = await import('../src/components/windows/design/materialEditor/userMaterialForm.js');
    const { emptyDraft, draftRangeNm, fitRangeNm } =
        await import('../src/components/windows/design/materialEditor/materialDraft.js');
    const { getLocale } = await import('../src/constants/locales/index.js');
    const t = getLocale('en');
    const rows = [50, 100, 200, 400, 800].map((lam, index) => ({ _key: index, lam: String(lam), n: String(1.6 - lam / 4000), k: '0' }));
    const draft = { ...emptyDraft('user_lab'), name: 'X', lambdaMinNm: '50', rows };
    // The draft the form hands on after `text` is typed into the box `pick` finds.
    const edited = (pick, text) => {
        const drafts = [];
        const form = mount(UserMaterialForm, {
            draft, onChange: next => drafts.push(next), c, t, catalogs: [], workingNm: null,
            detailTab: 'nk', setDetailTab() {}, tableHeight: 200, setTableHeight() {},
        }, pick);
        assert.equal(form.input().props.type, 'text', 'Material Editor: the box is a text field');
        form.type(text);
        return drafts.at(-1);
    };
    // The name comes first, then the stated range; the fit range boxes show the
    // band they stand for as a placeholder.
    const [lambdaMin, lambdaMax] = [inputs => inputs[1], inputs => inputs[2]];
    const fitFrom = inputs => inputs.find(input => input.props.placeholder === '50');
    const fitTo = inputs => inputs.find(input => input.props.placeholder === '800');
    assert.deepEqual(draftRangeNm(edited(lambdaMin, '94,2')), [94.2, 2500], 'Material Editor: a stated start of 94,2 nm is 94.2');
    assert.deepEqual(draftRangeNm(edited(lambdaMax, '94,2')), [50, 94.2], 'Material Editor: and a stated end');
    assert.deepEqual(fitRangeNm(edited(fitFrom, '94,2'), null), [94.2, 800], 'Material Editor: a fit from 94,2 nm');
    assert.deepEqual(fitRangeNm(edited(fitTo, '94,2'), null), [50, 94.2], 'Material Editor: and a fit to 94,2 nm');
}

console.log('comma_decimal_design_and_wizards: passed');
