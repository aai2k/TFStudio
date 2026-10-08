/**
 * Pulse Analysis shows the result it already has when it is mounted again
 * (pulseAnalysis/usePulseAnalysis.js, pulseAnalysis/sessionState.js).
 *
 * A dock group draws only its active tab, so switching to another tab and back,
 * docking or redocking mounts the window afresh. A run takes seconds, and each
 * of those used to start it again.
 *
 *   1. Mounted again with the same design and settings, the window shows the
 *      finished result and starts no worker.
 *   2. A changed setting runs again.
 *   3. A stopped run stays stopped when the window is mounted again, and a
 *      changed setting runs again after Stop.
 *
 * The hook runs under a small stand-in for React that honours effect
 * dependencies and cleanups. A scripted Worker stands in for the analysis
 * worker: this checks what the window keeps, not the physics.
 *
 * Run: node tests/pulse_analysis_remount.mjs
 */
import assert from 'node:assert/strict';
import { makeEffectRuntime } from './_effectRuntime.mjs';

globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

// A worker that answers each evaluation with a numbered result, unless runs
// are held, which leaves them in flight.
let started = 0;
let holdRuns = false;
class ScriptedWorker {
    constructor() { started += 1; this.terminated = false; }
    postMessage(job) {
        if (job?.type !== 'evaluate' || holdRuns) return;
        const data = { valid: true, run: started };
        setTimeout(() => { if (!this.terminated) this.onmessage?.({ data: { type: 'result', data } }); }, 0);
    }
    terminate() { this.terminated = true; }
}
globalThis.Worker = ScriptedWorker;

const R = makeEffectRuntime();
globalThis.React = R;

const { DesignContext } = await import('../src/state/DesignContext.js');
const { usePulseAnalysis } = await import('../src/components/windows/analysis/pulseAnalysis/usePulseAnalysis.js');

const design = {
    id: 'mirror', name: 'mirror', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 }, referenceWavelength: 800, surfaceMode: 'front_only',
    frontLayers: [{ id: 'h', material: 'TiO2', thickness: 80 }, { id: 'l', material: 'SiO2', thickness: 137 }],
    backLayers: [], meritOperands: [],
};
const noop = () => {};
let state;
const render = () => {
    DesignContext.value = {
        design, updateDesign: noop, checkpoint: noop, isOptimizing: false, liveUpdate: true,
    };
    state = usePulseAnalysis(design);
};
const settle = () => R.run(render);
const remount = () => { R.unmount(); settle(); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function finish() {
    settle();
    const start = Date.now();
    while (state.evaluation.busy) {
        assert.ok(Date.now() - start < 2000, 'the run finishes');
        await sleep(2);
        settle();
    }
}

// ── 1. Mounted again, the same request shows its result ─────────────────────
await finish();
assert.equal(started, 1, 'the first mount runs the pulse');
const first = state.evaluation.data;
assert.ok(first?.valid, 'and shows its result');
remount();
assert.equal(started, 1, 'mounted again with nothing changed, no run starts');
assert.equal(state.evaluation.data, first, 'and the result it had is shown');
assert.equal(state.evaluation.busy, false);

// ── 2. A changed setting runs again ─────────────────────────────────────────
state.setField('passes', 3);
await finish();
assert.equal(started, 2, 'a changed setting runs again');
assert.notEqual(state.evaluation.data, first);

// ── 3. Stop holds across a remount, and a new request runs after it ─────────
holdRuns = true;
state.setField('passes', 4);
settle();
assert.equal(state.evaluation.busy, true, 'a run is in flight');
state.stop();
settle();
assert.equal(state.stopped, true);
const beforeRemount = started;
remount();
assert.equal(state.stopped, true, 'mounted again, the stopped run stays stopped');
assert.equal(started, beforeRemount, 'and does not start again');
holdRuns = false;
state.setField('passes', 5);
await finish();
assert.equal(state.stopped, false, 'a changed setting clears Stop');
assert.ok(started > beforeRemount && state.evaluation.data?.valid, 'and runs again');

R.unmount();
console.log('PASS: pulse_analysis_remount');
