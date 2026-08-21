/**
 * The values an analysis window opens with (src/utils/windowDefaults.js).
 *
 * The rule these all serve: a setting a window's panel can change is a setting
 * the main Settings menu can change, because there is one declaration and one
 * stored block behind both. A window that kept a value to itself would be a
 * value Settings could not reach, and the two would disagree as soon as either
 * one was used.
 *
 * Run: node tests/window_defaults.mjs
 */

import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { ANALYSIS_DEFAULTS, registryKeys, sessionDefaults } =
    await import('../src/constants/analysisDefaults.js');
const { resolveAnalysisSettings, resolvedWindowValues } =
    await import('../src/utils/analysisSettings.js');
const resolvedSections = windowId => resolveAnalysisSettings(windowId, {});
const { windowSessionStores } = await import('../src/components/windows/windowSession.js');
const {
    applyAnalysisDefaults, canSaveWindowDefaults, currentWindowValues,
    hasSavedWindowDefaults, restoreWindowDefaults, saveWindowDefaults,
} = await import('../src/utils/windowDefaults.js');

// Every window with a settings panel, in the order the ribbon lists them.
const WINDOWS = [
    'opticalEvaluation', 'gdGddEvaluation', 'materialDispersion', 'eFieldEvaluation',
    'refractiveIndexProfiler', 'ellipsometryEvaluation', 'admittanceDiagram',
    'layerSensitivity', 'roughnessScattering', 'inhomogeneities',
    'systematicDeviations', 'integralValues', 'colorEvaluation', 'errorAnalysis',
];

// Importing a session module is what registers its store. Optical Evaluation
// has a second one at App level for its evaluation grid, which the Spectrum
// Exchange window seeds from.
await Promise.all(WINDOWS.map(
    id => import(`../src/components/windows/analysis/${id}/sessionState.js`)));
const { evalParamsSession } = await import('../src/state/evalParamsSession.js');

// Never a setting, whichever window holds it: a computed result, a per-design
// payload, or a half-filled form.
const NEVER_SETTINGS = [
    'result', 'sweepResult', 'surfaceResult', 'surfaceSpec', 'curves',
    'rough', 'inh', 'dev', 'builder',
];

// Keys a store may hold without the registry declaring them, each for a stated
// reason: what you are currently looking at, a value reseeded from the design,
// or a bound the window itself clears.
const ALLOWED_UNDECLARED = [
    ...NEVER_SETTINGS,
    'showCurves',            // which curves are drawn
    'selKey',                // which integral is highlighted
    'sweep',                 // which parameter is being swept, chosen per design
    'materialId',            // which material is on screen
    'lambda', 'lambdaNm', 'refLam',   // reseeded from the design
    'side',                  // reseeded from whichever side carries the coating
    'yMin', 'yMax',          // GD/GDD clears these whenever the quantity changes
];

const design = { id: 'test-design', referenceWavelength: 550, frontLayers: [], backLayers: [] };

// ── Every declared setting is a real key of its store, and vice versa ────────
for (const windowId of WINDOWS) {
    const stores = windowSessionStores(windowId);
    assert.ok(stores.length > 0, `${windowId} registers at least one session store`);
    assert.ok(canSaveWindowDefaults(windowId), `${windowId} has settings it can save`);

    const declared = registryKeys(windowId);
    // A window may split its settings across more than one store; between them
    // they cover exactly what the registry declares.
    const savable = stores.flatMap(store => store.savableKeys);
    assert.deepEqual([...savable].sort(), [...declared].sort(),
        `${windowId} saves exactly what the registry declares`);

    const state = stores.reduce((all, store) => ({ ...all, ...store.read(design) }), {});
    for (const key of declared) {
        assert.ok(key in state,
            `${windowId}: "${key}" is declared but is not a key of the store`);
        assert.ok(!NEVER_SETTINGS.includes(key),
            `${windowId}: "${key}" is not a setting and must not be configurable`);
    }

    // Anything the stores hold beyond the declared settings must be on the list
    // above with a reason, or it is a window setting the Settings menu cannot
    // reach — which is the thing this whole arrangement exists to prevent.
    for (const key of Object.keys(state)) {
        assert.ok(declared.includes(key) || ALLOWED_UNDECLARED.includes(key),
            `${windowId}: "${key}" is neither declared in the registry nor listed as non-setting`);
    }
}

// ── A store starts from the registry ─────────────────────────────────────────
{
    const [store] = windowSessionStores('colorEvaluation');
    assert.deepEqual(store.read(design), sessionDefaults('colorEvaluation'),
        'a fresh window is exactly what the registry ships');
}

// ── A launch opens every window on what Settings holds ───────────────────────
//
// This is the sequence at startup, in order: the layout mounts its windows on
// the shipped values, and the preferences file lands a moment later. It has to
// run before anything below writes to a store, because a store the user has
// already changed is deliberately left alone until the next launch.
{
    const [colors] = windowSessionStores('colorEvaluation');

    // Windows mount and read before the file arrives.
    assert.equal(colors.read(design).illuminant, 'D65');
    assert.equal(evalParamsSession.read(null).lambdaStart, 400);

    applyAnalysisDefaults({
        opticalEvaluation: {
            numbers: { lambdaStart: 8000, lambdaEnd: 12000 },
            enums: { spectralUnit: 'um' },
        },
        colorEvaluation: { enums: { illuminant: 'D50' } },
    });

    assert.equal(evalParamsSession.read(null).lambdaStart, 8000,
        'the configured range is what Optical Evaluation opens on');
    assert.equal(evalParamsSession.read(null).lambdaEnd, 12000);
    assert.equal(evalParamsSession.read(null).spectralUnit, 'um',
        'including the unit it is entered in');
    assert.equal(colors.read(design).illuminant, 'D50');

    applyAnalysisDefaults({});
    assert.equal(evalParamsSession.read(null).lambdaStart, 400,
        'and an empty file is the shipped values, not the last ones seen');
    colors.reset();
    evalParamsSession.reset();
}

// ── A window in use is not rearranged under the user ─────────────────────────
//
// The other half of the same rule: a value configured in Settings is what the
// window opens with, so a window someone is working in keeps what they set
// there until the next launch. "Restore defaults" in the window's own panel is
// the way to put it back now.
{
    const [colors] = windowSessionStores('colorEvaluation');
    colors.write(design, { illuminant: 'A' });

    applyAnalysisDefaults({ colorEvaluation: { enums: { illuminant: 'D50' } } });
    assert.equal(colors.read(design).illuminant, 'A',
        'what the user set in the window survives a change made in Settings');

    restoreWindowDefaults('colorEvaluation', { stored: {}, setField: () => {} });
    assert.equal(colors.read(design).illuminant, 'D65',
        'and Restore in the window is visible in it straight away');

    applyAnalysisDefaults({});
    colors.reset();
}

// ── Every setting has a label in both languages ──────────────────────────────
{
    const { getLocale } = await import('../src/constants/locales.js');
    for (const [name, locale] of [['en', getLocale('en')], ['ru', getLocale('ru')]]) {
        for (const windowId of WINDOWS) {
            for (const key of registryKeys(windowId)) {
                const analysis = locale.settings.analysis;
                assert.ok(analysis.savedFields[key] || analysis.fields[key],
                    `${name}: "${key}" (${windowId}) has no label, so Settings would show the raw key`);
            }
        }
    }
    const en = getLocale('en');
    const ru = getLocale('ru');
    assert.deepEqual(Object.keys(en.settings.analysis.savedFields),
        Object.keys(ru.settings.analysis.savedFields), 'the two label tables declare the same keys');
    assert.deepEqual(Object.keys(en.analysisChrome), Object.keys(ru.analysisChrome));
    assert.ok(en.settings.analysis.windowControls && ru.settings.analysis.windowControls,
        'the Settings group heading is translated');
}

// ── Settings reaches an untouched window ─────────────────────────────────────
{
    const [store] = windowSessionStores('layerSensitivity');
    store.reset();
    applyAnalysisDefaults({ layerSensitivity: { numbers: { relPct: 3.5 } } });
    assert.equal(store.read(design).relPct, 3.5,
        'a value set in Settings is what the window opens with');
    assert.equal(store.read(design).absDeltaNm, 1.0, 'its siblings keep the shipped value');

    applyAnalysisDefaults({});
    assert.equal(store.read(design).relPct, 1.0, 'clearing it puts the shipped value back');
    store.reset();
}

// ── Saving from a window writes the same block Settings edits ────────────────
{
    const fields = [];
    const analysisSettings = {
        stored: {},
        setField: (id, section, key, value) => fields.push([id, section, key, value]),
    };

    const [store] = windowSessionStores('layerSensitivity');
    store.reset();
    store.write(design, { mode: 'absolute', absDeltaNm: 2.5 });
    saveWindowDefaults('layerSensitivity', design, analysisSettings);

    assert.deepEqual(fields.filter(([, , key]) => key === 'absDeltaNm'),
        [['layerSensitivity', 'numbers', 'absDeltaNm', 2.5]]);
    assert.deepEqual(fields.filter(([, , key]) => key === 'mode'),
        [['layerSensitivity', 'enums', 'mode', 'absolute']]);
    assert.ok(fields.every(([id]) => id === 'layerSensitivity'),
        'a window saves under its own id and nothing else');
    store.reset();
}

// ── Optical Evaluation's range is its own, and saves under its own id ────────
{
    const fields = [];
    const analysisSettings = {
        stored: {},
        setField: (id, section, key, value) => fields.push([id, section, key, value]),
    };

    evalParamsSession.reset();
    evalParamsSession.write(null, {
        lambdaStart: 8000, lambdaEnd: 12000, spectralUnit: 'um', thetas: [0, 30],
    });
    saveWindowDefaults('opticalEvaluation', design, analysisSettings);

    assert.ok(fields.every(([id]) => id === 'opticalEvaluation'),
        'the range is this window\'s setting, not a separate entry of its own');
    assert.deepEqual(fields.filter(([, , key]) => key === 'lambdaStart'),
        [['opticalEvaluation', 'numbers', 'lambdaStart', 8000]]);
    assert.deepEqual(fields.filter(([, , key]) => key === 'spectralUnit'),
        [['opticalEvaluation', 'enums', 'spectralUnit', 'um']]);
    assert.deepEqual(fields.filter(([, , key]) => key === 'thetas'),
        [['opticalEvaluation', 'lists', 'thetas', [0, 30]]],
        'the angle list is a list field rather than an opaque blob');
    assert.ok(fields.some(([, , key]) => key === 'yAuto'),
        'and the two stores are saved together');

    evalParamsSession.reset();
}

// ── Every window keeps its own range ─────────────────────────────────────────
//
// A scattering plot and a colour calculation are not looking at the same thing,
// so one window's band must not follow another's.
{
    const withRange = WINDOWS.filter(id => registryKeys(id).includes('lambdaStart'));
    assert.deepEqual(withRange, [
        'opticalEvaluation', 'ellipsometryEvaluation', 'roughnessScattering',
        'inhomogeneities', 'systematicDeviations', 'integralValues', 'errorAnalysis',
    ], 'each of these declares a range under its own id');

    const starts = withRange.map(id => sessionDefaults(id).lambdaStart);
    assert.equal(new Set(starts).size > 1, true,
        'and they do not all ship the same one: Integral Values runs 300-2500 nm for the solar band');
}

// ── Restore puts every one of the window's settings back ─────────────────────
{
    const fields = [];
    const analysisSettings = { stored: {}, setField: (id, s, key, value) => fields.push([id, key, value]) };
    restoreWindowDefaults('colorEvaluation', analysisSettings);

    const factory = sessionDefaults('colorEvaluation');
    for (const [key, value] of Object.entries(factory)) {
        assert.deepEqual(fields.find(([, name]) => name === key), ['colorEvaluation', key, value],
            `Restore puts ${key} back to the shipped value`);
    }
}

// ── The Restore button knows whether there is anything to restore ────────────
{
    assert.equal(hasSavedWindowDefaults('colorEvaluation', { stored: {} }), false);
    assert.equal(
        hasSavedWindowDefaults('colorEvaluation', { stored: { colorEvaluation: { numbers: { step: 2 } } } }),
        true);
    assert.equal(
        hasSavedWindowDefaults('colorEvaluation', { stored: { colorEvaluation: { colors: { coating: '#000000' } } } }),
        false, 'a curve colour is not one of the window controls Restore covers');
    assert.equal(
        hasSavedWindowDefaults('opticalEvaluation', { stored: { opticalEvaluation: { numbers: { lambdaStart: 8000 } } } }),
        true, 'a saved range counts as something to restore');
}

// ── currentWindowValues reads the design on screen ───────────────────────────
{
    const other = { ...design, id: 'other-design' };
    const [store] = windowSessionStores('errorAnalysis');   // one slot per design
    store.reset();
    store.write(design, { nTrials: 500 });
    store.write(other, { nTrials: 50 });

    assert.equal(currentWindowValues('errorAnalysis', design).nTrials, 500);
    assert.equal(currentWindowValues('errorAnalysis', other).nTrials, 50,
        'Save writes what the window is showing, not another design run');
    assert.equal('result' in currentWindowValues('errorAnalysis', design), false,
        'and never the Monte-Carlo result itself');
    store.reset();
}

// ── resolvedWindowValues is what the pane and the store both read ────────────
{
    const stored = { errorAnalysis: { numbers: { nTrials: 1000 }, enums: { distribution: 'uniform' } } };
    const values = resolvedWindowValues('errorAnalysis', stored);
    assert.equal(values.nTrials, 1000);
    assert.equal(values.distribution, 'uniform');
    assert.equal(values.rmsRelPct, ANALYSIS_DEFAULTS.errorAnalysis.numbers.rmsRelPct.def);
    assert.equal(values.showEditor, true, 'sections are flattened into one set of values');
}

// ── Settings renders a real editor for every declared setting ────────────────
//
// This is the whole point of the arrangement: a setting a window's own panel
// can change is a setting the main Settings menu can change. Rendering each
// window's field list is also what catches a row that throws — the pane is
// otherwise only ever seen by hand.
{
    const { WindowFields } = await import(
        '../src/components/dialogs/settings/analysis/WindowFields.js');
    const { AnalysisPane } = await import(
        '../src/components/dialogs/settings/analysis/AnalysisPane.js');
    const { ANALYSIS_WINDOW_IDS } = await import('../src/constants/analysisDefaults.js');

    const c = makeTheme();
    const t = makeLocale();

    // A window that lets its range be entered in another unit gets unit-aware
    // rows for the range instead of plain numbers, so those carry the unit in
    // their label rather than the key's own name.
    const UNIT_AWARE_ROWS = ['lambdaStart', 'lambdaEnd', 'lambdaStep', 'spectralUnit'];

    for (const windowId of ANALYSIS_WINDOW_IDS) {
        const resolved = resolvedSections(windowId);
        const unitAware = !!resolved.enums.spectralUnit;
        const html = renderToStaticMarkup(React.createElement(WindowFields, {
            windowId, resolved, onChange: () => {}, c, t,
        }));
        for (const key of registryKeys(windowId)) {
            if (unitAware && UNIT_AWARE_ROWS.includes(key)) continue;
            const label = t.settings.analysis.savedFields[key] || t.settings.analysis.fields[key];
            assert.ok(html.includes(label),
                `Settings → ${windowId} has no field for "${key}" (expected the label "${label}")`);
        }
        if (unitAware) {
            assert.ok(html.includes(t.settings.analysis.rangeFrom('nm'))
                && html.includes(t.settings.analysis.rangeTo('nm'))
                && html.includes(t.settings.analysis.fields.spectralUnit),
            `Settings → ${windowId} renders its range in the selected unit`);
        }
    }

    assert.match(renderToStaticMarkup(React.createElement(AnalysisPane, { c, t })),
        /Optical Evaluation/, 'the pane itself renders outside the provider');

    // A controlled field that writes on every keystroke rewrites itself while it
    // is being typed into, so it cannot be cleared and retyped and a value on its
    // way to 900 is read as 9 and clamped. The handlers are not in a static
    // render, so this is asserted against the source.
    const { readFile } = await import('node:fs/promises');
    const dir = new URL('../src/components/dialogs/settings/analysis/', import.meta.url);
    for (const file of ['FieldRows.js', 'SpectralRangeRows.js']) {
        const source = await readFile(new URL(file, dir), 'utf8');
        assert.match(source, /onBlur: commit/,
            `${file}: number fields commit on blur, not on the keystroke`);
        assert.match(source, /className: 'tfs-number'/,
            `${file}: number fields hide the native spinner, as they do in the windows`);
    }
}

// ── Each window's settings panel carries the buttons ─────────────────────────
//
// The footer is rendered by SettingsMenu only when it is given a windowId, and
// the panel lives inside a popover that a server render never opens, so this is
// asserted against the source.
{
    const { readFile } = await import('node:fs/promises');
    const PANELS = {
        opticalEvaluation: 'opticalEvaluation/SetupPanel.js',
        gdGddEvaluation: 'gdGddEvaluation/GDControls.js',
        materialDispersion: 'materialDispersion/MaterialDispersionEvaluation.js',
        eFieldEvaluation: 'eFieldEvaluation/EFieldControls.js',
        refractiveIndexProfiler: 'refractiveIndexProfiler/ProfilerControls.js',
        ellipsometryEvaluation: 'ellipsometryEvaluation/EllipsometryControls.js',
        admittanceDiagram: 'admittanceDiagram/AdmittanceControls.js',
        layerSensitivity: 'layerSensitivity/SensitivityControls.js',
        roughnessScattering: 'roughnessScattering/RoughnessControls.js',
        inhomogeneities: 'inhomogeneities/InhomogeneityControls.js',
        systematicDeviations: 'systematicDeviations/SystematicControls.js',
        integralValues: 'integralValues/Controls.js',
        colorEvaluation: 'colorEvaluation/ColorControls.js',
        errorAnalysis: 'errorAnalysis/ErrorControls.js',
    };
    assert.deepEqual(Object.keys(PANELS).sort(), [...WINDOWS].sort(),
        'every window with a store has a panel listed here');

    for (const [windowId, file] of Object.entries(PANELS)) {
        const source = await readFile(
            new URL(`../src/components/windows/analysis/${file}`, import.meta.url), 'utf8');
        assert.match(source, new RegExp(`windowId: '${windowId}'`),
            `${file} passes its window id to SettingsMenu`);
    }
}

console.log('window_defaults: passed');
