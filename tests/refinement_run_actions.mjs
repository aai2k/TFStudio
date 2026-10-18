/**
 * What Reset, Restore and Best do with a Refinement run
 * (refinement/useRefinement.js, refinement/windowRun.js).
 *
 *   1. Reset during an SQP run: once the stopped run has settled, the readout is
 *      still cleared and no iterations come back.
 *   2. Reset during a parallel DE run: DE's last readout does not come back.
 *   3. Restore of a history row during a DLS run: the run's readout does not
 *      come back over the restored design.
 *   4. Best after a stopped DLS run on a design with both sides optimized puts
 *      the run's best layers on the front and on the back; after a front-only
 *      run it puts on the front only, whatever the design's mode is by then.
 * After 1, 2 and 3, Best has nothing to apply, also once the window has shown
 * another design and come back.
 *
 * The hook runs under a small stand-in for React that honours effect
 * dependencies and cleanups, and a scripted Worker stands in for the optimizer
 * worker (_scriptedOptimizerWorker.mjs).
 *
 * Run: node tests/refinement_run_actions.mjs
 */
import assert from 'node:assert/strict';
import { makeEffectRuntime } from './_effectRuntime.mjs';
import { ScriptedWorker } from './_scriptedOptimizerWorker.mjs';

const store = new Map();
globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); },
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 4 }, configurable: true, writable: true,
});

globalThis.Worker = ScriptedWorker;

const R = makeEffectRuntime();
globalThis.React = R;

const { DesignContext } = await import('../src/state/DesignContext.js');
const { useRefinement } = await import('../src/components/windows/optimization/refinement/useRefinement.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { default: EN } = await import('../src/constants/locales/en.js');

const OPS = () => [
    makeOperand({ type: 'RAV', lambdaStart: 480, lambdaEnd: 520, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    makeOperand({ type: 'TAV', lambdaStart: 600, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
];
const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
const designOf = (id, frontLayers) => ({
    id, name: id, incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 }, referenceWavelength: 550,
    surfaceMode: 'front_only', mfEvalMode: 'side', frontLayers, backLayers: [], meritOperands: OPS(),
});
const designs = {
    A: designOf('A', [layer('a1', 'TiO2', 110), layer('a2', 'SiO2', 90), layer('a3', 'TiO2', 65)]),
    D: designOf('D', [layer('d1', 'TiO2', 100), layer('d2', 'SiO2', 120), layer('d3', 'TiO2', 80), layer('d4', 'SiO2', 95)]),
    W: {
        ...designOf('W', [layer('w1', 'TiO2', 100), layer('w2', 'SiO2', 120)]),
        backLayers: [layer('k1', 'TiO2', 80), layer('k2', 'SiO2', 95)],
        surfaceMode: 'both_independent',
    },
};

const t = { refinement: { ...EN.refinement, history: { run: n => `Run ${n}` } } };
const noop = () => {};
let current = 'A';
let state;
const render = () => {
    DesignContext.value = {
        design: designs[current],
        updateDesign: patch => { designs[current] = { ...designs[current], ...patch }; },
        checkpoint: noop, beginOptimization: noop, endOptimization: noop,
        isOptimizing: false, liveUpdate: true,
    };
    state = useRefinement({ t });
};
const settle = () => R.run(render);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pause = async () => { await sleep(20); settle(); };

async function startHeldRun(method) {
    state.onMethod(method);
    settle();
    ScriptedWorker.hold = true;
    state.onRun();
    settle();
    await pause();
    assert.ok(state.running, `the ${method} run is in flight`);
}

const thicknesses = id => [...designs[id].frontLayers, ...designs[id].backLayers].map(l => l.thickness);

// The readout a cleared run leaves: no iterations, best, trend or end reason.
// Best has nothing to apply either, also after the window shows another design
// and comes back.
function assertCleared(what) {
    assert.equal(state.running, false, `${what}: the run is over`);
    assert.equal(state.iter, 0, `${what}: no iterations come back`);
    assert.equal(state.mfBest, null, `${what}: no best merit comes back`);
    assert.deepEqual(state.mfHistory, [], `${what}: no merit trend comes back`);
    assert.equal(state.stopReason, null, `${what}: no end reason comes back`);
    const here = current, before = thicknesses(here);
    current = here === 'A' ? 'D' : 'A';
    settle();
    current = here;
    settle();
    state.onBest();
    settle();
    assert.deepEqual(thicknesses(here), before, `${what}: Best has nothing to apply`);
}

// ── 1. Reset during an SQP run ───────────────────────────────────────────────
current = 'A';
settle();
await startHeldRun('sqp');
state.onReset();
settle();
await pause();
assertCleared('Reset during SQP');

// ── 2. Reset during a parallel DE run ────────────────────────────────────────
current = 'D';
settle();
await startHeldRun('de');
state.onReset();
settle();
await pause();
assertCleared('Reset during DE');

// ── 3. Restore during a run ──────────────────────────────────────────────────
current = 'A';
settle();
state.onMethod('sqp');
settle();
ScriptedWorker.hold = false;
state.onRun();
settle();
while (state.running) await pause();
const entry = state.histEntries[state.histEntries.length - 1];
assert.ok(entry, 'a finished run leaves a history row to restore');
await startHeldRun('dls');
state.onRestore(entry);
settle();
await pause();
assertCleared('Restore during a run');
assert.deepEqual(designs.A.frontLayers.map(l => l.thickness), entry.layers.map(l => l.thickness),
    'the restored layers stay on the design');

// ── 4. Best on a design with both sides optimized ────────────────────────────
// The worker's live layers run 10 nm ahead of its best ones, as a DLS run's do
// between improvements, so the live preview is not the design Best applies.
class LiveAheadWorker extends ScriptedWorker {
    post(data) {
        const ahead = layers => layers?.map(l => ({ ...l, thickness: l.thickness + 10 }));
        super.post(data.type === 'progress'
            ? { ...data, frontLayers: ahead(data.frontLayers), backLayers: ahead(data.backLayers) }
            : data);
    }
}
globalThis.Worker = LiveAheadWorker;
const startW = { front: designs.W.frontLayers.map(l => l.thickness), back: designs.W.backLayers.map(l => l.thickness) };
current = 'W';
settle();
await startHeldRun('dls');
state.onStop();
settle();
state.onBest();
settle();
const bestOf = start => start.map((d, i) => d + i + 1);
assert.deepEqual(designs.W.frontLayers.map(l => l.thickness), bestOf(startW.front), 'Best puts the best front layers on the design');
assert.deepEqual(designs.W.backLayers.map(l => l.thickness), bestOf(startW.back), 'and the best back layers');
globalThis.Worker = ScriptedWorker;

// A front-only run, then the design switched to both sides with a layer added
// on the back: Best puts the run's front on, and leaves the back the user edited.
designs.F = { ...designOf('F', [layer('f1', 'TiO2', 100), layer('f2', 'SiO2', 120)]), backLayers: [layer('g1', 'TiO2', 80)] };
current = 'F';
settle();
const startF = designs.F.frontLayers.map(l => l.thickness);
await startHeldRun('dls');
state.onStop();
settle();
designs.F = { ...designs.F, surfaceMode: 'both_independent', backLayers: [...designs.F.backLayers, layer('g2', 'SiO2', 90)] };
settle();
const editedBack = designs.F.backLayers.map(l => l.thickness);
state.onBest();
settle();
assert.deepEqual(designs.F.frontLayers.map(l => l.thickness), bestOf(startF), 'Best puts the front-only run\'s front on');
assert.deepEqual(designs.F.backLayers.map(l => l.thickness), editedBack, 'and leaves the back as the user edited it');

console.log('Refinement run actions tests passed.');
