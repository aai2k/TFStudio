/**
 * Refresh all makes every open window compute again from the files just read.
 *
 *   1. The window hook runs its action once after each Refresh all, never on
 *      mount, and with the values of the render that follows the refresh.
 *   2. DesignContext hands windows a new design object, with the same content,
 *      even for a design of built-in materials only; the stored design is left
 *      as it was.
 *   3. The Process Exporter, whose spectra are keyed on a text key, computes
 *      them again, and does after a catalog edit too.
 *   4. Results a button produced are produced again when one is on screen: the
 *      Systematic Deviations sweep, the Error Analysis Monte Carlo after a run,
 *      the Plot Engine surface, and the CODE V and Zemax text. With none on
 *      screen nothing runs.
 *
 * Run: node tests/refresh_all_recompute.mjs
 */
import assert from 'node:assert/strict';
import { makeSampleDesign, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
// Window events that are delivered: Node's global has none, and the shim's
// are no-ops.
const events = new EventTarget();
globalThis.addEventListener = events.addEventListener.bind(events);
globalThis.removeEventListener = events.removeEventListener.bind(events);
globalThis.dispatchEvent = events.dispatchEvent.bind(events);

const rt = makeHookRuntime();
// Contexts read their default unless a test puts a value on one.
const provided = new Map();
Object.assign(rt.React, {
    createElement: (type, props, ...children) => ({ type, props, children }),
    createContext: value => ({ value, Provider: 'Provider' }),
    useContext: context => (provided.has(context) ? provided.get(context) : context?.value ?? null),
});
globalThis.React = rt.React;

const { REFRESH_ALL, announceRefreshAll, useAfterRefreshAll } = await import('../src/state/refreshAll.js');
const { DesignContext, DesignProvider } = await import('../src/state/DesignContext.js');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

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

// A refresh, and the render that follows it.
function refresh(component) {
    announceRefreshAll();
    return component.render();
}

// ── 1. useAfterRefreshAll ────────────────────────────────────────────────────
{
    const calls = [];
    let label = 'first';
    const component = mount(() => useAfterRefreshAll(() => calls.push(label)));
    assert.deepEqual(calls, [], 'nothing runs on mount');
    component.render();
    assert.deepEqual(calls, [], 'nor on a render without a refresh');
    label = 'second';
    refresh(component);
    assert.deepEqual(calls, ['second'], 'one run per refresh, with the action of that render');
    component.render();
    assert.deepEqual(calls, ['second'], 'and not again on the next render');
    assert.equal(REFRESH_ALL, 'tfstudio:refresh-all');
}

// ── 2. DesignContext ─────────────────────────────────────────────────────────
{
    const builtinOnly = { ...makeSampleDesign(), id: 'builtin' };
    const props = { activeDesignId: 'builtin', designs: { builtin: builtinOnly }, onDesignChange: () => {}, folders: [] };
    const provider = mount(() => DesignProvider(props).props.value);
    assert.equal(provider.out.design, builtinOnly, 'before a refresh windows get the stored design');
    const after = refresh(provider).design;
    assert.notEqual(after, builtinOnly, 'a refresh hands windows a new object for a design of built-in materials');
    assert.deepEqual(after, builtinOnly, 'with the same content');
    assert.equal(provider.render().design, after, 'the same object on the renders after it');
    assert.equal(props.designs.builtin, builtinOnly, 'the stored design is left as it was');

    // A design the refresh replaced from disk counts as edited, so a synthesis
    // window does not carry on from a stack it cached before.
    const revision = id => provider.out.getDesignRevision(id);
    const before = [revision('builtin'), revision('other')];
    announceRefreshAll(['builtin']);
    provider.render();
    assert.deepEqual([revision('builtin'), revision('other')], [before[0] + 1, before[1]],
        'only the designs the refresh changed move their edit revision');
}

// The window hooks below read the design from DesignContext.
const design = { ...makeSampleDesign(), id: 'refresh-design' };
provided.set(DesignContext, { design, evalMode: 'front', hasActiveDesign: true });

// ── 3. Process Exporter ──────────────────────────────────────────────────────
{
    const { useSpectra } = await import('../src/components/windows/dataExchange/processSimulator/useSpectra.js');
    const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
    const setup = {
        activeSide: 'front', secondSurface: 'bare', quantity: 'T', aoi: 0, polarization: 'avg',
        lambdaStart: 500, lambdaEnd: 520, lambdaStep: 10,
    };
    const deposition = {
        N: 0, activeDep: [], otherDep: [], chips: null, layerIdx: 0, frac: 0,
        incidentMat: getMaterial('Air'), exitMat: getMaterial('Air'), substrateMat: getMaterial('BK7'), substrateThk: 1,
    };
    const spectra = mount(() => useSpectra(design, setup, deposition));
    const before = spectra.out.baselineSpec;
    assert.ok(before?.values?.length, 'the exporter has a spectrum');
    assert.equal(spectra.render().baselineSpec, before, 'which a render alone does not compute again');
    const refreshed = refresh(spectra).baselineSpec;
    assert.notEqual(refreshed, before, 'a refresh computes it again');

    // A material edited in the Material Editor keeps its id, so the key built
    // from ids and thicknesses alone never saw it.
    const { notifyCatalogsChanged } = await import('../src/utils/materials/catalogManager/persistence.js');
    notifyCatalogsChanged();
    assert.notEqual(spectra.render().baselineSpec, refreshed, 'and so does a catalog edit');
}

// ── 4. Results a button produced ─────────────────────────────────────────────
{
    const { useSystematicDeviations } = await import(
        '../src/components/windows/analysis/systematicDeviations/useSystematicDeviations.js');
    const sweep = mount(() => useSystematicDeviations());
    await tick();
    sweep.render();
    assert.equal(sweep.out.sweepResult ?? null, null, 'no sweep has been run');
    refresh(sweep);
    await tick();
    assert.equal(sweep.render().sweepResult ?? null, null, 'so a refresh runs none');

    sweep.out.runSweep();
    await tick();
    const first = sweep.render().sweepResult;
    assert.ok(first, 'a sweep is on screen');
    refresh(sweep);
    await tick();
    const second = sweep.render().sweepResult;
    assert.ok(second && second !== first, 'a refresh runs the sweep again');
    assert.deepEqual(second.values ?? second, first.values ?? first, 'with the same numbers from the same files');
}

{
    const { useErrorAnalysis } = await import('../src/components/windows/analysis/errorAnalysis/useErrorAnalysis.js');
    const analysis = mount(() => useErrorAnalysis({ design, evalMode: 'front' }));
    analysis.out.setNTrials(4);
    analysis.render();
    refresh(analysis);
    for (let i = 0; i < 20; i++) await tick();
    assert.equal(analysis.render().result ?? null, null, 'before a run, a refresh runs no Monte Carlo');

    await analysis.out.handleRun();
    const first = analysis.render().result;
    assert.ok(first, 'a Monte Carlo result is on screen');
    refresh(analysis);
    for (let i = 0; i < 20; i++) await tick();
    const second = analysis.render().result;
    assert.ok(second && second !== first, 'after a run, a refresh runs it again');
}

{
    const { useSurfacePlot } = await import('../src/components/windows/analysis/plotEngine/surfaceState.js');
    const surface = mount(() => useSurfacePlot(design, 'front'));
    refresh(surface);
    assert.equal(surface.render().computing, false, 'with no surface on screen a refresh computes none');
    surface.out.setSurfaceResult({ ok: true, x: [0], y: [0], z: [[0]] });
    surface.render();
    refresh(surface);
    assert.equal(surface.render().computing, true, 'with one on screen a refresh computes it again');
}

for (const kind of ['codevCoatings', 'zemaxCoatings']) {
    const { useGenerateAction } = await import(`../src/components/windows/dataExchange/${kind}/useExportActions.js`);
    const generated = [];
    const z = new Proxy({}, { get: () => () => '' });
    const args = preview => ({
        z, flash: () => {}, design, side: 'front', title: 'T', saveName: 'coat', coatName: 'COAT',
        gStart: 400, gEnd: 700, gStep: 100, anglesDeg: [0], refNm: 550, scope: 'used', thMode: 'nm',
        preview,
        setExport: text => generated.push(text), setPreview: text => generated.push(text),
    });
    let preview = '';
    const action = mount(() => useGenerateAction(args(preview)));
    refresh(action);
    assert.deepEqual(generated, [], `${kind}: with no text on screen a refresh generates none`);
    preview = 'generated before';
    action.render();
    refresh(action);
    assert.equal(generated.length, 1, `${kind}: with a text on screen a refresh generates it again`);
    assert.ok(generated[0].length > 0, `${kind}: from the design`);
}

console.log('PASS: refresh_all_recompute');
