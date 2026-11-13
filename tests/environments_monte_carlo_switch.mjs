/**
 * The Environment droplist of the Monte Carlo window after a run
 * (errorAnalysis/useErrorAnalysis.js), its run on the analysis worker, and the
 * Specification window's saved specs on a design with environments.
 *
 *   1. A run computes every environment that is on and the one shown.
 *      Switching the droplist between them shows each one's spread from that
 *      run, and starts no run.
 *   2. Choosing an environment the run did not compute, one that is off, runs
 *      again with the seed of the run before: the same trials, so the spreads
 *      of the environments both runs computed are the same, and the new one is
 *      there. Going back starts no run.
 *   3. A spec saved from the Specification window holds no env, and a spec
 *      loaded into it holds none: a saved spec belongs to no design.
 *
 * Run: node tests/environments_monte_carlo_switch.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime } from './_hookHarness.mjs';
import { NodeModuleWorker } from './_moduleWorker.mjs';

shimBrowserGlobals();
const rt = makeHookRuntime();
Object.assign(rt.React, {
    createElement: (type, props, ...children) => ({ type, props, children }),
    createContext: value => ({ value, Provider: 'Provider' }),
    useContext: context => context?.value ?? null,
});
globalThis.React = rt.React;

let made = 0;
globalThis.Worker = class extends NodeModuleWorker {
    constructor(...args) { super(...args); made++; }
};

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { getLocale } = await import('../src/constants/locales/index.js');
const { oneEnvironmentDesign } = await import('./_environmentDesign.mjs');
const { makeQualifier } = await import('../src/utils/synthesis/qualifiers.js');
const { environmentChoiceSession } = await import('../src/components/windows/analysis/chrome/environmentChoice.js');
const { useErrorAnalysis } = await import('../src/components/windows/analysis/errorAnalysis/useErrorAnalysis.js');
const { useDiskPresets } = await import('../src/components/windows/design/specification/useDiskPresets.js');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// One component: render it, then run the effects that render scheduled.
function mount(hook) {
    rt.reset();
    let out;
    const render = () => {
        out = rt.render(hook);
        for (const effect of rt.pendingEffects()) effect();
        return out;
    };
    render();
    return { render, get out() { return out; } };
}

// Render until `ready` holds, or give up after `limitMs`.
async function until(component, ready, limitMs = 30000) {
    for (let waited = 0; waited < limitMs; waited += 10) {
        if (ready(component.render())) return true;
        await wait(10);
    }
    return false;
}

const SPREAD = ['lambda', 'theory', 'mean', 'stdev', 'lower', 'upper', 'envLower', 'envUpper'];
const spreadOf = entry => Object.fromEntries(SPREAD.map(key => [key, entry[key]]));
const ids = result => result.environments.map(({ id }) => id);

const checks = [
    { ...makeQualifier({ kind: 'R_AVG', lambdaStart: 420, lambdaEnd: 680, cmp: 'le', target: 0.11, label: 'band' }), id: 'q-band' },
    { ...makeQualifier({ kind: 'R_AT', lambda: 550, aoi: 30, cmp: 'le', target: 0.2, env: 'env2', label: 'sapphire' }), id: 'q-sapphire' },
];
const design = {
    ...oneEnvironmentDesign(), id: 'mc-switch', qualifiers: checks,
    environments: [
        { id: 'base', name: 'BK7' },
        { id: 'env2', name: 'Sapphire', substrate: { material: 'builtin:Al2O3' } },
        { id: 'env3', thicknessFactors: { 'builtin:TiO2': 0.95 }, enabled: false },
    ],
};

// ── 1 and 2. The droplist after a run ───────────────────────────────────────
{
    const analysis = mount(() => useErrorAnalysis({ design, evalMode: 'front' }));
    analysis.out.setNTrials(6);
    analysis.out.setSeed(77);
    analysis.render();
    await analysis.out.handleRun();
    const first = analysis.render().result;
    assert.deepEqual(ids(first), ['base', 'env2'], 'a run computes every environment that is on');
    assert.equal(first.seed, 77);
    const runs = made;

    environmentChoiceSession.write(design, { choice: 'env2' });
    const two = analysis.render();
    assert.equal(two.running, false, 'switching to an environment the run computed starts no run');
    assert.deepEqual(spreadOf(two.shown), spreadOf(first.environments[1]), 'and shows its spread from that run');
    assert.notDeepEqual(spreadOf(two.shown), spreadOf(first.environments[0]), 'not environment 1\'s');
    assert.equal(made, runs);

    environmentChoiceSession.write(design, { choice: 'env3' });
    assert.equal(analysis.render().shown, null, 'the run did not compute environment 3');
    assert.equal(analysis.render().running, true, 'so choosing it, though it is off, runs again');
    assert.ok(await until(analysis, out => !out.running && out.result !== first), 'and the run ends');
    const again = analysis.render().result;
    assert.equal(made, runs + 1, 'one run');
    assert.deepEqual(ids(again), ['base', 'env2', 'env3'], 'environment 3 beside every environment that is on');
    assert.equal(again.seed, 77, 'from the seed of the run before');
    assert.deepEqual(again.environments.slice(0, 2).map(spreadOf), first.environments.map(spreadOf), 'the same trials');
    assert.deepEqual(spreadOf(analysis.render().shown), spreadOf(again.environments[2]), 'and the window shows environment 3\'s spread');

    environmentChoiceSession.write(design, { choice: 'current' });
    const back = analysis.render();
    assert.equal(back.running, false, 'going back starts no run');
    assert.deepEqual(spreadOf(back.shown), spreadOf(again.environments[0]));
    assert.equal(made, runs + 1);

    // A run of environment 1 and 2 alone, then another, and environment 3
    // chosen while that one goes: neither run computes it, so once the run
    // lands the window runs again.
    await analysis.render().handleRun();
    const before = analysis.render().result;
    assert.deepEqual(ids(before), ['base', 'env2']);
    analysis.out.setNTrials(400);
    const going = analysis.render().handleRun();
    assert.ok(await until(analysis, out => out.running && out.progress.i > 0), 'the run goes');
    environmentChoiceSession.write(design, { choice: 'env3' });
    assert.equal(analysis.render().running, true, 'and is not stopped by the choice');
    await going;
    assert.ok(await until(analysis, out => !out.running && ids(out.result).includes('env3')),
        'once it lands, environment 3 is run again');
    assert.equal(made, runs + 4, 'in one more run');
    assert.equal(analysis.render().shown.lambda.length > 0, true, 'and the window shows its spread');
}

// ── 3. Saved specs ──────────────────────────────────────────────────────────
{
    const en = getLocale('en');
    let saved = null;
    let written = null;
    globalThis.window.electronAPI = {
        listQualifierPresets: async () => ({ success: true, presets: [] }),
        saveQualifierPreset: async preset => { saved = preset; return { success: true }; },
        loadQualifierPreset: async () => ({ success: true, preset: { name: 'Sapphire spec', qualifiers: checks } }),
    };
    const presets = mount(() => useDiskPresets({
        qualifiers: checks, writeQualifiers: next => { written = next; }, checkpoint: () => {}, design,
        ts: en.specification, t: en, setInputDialog: dialog => dialog?.onConfirm('Sapphire spec'),
    }));
    presets.out.onSavePreset();
    assert.ok(await until(presets, () => saved != null, 5000), 'the spec is saved');
    assert.deepEqual(saved.qualifiers, checks.map(({ env, ...q }) => q), 'without env'); // eslint-disable-line no-unused-vars
    assert.ok(checks[1].env === 'env2', 'and the window\'s own checks keep theirs');
    await presets.render().onLoadDiskPreset('Sapphire spec', 'replace');
    assert.equal(written.length, 2, 'a saved spec is loaded');
    assert.ok(written.every(q => !('env' in q)), 'without env, though the file held one');
    assert.equal(written[0].kind, 'R_AVG');
}

console.log('environments_monte_carlo_switch: all checks passed');
