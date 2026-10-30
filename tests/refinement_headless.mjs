/**
 * A Refinement run without the window: runRefinement in plain Node, with each
 * optimizer job on the calling thread (InThreadOptimizerWorker), on a real
 * design and the real merit function.
 *
 *   1. Every method lowers the merit, and the merit a run reports is the merit
 *      of the layers it returns, evaluated again here. A one-method run stops
 *      at its maxIter.
 *   2. A seeded multi-start replays, and the run reports its seed at the start
 *      and in the result; each method of a list reports its start.
 *   3. Stop: a run aborted part-way resolves as stopped and records no row, as
 *      does one aborted from inside its own start or first progress; a run
 *      whose signal is already aborted does not start.
 *   4. A run that cannot start says why: no worker, an operand row that cannot
 *      be evaluated, no enabled row.
 *   5. Parallel DE over an MF-evaluation pool gives the serial DE result.
 *   6. An unknown method, setting or value is refused, as is a run with no
 *      worker factory.
 *
 * Run: node tests/refinement_headless.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { runRefinement } from '../src/utils/refinement/runRefinement.js';
import { densifyForRun } from '../src/utils/refinement/workerInputs.js';
import { InThreadOptimizerWorker } from '../src/utils/workers/inThreadOptimizerWorker.js';
import { makeResolveMat } from '../src/utils/workers/resolveMat.js';
import { DLSOptimizer, makeOperand } from '../src/utils/physics/optimizer.js';
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
const OPS = () => [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 })];
const makeWorker = () => new InThreadOptimizerWorker();

// The merit of `layers` on the design, evaluated on the calling thread with the
// operands on the grid the run used.
function meritOf(result) {
    const design = { ...DESIGN, frontLayers: result.frontLayers, backLayers: result.backLayers };
    const ops = densifyForRun(OPS(), DESIGN);
    return new DLSOptimizer(ops, design, designMaterialLookup(DESIGN)).mf;
}

const FINISHED = new Set(['target', 'maxiter', 'stalled', 'restartsDone']);

// ── 1. Every method refines, and reports the merit of what it returns ───────
const RUNS = [
    ['dls', { method: 'dls', maxIter: 60 }],
    ['sqp', { method: 'sqp', maxIter: 40 }],
    ['cg', { method: 'cg', maxIter: 60 }],
    ['newton', { method: 'newton', maxIter: 40 }],
    ['newton-cg', { method: 'newton-cg', maxIter: 40 }],
    ['sa', { method: 'sa', maxIter: 60, seed: 3 }],
    ['de, serial without an MF-evaluation pool', { method: 'de', maxIter: 15, seed: 3 }],
    ['dls-multi', { method: 'dls-multi', maxIter: 40, nRestarts: 3, seed: 5, threads: 2 }],
    ['a list', { method: ['dls', 'cg'] }],
];
for (const [name, settings] of RUNS) {
    const rows = [];
    let progress = 0;
    const result = await runRefinement(DESIGN, OPS(), settings, {
        makeWorker, onRecord: row => rows.push(row), onProgress: () => { progress++; },
    });
    assert.equal(result.completed, true, `${name}: the run completes`);
    assert.ok(FINISHED.has(result.stopReason) || result.stopReason.startsWith('best:'), `${name}: it ends for a reason (${result.stopReason})`);
    assert.ok(result.mf <= result.mfInitial, `${name}: the merit does not rise (${result.mfInitial} → ${result.mf})`);
    assert.equal(result.frontLayers.length, DESIGN.frontLayers.length, `${name}: the layer count stays`);
    const again = meritOf(result);
    assert.ok(Math.abs(again - result.mf) <= 1e-9 * Math.max(1, again),
        `${name}: the reported merit is the merit of the returned layers (${result.mf} vs ${again})`);
    assert.ok(progress > 0, `${name}: progress is reported`);
    assert.equal(rows.length, Array.isArray(settings.method) ? settings.method.length : 1, `${name}: one row per method`);
}
{
    // Left to run until it stalls, DLS takes this start well below half its
    // merit; at a cap of 60 iterations it is still on its way down.
    const result = await runRefinement(DESIGN, OPS(), { method: 'dls', maxIter: 2000 }, { makeWorker });
    assert.equal(result.stopReason, 'stalled', `DLS runs until it stalls (${result.stopReason} at iteration ${result.iter})`);
    assert.ok(result.mf < 0.5 * result.mfInitial, `DLS refines the start well below its merit (${result.mfInitial} → ${result.mf})`);
}
for (const method of ['dls', 'cg', 'sqp', 'newton']) {
    const result = await runRefinement(DESIGN, OPS(), { method, maxIter: 7 }, { makeWorker });
    assert.equal(result.iter, 7, `${method}: maxIter 7 stops the run at iteration 7`);
    assert.equal(result.stopReason, 'maxiter', `${method}: and says the cap stopped it`);
}

// ── 2. Seeds and starts are reported ────────────────────────────────────────
{
    const starts = [];
    const run = () => runRefinement(DESIGN, OPS(), { method: 'dls-multi', maxIter: 30, nRestarts: 3, seed: 11 },
        { makeWorker, onStart: ({ seed }) => starts.push(seed) });
    const [a, b] = [await run(), await run()];
    assert.deepEqual(a.frontLayers, b.frontLayers, 'the same seed gives the same multi-start result');
    assert.equal(a.seed, 11, 'the result names the seed it ran');
    assert.deepEqual(starts, [11, 11], 'and the start reports it');
    let drawnAtStart = null;
    const drawn = await runRefinement(DESIGN, OPS(), { method: 'dls-multi', maxIter: 10, nRestarts: 2 },
        { makeWorker, onStart: ({ seed }) => { drawnAtStart = seed; } });
    assert.ok(Number.isInteger(drawn.seed) && drawn.seed >= 1, 'a run without a seed draws one and names it');
    assert.equal(drawnAtStart, drawn.seed, 'the start reports the seed the run drew');

    const methodStarts = run => runRefinement(DESIGN, OPS(), run, { makeWorker, onMethodStart: (m, i) => calls.push([m, i]) });
    let calls = [];
    await methodStarts({ method: ['dls', 'cg'] });
    assert.deepEqual(calls, [['dls', 0], ['cg', 1]], 'each method of a list reports its start');
    calls = [];
    await methodStarts({ method: 'dls', maxIter: 5 });
    assert.deepEqual(calls, [['dls', 0]], 'a DLS pool run reports one start');
}

// ── 3. Stop ─────────────────────────────────────────────────────────────────
{
    const controller = new AbortController();
    const rows = [];
    const result = await runRefinement(DESIGN, OPS(), { method: ['cg', 'dls'] }, {
        makeWorker, signal: controller.signal,
        onRecord: row => rows.push(row),
        onProgress: patch => { if (patch.iter > 0) controller.abort(); },
    });
    assert.equal(result.completed, false, 'an aborted run does not complete');
    assert.equal(result.stopReason, 'stopped', 'and says it was stopped');
    assert.equal(rows.length, 0, 'the method cut short records no row');

    let started = false;
    const early = await runRefinement(DESIGN, OPS(), { method: 'dls' }, {
        makeWorker, signal: AbortSignal.abort(), onStart: () => { started = true; },
    });
    assert.equal(early.stopReason, 'stopped', 'a run whose signal is already aborted does not start');
    assert.equal(started, false, 'and never reports a start');

    // Aborted from inside its own hooks, before any worker has a job.
    for (const [method, hook] of [['dls', 'onStart'], ['dls-multi', 'onMethodStart'], ['dls', 'onProgress'], ['cg', 'onStart']]) {
        const inside = new AbortController();
        const built = [];
        const result = await runRefinement(DESIGN, OPS(), { method, nRestarts: 2, seed: 1 }, {
            makeWorker: () => { const w = new InThreadOptimizerWorker(); built.push(w); return w; },
            signal: inside.signal, [hook]: () => inside.abort(),
        });
        assert.equal(result.stopReason, 'stopped', `${method} aborted in ${hook}: the run settles as stopped`);
        assert.ok(built.every(w => w.terminated), `${method} aborted in ${hook}: no worker is left running`);
    }
}

// ── 4. A run that cannot start says why ─────────────────────────────────────
{
    const noWorker = () => { throw new Error('no workers here'); };
    let started = false;
    const failed = await runRefinement(DESIGN, OPS(), { method: 'dls' }, { makeWorker: noWorker, onStart: () => { started = true; } });
    assert.equal(failed.stopReason, 'workerFailed', 'no worker: workerFailed');
    assert.equal(failed.frontLayers, null, 'and no design');
    assert.equal(started, false, 'and the run never reports a start');
    for (const method of ['sqp', ['cg', 'sa'], 'all']) {
        const rows = [];
        const flow = await runRefinement(DESIGN, OPS(), { method }, { makeWorker: noWorker, onRecord: row => rows.push(row) });
        assert.equal(flow.completed, false, `${method}: a run whose workers cannot be built does not complete`);
        assert.equal(flow.stopReason, 'workerFailed', `${method}: and says the worker failed`);
        assert.equal(rows.length, 0, `${method}: and records no row`);
    }

    const broken = [...OPS(), makeOperand({ type: 'OPGT', refA: 'missing', lambdaStart: 500, lambdaEnd: 600, target: 1, weight: 1 })];
    const refused = await runRefinement(DESIGN, broken, { method: 'dls' }, { makeWorker });
    assert.equal(refused.stopReason, 'invalidOperand', 'a row that cannot be evaluated refuses the run');
    assert.match(refused.message, /^Row 2 OPGT: /, 'and names the row');

    const off = OPS().map(op => ({ ...op, enabled: false }));
    const empty = await runRefinement(DESIGN, off, { method: 'dls' }, { makeWorker });
    assert.equal(empty.stopReason, 'noOperands', 'no enabled row: noOperands');
    assert.deepEqual([empty.frontLayers, empty.mf, empty.seed], [null, null, null], 'a run that never started has nulls for its result');
}

// ── 5. Parallel DE gives the serial DE result ───────────────────────────────
// An MF-evaluation pool on this thread, built as mfEvalWorker.js builds its
// evaluator: one DLSOptimizer over the pre-sampled materials of the run.
{
    const evalPool = () => {
        let evaluator = null;
        return {
            map: async jobs => jobs.map(job => {
                evaluator ??= new DLSOptimizer(job.operands, job.design, makeResolveMat(job.materials, 'test'));
                return { mfs: job.vectors.map(v => evaluator.mfAt(v)), omfs: job.vectors.map(v => evaluator.mfOpticalAt(v)) };
            }),
            terminate() {},
        };
    };
    const settings = { method: 'de', maxIter: 12, seed: 21, threads: 3 };
    const serial = await runRefinement(DESIGN, OPS(), settings, { makeWorker });
    let pools = 0;
    const parallel = await runRefinement(DESIGN, OPS(), settings, { makeWorker, makeEvalPool: () => { pools++; return evalPool(); } });
    assert.equal(pools, 1, 'four free layers take the evaluation pool');
    assert.deepEqual(parallel.frontLayers, serial.frontLayers, 'parallel DE lands on the serial DE design');
    assert.equal(parallel.mf, serial.mf, 'with the same merit');
    assert.equal(parallel.omf, serial.omf, 'and the same optical merit');

    const dying = () => ({ map: async () => { throw new Error('an evaluation worker failed'); }, terminate() {} });
    const fellBack = await runRefinement(DESIGN, OPS(), settings, { makeWorker, makeEvalPool: dying });
    assert.equal(fellBack.completed, true, 'a DE whose evaluation pool fails still completes');
    assert.deepEqual(fellBack.frontLayers, serial.frontLayers, 'on the serial DE design');
}

// ── 6. Settings are checked ─────────────────────────────────────────────────
const refusedSettings = [
    ['an unknown method', { method: 'simplex' }],
    ['an unknown method in a list', { method: ['cg', 'simplex'] }],
    ['all inside a list', { method: ['all'] }],
    ['a method twice', { method: ['cg', 'cg'] }],
    ['an empty list', { method: [] }],
    ['an unknown setting', { method: 'dls', maxIterations: 10 }],
    ['maxIter on a list', { method: 'all', maxIter: 10 }],
    ['maxIter 0', { method: 'dls', maxIter: 0 }],
    ['a fractional restart count', { method: 'dls-multi', nRestarts: 2.5 }],
    ['a negative perturbation', { method: 'dls-multi', perturbPct: -5 }],
    ['zero threads', { method: 'dls', threads: 0 }],
    ['seed 0', { method: 'sa', seed: 0 }],
    ['a fractional seed', { method: 'sa', seed: 3.7 }],
    ['a seed given as text', { method: 'sa', seed: '42' }],
];
for (const [name, settings] of refusedSettings) {
    await assert.rejects(runRefinement(DESIGN, OPS(), settings, { makeWorker }), /Refinement settings/, `${name} is refused`);
}
await assert.rejects(runRefinement(DESIGN, OPS(), { method: 'dls' }, {}), /makeWorker/, 'a run without a worker factory is refused');

console.log('refinement_headless: passed');
