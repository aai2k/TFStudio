/**
 * After Stop, Needle Automatic, Gradual Evolution and the Structural Optimizer show the last design the
 * run accepted, the one the next Run goes on from.
 *
 * A worker's in-flight candidate is written to the screen as a transient
 * preview without moving the design the next Run goes on from, so a Stop left
 * the screen on a candidate nothing had accepted.
 *
 *   1. showAcceptedDesign writes the base design's layers, copied, as a
 *      transient update, with the last row's readouts, and nothing when no
 *      design has been accepted.
 *   2. Stop in each window's hook, with a run going, writes that design.
 *   3. A Stop with no run going writes nothing (Best, Reset and Restore press
 *      Stop first and then write their own design).
 *   4. A design edited while the run was going is left as it is.
 *
 * The hooks run under the effect-running stand-in for React in
 * _effectRuntime.mjs, on a worker pool whose workers never answer.
 *
 * Run: node tests/synthesis_stop_shows_accepted.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

shimBrowserGlobals();
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 1 }, configurable: true, writable: true });

const R = makeEffectRuntime(globalThis.React);
globalThis.React = R;

const { DesignContext } = await import('../src/state/DesignContext.js');
const { useNeedleVariation } = await import('../src/components/windows/optimization/needleVariation/useNeedleVariation.js');
const { useGradualEvolution } = await import('../src/components/windows/optimization/gradualEvolution/useGradualEvolution.js');
const { useStructuralOptimizer } = await import('../src/components/windows/optimization/structuralOptimizer/useStructuralOptimizer.js');
const { showAcceptedDesign } = await import('../src/components/windows/optimization/synthesisShared/showAcceptedDesign.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { default: EN } = await import('../src/constants/locales/en.js');

const layers = [
    { id: 'a', material: 'TiO2', thickness: 30, locked: false },
    { id: 'b', material: 'SiO2', thickness: 50, locked: false },
];
const design = {
    id: 'stop-accepted', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [], frontLayers: layers,
    meritOperands: [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 })],
};

// ── 1. The helper ────────────────────────────────────────────────────────────
{
    const calls = [];
    const shown = {};
    const updateDesignRef = { current: (patch, opts) => calls.push({ patch, opts }) };
    const readouts = { setMf: v => { shown.mf = v; }, setOmf: v => { shown.omf = v; }, setLayerCount: v => { shown.layers = v; } };
    const rowsRef = { current: [] };
    const base = { frontLayers: layers, backLayers: [{ id: 'c', material: 'SiO2', thickness: 10, locked: false }] };

    showAcceptedDesign({ baseDesignRef: { current: null }, updateDesignRef, rowsRef, ...readouts });
    assert.equal(calls.length, 0, 'no accepted design, nothing written');

    showAcceptedDesign({ baseDesignRef: { current: base }, updateDesignRef, rowsRef, ...readouts });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].opts, { transient: true }, 'the write is a transient preview, not an edit');
    assert.deepEqual(calls[0].patch.frontLayers, base.frontLayers);
    assert.deepEqual(calls[0].patch.backLayers, base.backLayers);
    assert.notEqual(calls[0].patch.frontLayers, base.frontLayers, 'the layers are copied');
    assert.deepEqual(shown, { mf: null, omf: null, layers: 2 }, 'no row yet: empty MF and OMF, the layer count of the start design');

    const snaps = { frontSnap: base.frontLayers, backSnap: base.backLayers };
    rowsRef.current = [
        { ...snaps, mf: 0.5, omf: 0.4, layerCount: 7 }, { ...snaps, mf: 0.25, omf: 0.2, layerCount: 9 },
        { frontSnap: [], backSnap: [], mf: 0.1, omf: 0.1, layerCount: 1 },
    ];
    showAcceptedDesign({ baseDesignRef: { current: base }, updateDesignRef, rowsRef, ...readouts });
    assert.deepEqual(shown, { mf: 0.25, omf: 0.2, layers: 9 }, 'the readouts are those of the last row that is the design shown');
}

// ── 2 to 4. Each window's Stop ───────────────────────────────────────────────
const noop = () => {};
const windows = {
    'Needle Automatic': (ctx) => {
        DesignContext.value = ctx;
        return () => R.run(() => useNeedleVariation(EN));
    },
    'Gradual Evolution': (ctx) => () => R.run(() => useGradualEvolution({ ...ctx, t: EN })),
    'Structural Optimizer': (ctx) => () => R.run(() => useStructuralOptimizer({ ...ctx, t: EN })),
};

for (const [name, windowOf] of Object.entries(windows)) {
    const writes = [];
    let revision = 0;
    const ctx = {
        design, updateDesign: (patch, opts) => writes.push({ patch, opts }), checkpoint: noop,
        beginOptimization: noop, endOptimization: noop, getDesignRevision: () => revision,
    };
    const mount = windowOf(ctx);

    mount().stopOpt('');
    assert.equal(writes.length, 0, `${name}: a Stop with no run going writes nothing`);

    mount().runOpt();
    assert.notEqual(mount().phase, 'idle', `${name}: setup, the run started`);
    const before = writes.length;
    mount().stopOpt('');
    const stop = writes.slice(before);
    assert.equal(stop.length, 1, `${name}: Stop writes the accepted design once`);
    assert.deepEqual(stop[0].opts, { transient: true }, `${name}: as a transient preview`);
    assert.deepEqual(stop[0].patch.frontLayers, layers, `${name}: the layers are the design the run goes on from`);

    mount().runOpt();
    revision += 1;
    const beforeEdit = writes.length;
    mount().stopOpt('');
    assert.equal(writes.length, beforeEdit, `${name}: a design edited during the run is left as it is`);
    R.unmount();
}

console.log('Synthesis stop shows accepted design tests passed.');
process.exit(0);
