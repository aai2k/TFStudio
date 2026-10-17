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

console.log('comma_decimal_design_and_wizards: passed');
