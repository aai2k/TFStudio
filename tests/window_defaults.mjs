/**
 * Saved window defaults (src/utils/windowDefaults.js).
 *
 * The first block is the one that catches real mistakes: a `savable` list is
 * written by hand next to a store's defaults, so a typo, a key that no longer
 * exists, or a result accidentally declared savable all pass silently at
 * runtime and only show up as a setting that will not stick.
 *
 * The rest cover the rule that keeps Settings → Analysis and a window from
 * showing two different values for one setting.
 *
 * Run: node tests/window_defaults.mjs
 */

import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

const { ANALYSIS_DEFAULTS } = await import('../src/constants/analysisDefaults.js');
const { windowSessionStores } = await import('../src/components/windows/windowSession.js');
const {
    canSaveWindowDefaults, clearSavedWindowDefaults, currentWindowValues,
    hasSavedWindowDefaults, initSavedWindowDefaults, savableKeysFor,
    savedDefaultsFor, saveWindowDefaults, splitWindowValues,
} = await import('../src/utils/windowDefaults.js');

// Importing a window's session module is what registers its store.
await Promise.all([
    'opticalEvaluation', 'gdGddEvaluation', 'materialDispersion', 'eFieldEvaluation',
    'refractiveIndexProfiler', 'ellipsometryEvaluation', 'admittanceDiagram',
    'layerSensitivity', 'roughnessScattering', 'inhomogeneities',
    'systematicDeviations', 'integralValues', 'colorEvaluation', 'errorAnalysis',
].map(id => import(`../src/components/windows/analysis/${id}/sessionState.js`)));

// Every window with a settings panel, in the order the ribbon lists them.
const WINDOWS = [
    'opticalEvaluation', 'gdGddEvaluation', 'materialDispersion', 'eFieldEvaluation',
    'refractiveIndexProfiler', 'ellipsometryEvaluation', 'admittanceDiagram',
    'layerSensitivity', 'roughnessScattering', 'inhomogeneities',
    'systematicDeviations', 'integralValues', 'colorEvaluation', 'errorAnalysis',
];

// Keys that must never be saved: a computed result, a per-design payload, or a
// half-filled form. Saving one would carry another design's work into a window.
const NEVER_SAVABLE = [
    'result', 'sweepResult', 'surfaceResult', 'surfaceSpec', 'curves',
    'rough', 'inh', 'dev', 'builder', 'defaultsApplied',
];

// Reseeded from the selected design, so a saved value would be overwritten the
// moment a design is chosen and the setting would look broken.
const DESIGN_DERIVED = ['refLam', 'lambda', 'lambdaNm'];

const design = { id: 'test-design', referenceWavelength: 550, frontLayers: [], backLayers: [] };

// ── Every declared savable key is a real key of its store ────────────────────
for (const windowId of WINDOWS) {
    const stores = windowSessionStores(windowId);
    assert.ok(stores.length > 0, `${windowId} registers at least one session store`);

    for (const store of stores) {
        const defaults = store.read(design);
        for (const key of store.savableKeys) {
            assert.ok(key in defaults,
                `${windowId}: "${key}" is declared savable but is not a key of the store`);
            assert.ok(!NEVER_SAVABLE.includes(key),
                `${windowId}: "${key}" is a result or a per-design payload and must not be savable`);
            assert.ok(!DESIGN_DERIVED.includes(key),
                `${windowId}: "${key}" is reseeded from the design, so saving it would do nothing`);
        }
    }
    assert.ok(canSaveWindowDefaults(windowId), `${windowId} has something to save`);
}

// ── Every saved setting has a label in both languages ────────────────────────
{
    const { getLocale } = await import('../src/constants/locales.js');
    const en = getLocale('en');
    const ru = getLocale('ru');

    for (const windowId of WINDOWS) {
        for (const key of savableKeysFor(windowId)) {
            for (const [name, locale] of [['en', en], ['ru', ru]]) {
                const analysis = locale.settings.analysis;
                assert.ok(analysis.savedFields[key] || analysis.fields[key],
                    `${name}: "${key}" (${windowId}) has no label, so Settings would show the raw key`);
            }
        }
    }

    assert.deepEqual(Object.keys(en.settings.analysis.savedFields),
        Object.keys(ru.settings.analysis.savedFields), 'the two label tables declare the same keys');
    assert.deepEqual(Object.keys(en.analysisChrome), Object.keys(ru.analysisChrome));
    assert.notEqual(en.analysisChrome.saveDefaults, ru.analysisChrome.saveDefaults,
        'the Russian buttons are translated rather than copied');
    assert.ok(en.settings.folders.preferences && ru.settings.folders.preferences,
        'the Preferences folder is named in both languages');
}

// ── Two views of one setting cannot disagree ─────────────────────────────────
{
    // The Y axis is declared in the analysis registry, so saving it from the
    // window has to land in the block Settings → Analysis reads.
    const split = splitWindowValues('opticalEvaluation', {
        yMin: 20, yMax: 90, yAuto: false, showTable: true,
    });
    assert.deepEqual(split.fields.sort(), [
        ['booleans', 'yAuto', false],
        ['numbers', 'yMax', 90],
        ['numbers', 'yMin', 20],
    ].sort());
    assert.deepEqual(split.session, { showTable: true },
        'only the keys the registry does not declare go to the window block');

    // No other window declares a savable key twice, which is what makes the
    // rest of the split trivially correct.
    for (const windowId of WINDOWS) {
        if (windowId === 'opticalEvaluation') continue;
        const registry = ANALYSIS_DEFAULTS[windowId] || {};
        const declared = ['numbers', 'enums', 'booleans']
            .flatMap(section => Object.keys(registry[section] || {}));
        const clash = savableKeysFor(windowId).filter(key => declared.includes(key));
        assert.deepEqual(clash, [], `${windowId} has no key in both stores`);
    }
}

// ── Saving writes the settings and nothing else ──────────────────────────────
{
    const written = [];
    global.window.electronAPI = {
        saveWindowDefaults: async block => { written.push(block); return { success: true }; },
    };
    const analysisSettings = { stored: {}, setField: () => {} };

    initSavedWindowDefaults({});
    const [store] = windowSessionStores('layerSensitivity');
    store.write(design, { mode: 'absolute', absDeltaNm: 2.5 });

    const error = await saveWindowDefaults('layerSensitivity', design, analysisSettings);
    assert.equal(error, null, 'a successful write reports no error');
    assert.deepEqual(written.at(-1).layerSensitivity, {
        mode: 'absolute', relPct: 1, absDeltaNm: 2.5,
        includeLocked: false, scale: 'normalized', showTable: false,
    });
    assert.deepEqual(savedDefaultsFor('layerSensitivity'), written.at(-1).layerSensitivity);
    assert.equal(hasSavedWindowDefaults('layerSensitivity', analysisSettings), true);

    // A new slot now starts from the saved values.
    store.reset();
    assert.equal(store.read(design).absDeltaNm, 2.5,
        'the next session opens the window on what was saved');

    await clearSavedWindowDefaults('layerSensitivity');
    assert.deepEqual(written.at(-1), {}, 'clearing removes the window from the file');
    assert.equal(store.read(design).absDeltaNm, 1.0, 'and the window goes back to shipped');
    assert.equal(hasSavedWindowDefaults('layerSensitivity', analysisSettings), false);
}

// ── A failed write is reported rather than swallowed ─────────────────────────
{
    global.window.electronAPI = {
        saveWindowDefaults: async () => ({ success: false, error: 'disk full' }),
    };
    const error = await saveWindowDefaults('colorEvaluation', design, { stored: {}, setField: () => {} });
    assert.equal(error, 'disk full',
        'a change the user can see on screen that never reached disk is the worst outcome');

    delete global.window.electronAPI;
    assert.equal(await saveWindowDefaults('colorEvaluation', design, null), 'unavailable',
        'a missing channel is reported too');
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

// ── Each window's settings panel actually carries the buttons ────────────────
//
// The footer is rendered by SettingsMenu only when it is given a windowId, and
// the panel lives inside a popover that a server render never opens, so this is
// asserted against the source: a window that lost the prop would otherwise keep
// its store, keep its saved values, and quietly stop offering to save them.
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

    const menu = await readFile(
        new URL('../src/components/windows/analysis/chrome/popover.js', import.meta.url), 'utf8');
    assert.match(menu, /canSaveWindowDefaults\(windowId\)/,
        'a window with nothing to save gets no footer rather than two dead buttons');
}

console.log('window_defaults: passed');
