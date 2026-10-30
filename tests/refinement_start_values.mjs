/**
 * A Refinement run's start values come from its workers, never from a merit
 * evaluation on the calling thread (utils/refinement/dlsPool.js,
 * methodsFlow.js, engineRun.js, workers/optimizerJob.js). At a fine Step one
 * evaluation of a large design takes seconds, and the Refinement window would
 * hold for it at every Run. DE here runs serially in one worker; the parallel
 * DE the window uses on machines with more than two threads is tested in
 * parallel_de_window_thread.mjs.
 *
 *   1. Stub workers report sentinel start values. A single DLS run and a flow
 *      whose first method starts from the design as it is show the start its
 *      job reports in 'init'. A DLS multi-start, a list that opens with a
 *      multi-start step, SQP and DE show the start of the 'score' job they
 *      send, and never a restart's or their own job's 'init'. The result
 *      carries the same values, and no merit is evaluated on the calling
 *      thread from the run's start to its end.
 *   2. A list compares its methods with that start: methods that end above it
 *      leave the start as the result and the run ends 'stalled'.
 *   3. A run whose first worker fails before reporting a start ends
 *      'workerFailed', shows no start values and stops every worker it built.
 *   4. On the real worker, on a design that sits below an MNT row's bound,
 *      the 'score' job and the 'init' of every method a flow takes its start
 *      from report the merit and optical merit the calling thread computes
 *      for the design as posted. SQP's 'init' does not: it moves its start
 *      into the MNT/MXT box first.
 *
 * Run: node tests/refinement_start_values.mjs
 */
import assert from 'node:assert/strict';
import { runRefinement } from '../src/utils/refinement/runRefinement.js';
import { ALL_ORDER } from '../src/utils/refinement/methods.js';
import { densifyForRun, presampleMaterials, buildPayload } from '../src/utils/refinement/workerInputs.js';
import { handleOptimizerMessage } from '../src/utils/workers/optimizerJob.js';
import { DLSOptimizer, LSQEngine, makeOperand } from '../src/utils/physics/optimizer.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';

const DESIGN = {
    id: 'ar4', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'L1', material: 'TiO2', thickness: 25, locked: false },
        { id: 'L2', material: 'SiO2', thickness: 40, locked: false },
        { id: 'L3', material: 'TiO2', thickness: 110, locked: false },
        { id: 'L4', material: 'SiO2', thickness: 85, locked: false },
    ],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
};
const RAV = () => makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 });

// Sentinel start values: a method job's 'init' on the design as posted, a
// 'score' job's answer, and a multi-start restart's 'init' on its perturbed
// design.
const POSTED = { mf: 0.4242, omf: 0.4141 };
const SCORED = { mf: 0.3131, omf: 0.3030 };
const RESTART = { mf: 9.5, omf: 9.4 };

// Every merit evaluation an LSQEngine makes, the DLS optimizer's and the one
// inside every other engine, builds its context through _ctxFor.
let counting = false, evaluations = 0;
const ctxFor = LSQEngine.prototype._ctxFor;
LSQEngine.prototype._ctxFor = function (thk) {
    if (counting) evaluations++;
    return ctxFor.call(this, thk);
};

// A stand-in for the optimizer worker: the sentinel start values, then one
// progress step and the end at `StubWorker.resultMf`, on the layers it got.
class StubWorker {
    static jobs = [];
    static built = [];
    static failBeforeStart = false;
    static resultMf = 0.01;

    constructor() { this.onmessage = null; this.onerror = null; this.terminated = false; StubWorker.built.push(this); }

    postMessage(job) {
        if (job?.type !== 'start' && job?.type !== 'score') return;
        StubWorker.jobs.push(job);
        setTimeout(() => this.answer(job), 0);
    }

    answer(job) {
        if (StubWorker.failBeforeStart) { this.post({ type: 'error', message: 'the job threw' }); return; }
        if (job.type === 'score') { this.post({ type: 'score', ...SCORED }); return; }
        const start = job.restartIdx ? RESTART : POSTED;
        this.post({ type: 'init', mfInitial: start.mf, mfBest: start.mf, omfInitial: start.omf, omfBest: start.omf });
        const mf = StubWorker.resultMf;
        const layers = { frontLayers: job.design.frontLayers, backLayers: job.design.backLayers,
            bestFrontLayers: job.design.frontLayers, bestBackLayers: job.design.backLayers };
        this.post({ type: 'progress', iter: 3, mf, mfBest: mf, omf: mf, omfBest: mf, ...layers });
        this.post({ type: 'done', iter: 6, mf, mfBest: mf, omf: mf, omfBest: mf, reason: 'stalled', ...layers });
    }

    post(data) { if (!this.terminated && this.onmessage) this.onmessage({ data }); }

    terminate() { this.terminated = true; }
}

// One run on stub workers: its result, the last value each readout key was
// given, the jobs it posted and the calling-thread evaluations it made.
async function stubRun(settings, { failBeforeStart = false, resultMf = 0.01 } = {}) {
    Object.assign(StubWorker, { jobs: [], built: [], failBeforeStart, resultMf });
    const patches = [];
    evaluations = 0;
    const log = console.log, error = console.error;
    console.log = () => {}; console.error = () => {};
    try {
        const result = await runRefinement(DESIGN, [RAV()], settings, {
            makeWorker: () => new StubWorker(),
            onStart: () => { counting = true; },
            onProgress: patch => patches.push(patch),
        });
        const shown = key => patches.filter(p => key in p).map(p => p[key]).pop();
        return { result, patches, shown, evaluations, jobs: StubWorker.jobs, built: StubWorker.built };
    } finally {
        counting = false;
        console.log = log; console.error = error;
    }
}

// ── 0. A flow stopped before its start is scored reports no merit ───────────
{
    const stop = new AbortController();
    Object.assign(StubWorker, { jobs: [], built: [], failBeforeStart: false, resultMf: 0.01 });
    const log = console.log;
    console.log = () => {};
    const result = await runRefinement(DESIGN, [RAV()], { method: 'sqp' }, {
        makeWorker: () => new StubWorker(), signal: stop.signal, onStart: () => stop.abort(),
    });
    console.log = log;
    assert.equal(result.stopReason, 'stopped');
    assert.equal(result.mf, null, 'no merit is reported for a run stopped before its start was scored');
    assert.equal(result.mfInitial, null);
}

// ── 1. The start values come from the workers ──────────────────────────────
const CASES = [
    ['a single DLS run', { method: 'dls' }, POSTED],
    ['a DLS multi-start', { method: 'dls-multi', nRestarts: 3, seed: 4, threads: 2 }, SCORED],
    ['a list opening with CG', { method: ['cg', 'sa'], seed: 4 }, POSTED],
    ['Newton', { method: 'newton' }, POSTED],
    ['SQP', { method: 'sqp' }, SCORED],
    ['DE', { method: 'de', seed: 4 }, SCORED],
    ['a list opening with a multi-start step', { method: ['dls-multi', 'cg'], nRestarts: 2, seed: 4 }, SCORED],
];
for (const [name, settings, start] of CASES) {
    const run = await stubRun(settings);
    assert.equal(run.result.completed, true, `${name}: the run completes`);
    assert.deepEqual([run.shown('mfInitial'), run.shown('omfInitial')], [start.mf, start.omf],
        `${name}: the readout shows the start its workers report`);
    assert.deepEqual([run.result.mfInitial, run.result.omfInitial], [start.mf, start.omf], `${name}: and so does the result`);
    assert.equal(run.jobs.some(job => job.type === 'score'), start === SCORED, `${name}: a scoring job only when the first method reports no start`);
    assert.equal(run.evaluations, 0, `${name}: no merit is evaluated on the calling thread (${run.evaluations})`);
}
{
    const run = await stubRun({ method: 'dls' });
    const startPatch = run.patches.find(p => 'mfInitial' in p);
    assert.deepEqual([startPatch.mf, startPatch.mfBest, startPatch.omf, startPatch.omfBest], [POSTED.mf, POSTED.mf, POSTED.omf, POSTED.omf],
        'a single DLS run starts its MF and Best at the start');
}

// ── 2. A list compares its methods with that start ─────────────────────────
for (const [method, start] of [[['cg', 'sa'], POSTED], [['sqp', 'cg'], SCORED]]) {
    const run = await stubRun({ method, seed: 4 }, { resultMf: start.mf + 0.01 });
    assert.equal(run.result.stopReason, 'stalled', `${method}: no method beats the start (${run.result.stopReason})`);
    assert.equal(run.result.mf, start.mf, `${method}: the start stays the result`);
    assert.deepEqual(run.result.frontLayers, buildPayload(DESIGN).frontLayers, `${method}: with its layers`);
}

// ── 3. A first worker that fails before reporting a start ──────────────────
for (const method of ['dls', 'dls-multi', ['cg'], 'sqp']) {
    const run = await stubRun({ method, nRestarts: 3, seed: 4 }, { failBeforeStart: true });
    assert.equal(run.result.stopReason, 'workerFailed', `${method}: the run ends workerFailed`);
    assert.deepEqual([run.result.mfInitial, run.result.omfInitial], [null, null], `${method}: with no start values`);
    assert.ok(run.patches.every(p => p.mfInitial == null && p.omfInitial == null), `${method}: and shows none`);
    assert.ok(run.built.every(w => w.terminated), `${method}: every worker it built is stopped`);
}

// ── 4. The real worker's start values ──────────────────────────────────────
// Layer 1 sits below the MNT row's 30 nm, so SQP moves it before 'init'.
const ops = densifyForRun([RAV(), makeOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 4, target: 30, weight: 1 })], DESIGN);
const payload = buildPayload(DESIGN);
const materials = presampleMaterials(DESIGN, ops);
const here = new DLSOptimizer(ops, payload, designMaterialLookup(DESIGN));
const calling = { mf: here.mf, omf: here.mfOpticalAt(here.thicknesses) };

async function workerMessage(job, type) {
    let found = null;
    await handleOptimizerMessage({ ...job, operands: ops, design: payload, materials }, (m) => { if (m.type === type && !found) found = m; });
    return found;
}
const initOf = method => workerMessage({ type: 'start', method, opts: { maxIter: 1 }, engineOpts: { seed: 4 } }, 'init');

const scored = await workerMessage({ type: 'score' }, 'score');
assert.deepEqual([scored.mf, scored.omf], [calling.mf, calling.omf], 'the score job reports what the calling thread computes');

// The methods whose run sends no scoring job take their start from their own
// 'init', so that 'init' must describe the design as posted.
const fromInit = [];
for (const method of ALL_ORDER) {
    const run = await stubRun({ method: [method, method === 'cg' ? 'dls' : 'cg'], seed: 4, nRestarts: 2 });
    if (!run.jobs.some(job => job.type === 'score')) fromInit.push(method);
}
assert.deepEqual(fromInit, ['cg', 'dls', 'newton', 'newton-cg', 'sa'], 'the methods a flow takes its start from');
for (const method of fromInit) {
    const init = await initOf(method);
    assert.deepEqual([init.mfInitial, init.omfInitial], [calling.mf, calling.omf], `${method}: 'init' reports the design as posted`);
}
const sqp = await initOf('sqp');
assert.notEqual(sqp.mfInitial, calling.mf, 'SQP reports its start after moving it into the MNT box');

console.log('refinement_start_values: passed');
