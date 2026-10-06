/**
 * Systematic Deviations: a swept material the design no longer has.
 *
 * The sweep parameter is kept per design and names a material by id. After
 * that material is replaced in the design, the parameter selector has no such
 * option and shows its first one, Global d-scale, while a run would perturb a
 * material no layer uses and print a flat result under the old name. The
 * window must sweep what its selector shows, and drop the result swept on the
 * material that is gone, without touching another design's sweep.
 *
 * The window's hook is driven through the hook harness, with a design context
 * standing in for the provider, so the store write its effect makes is seen.
 */
import assert from 'node:assert/strict';
import { importWithHookRuntime, makeHookRuntime } from './_hookHarness.mjs';

globalThis.window = Object.assign(new EventTarget(), { electronAPI: {} });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const runtime = makeHookRuntime();
let designCtx = null;
let designContext = null;
// Contexts the hook reads: the design, and the window copy, which is none here.
runtime.React.createContext = value => ({ value });
runtime.React.useContext = context => (context === designContext ? designCtx : null);
runtime.React.createElement = () => null;

const { DesignContext } = await importWithHookRuntime('../src/state/DesignContext.js', runtime);
designContext = DesignContext;
const { useSystematicDeviations } = await importWithHookRuntime(
    '../src/components/windows/analysis/systematicDeviations/useSystematicDeviations.js', runtime);
const model = await import('../src/components/windows/analysis/systematicDeviations/model.js');
const { systematicDeviationsSession: store } = await import(
    '../src/components/windows/analysis/systematicDeviations/sessionState.js');
const { enumerateUniqueMaterials } = await import('../src/utils/physics/systematicDeviations.js');
// The session hook reads React when it is called, not when it is imported.
globalThis.React = runtime.React;

const designWith = (id, material) => ({
    id, name: id, incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air', referenceWavelength: 550,
    substrate: { material: 'builtin:BK7', thickness: 1 }, surfaceMode: 'front_only',
    spectrumLambdaStart: 500, spectrumLambdaEnd: 600, spectrumLambdaStep: 50,
    frontLayers: [{ id: 'a', material, thickness: 60 }, { id: 'b', material: 'builtin:SiO2', thickness: 94 }],
    backLayers: [],
});
const replaced = designWith('sysdev-replaced', 'builtin:Ta2O5');
// The session as it was before Replace Materials turned TiO2 into Ta2O5.
const stale = { param: 'mat:builtin:TiO2:dn', from: -0.05, to: 0.05, steps: 5, offsetUnit: 'nm' };
const someResult = { lambda: [500], paramValues: [0], T2D: [[0.5]], R2D: [[0.5]], A2D: [[0]], paramName: 'x' };

function renderFor(design) {
    designCtx = { design, evalMode: 'front' };
    return runtime.render(() => useSystematicDeviations());
}
const runEffects = () => { for (const effect of runtime.pendingEffects()) effect(); };

// ── The parameter the design can still run ───────────────────────────────────
{
    const mats = enumerateUniqueMaterials(replaced);
    const reset = model.sweepForDesign(stale, mats);
    assert.equal(reset.param, 'globalThicknessScale',
        'a material the design no longer uses falls back to the option the selector shows');
    assert.deepEqual([reset.from, reset.to], [0.95, 1.05], 'with that option\'s own range');
    assert.equal(reset.steps, 5, 'the step count is the user\'s and stays');

    const live = { ...stale, param: 'mat:builtin:Ta2O5:dn' };
    assert.equal(model.sweepForDesign(live, mats), live, 'a material still in the design is kept as it is');
    const global = { ...stale, param: 'globalDeltaN' };
    assert.equal(model.sweepForDesign(global, mats), global, 'a global parameter is never touched');
    const medium = { ...stale, param: 'mat:builtin:BK7:dn' };
    assert.equal(model.sweepForDesign(medium, mats), medium, 'the substrate counts as a design material');
}

// ── The window shows and runs what its selector shows ────────────────────────
{
    store.write(replaced, { mode: 'sweep', sweep: stale, sweepResult: someResult });
    const state = renderFor(replaced);
    assert.equal(state.sweep.param, 'globalThicknessScale', 'the controls show the parameter a run will use');
    assert.deepEqual([state.sweep.from, state.sweep.to], [0.95, 1.05]);
    assert.equal(state.sweepResult, null, 'the result swept on the replaced material is not shown');

    runEffects();
    const stored = store.read(replaced);
    assert.equal(stored.sweep.param, 'globalThicknessScale', 'the store is put right, so later edits start from it');
    assert.equal(stored.sweepResult, null, 'and the stale result is dropped from it');
}

// ── A design switch never writes one design's sweep over another's ───────────
{
    store.reset();
    const titania = designWith('sysdev-titania', 'builtin:TiO2');
    const other = designWith('sysdev-other', 'builtin:Ta2O5');
    const ownSweep = { param: 'mat:builtin:Ta2O5:dk', from: -0.01, to: 0.01, steps: 7, offsetUnit: 'nm' };
    store.write(titania, { mode: 'sweep', sweep: stale, sweepResult: someResult });
    store.write(other, { mode: 'sweep', sweep: ownSweep, sweepResult: someResult });

    renderFor(titania);
    runEffects();
    // The first render after the switch still holds the previous design's values.
    renderFor(other);
    runEffects();
    const kept = store.read(other);
    assert.deepEqual(kept.sweep, ownSweep, 'the other design keeps its own sweep');
    assert.equal(kept.sweepResult, someResult, 'and its own result');
    assert.equal(store.read(titania).sweep, stale, 'the design that was left is not touched either');
}

console.log('PASS: readers_sysdev_sweep_param');
