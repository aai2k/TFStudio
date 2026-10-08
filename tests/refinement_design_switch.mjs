/**
 * Refinement shows the last run of the design on screen
 * (refinement/useRefinement.js, refinement/sessionState.js).
 *
 *   1. After a run on one design, switching to a design never refined shows no
 *      run: no iterations, no end reason, no merit trend.
 *   2. Best acts on the run of the design on screen, never on the layers of the
 *      design refined before it.
 *   3. Switching back shows the first design's run again, and so does opening
 *      the window again after a tab switch.
 *   4. A switch in the middle of a run stops it, and what the stopped run hands
 *      back stays off the design switched to.
 *
 * The hook runs under a small stand-in for React that honours effect
 * dependencies and cleanups. A scripted Worker stands in for the optimizer
 * worker: this checks what the window keeps per design, not the optimizer.
 *
 * Run: node tests/refinement_design_switch.mjs
 */
import assert from 'node:assert/strict';
import { makeEffectRuntime } from './_effectRuntime.mjs';

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
// The DLS method runs on the event-driven worker path.
store.set('tfstudio-refinement-method', 'dls');

// A worker that reports one progress step and finishes, moving every layer by
// its index so the best design it returns is recognisable. With `holdRuns` it
// stops after the progress step, leaving the run in flight.
let holdRuns = false;
class ScriptedWorker {
    constructor() { this.onmessage = null; this.terminated = false; }
    postMessage(job) {
        if (job?.type !== 'start') return;
        setTimeout(() => {
            const shift = layers => (layers || []).map((l, i) => ({ ...l, thickness: l.thickness + i + 1 }));
            const front = shift(job.design.frontLayers), back = shift(job.design.backLayers);
            const layers = { frontLayers: front, backLayers: back, bestFrontLayers: front, bestBackLayers: back };
            this.post({ type: 'progress', iter: 5, mf: 0.02, mfBest: 0.02, omf: 0.02, omfBest: 0.02, ...layers });
            if (holdRuns) return;
            this.post({ type: 'done', iter: 12, mf: 0.01, mfBest: 0.01, omf: 0.01, omfBest: 0.01, reason: 'stalled', ...layers });
        }, 0);
    }
    post(data) { if (!this.terminated && this.onmessage) this.onmessage({ data }); }
    terminate() { this.terminated = true; }
}
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
const designOf = (id, frontLayers, meritOperands) => ({
    id, name: id, incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 }, referenceWavelength: 550,
    surfaceMode: 'front_only', mfEvalMode: 'side', frontLayers, backLayers: [], meritOperands,
});
const designs = {
    A: designOf('A', [layer('a1', 'TiO2', 110), layer('a2', 'SiO2', 90), layer('a3', 'TiO2', 65)], OPS()),
    B: designOf('B', [layer('b1', 'TiO2', 80), layer('b2', 'SiO2', 120)], OPS()),
    C: designOf('C', [layer('c1', 'TiO2', 95)], []),
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
const show = id => { current = id; settle(); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function refine() {
    state.onRun();
    settle();
    const start = Date.now();
    while (state.running) {
        assert.ok(Date.now() - start < 8000, 'the run finishes');
        await sleep(2);
        settle();
    }
}

const readout = () => ({
    iter: state.iter, stopReason: state.stopReason, mfBest: state.mfBest, mfInitial: state.mfInitial,
    trend: state.plotHistory.map(point => point.iter),
});

// ── 1. A design never refined shows no run ───────────────────────────────────
show('B');
await refine();
const runB = readout();
assert.equal(runB.iter, 12, 'the run on B shows its iterations');
assert.equal(runB.stopReason, 'stalled');
assert.ok(runB.trend.length > 0, 'and its merit trend');
const bestB = designs.B.frontLayers.map(l => [l.id, l.thickness]);

show('A');
await refine();
const runA = readout();
assert.equal(runA.iter, 12);

show('C');
assert.deepEqual(readout(), { iter: 0, stopReason: null, mfBest: null, mfInitial: null, trend: [] },
    'a design never refined shows no iterations, no end reason and no trend');

// ── 2. Best acts on the design on screen ─────────────────────────────────────
show('B');
assert.deepEqual(readout(), runB, 'B shows its own run, not the run on A after it');
assert.ok(state.canReset, 'B keeps its Reset baseline, so Best is offered');
state.onBest();
settle();
assert.deepEqual(designs.B.frontLayers.map(l => [l.id, l.thickness]), bestB,
    'Best on B applies B\'s best design, never A\'s layers');

// ── 3. Switching back, and reopening the window, shows the design's own run ──
show('A');
assert.deepEqual(readout(), runA, 'switching back shows A\'s run again');
R.unmount();
settle();
assert.deepEqual(readout(), runA, 'and so does opening the window again');

// ── 4. A switch in the middle of a run ───────────────────────────────────────
// SQP runs on the method flow, which still gets the stopped worker's result
// after the switch.
state.onMethod('sqp');
holdRuns = true;
settle();
state.onRun();
settle();
await sleep(20);
settle();
assert.ok(state.running && state.iter === 5, 'the run on A is in flight');
show('B');
await sleep(20);
settle();
assert.equal(state.running, false, 'the switch stops the run');
assert.deepEqual(readout(), runB, 'B shows its own run, not the one stopped on A');
state.onBest();
settle();
assert.deepEqual(designs.B.frontLayers.map(l => l.id), ['b1', 'b2'], 'Best on B never writes A\'s layers');

console.log('Refinement design switch tests passed.');
