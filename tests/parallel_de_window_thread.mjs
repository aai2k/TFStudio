/**
 * A parallel Differential Evolution run keeps its merit evaluations on its
 * evaluation pool (utils/refinement/deEngine.js, workers/mfEvalWorker.js): the
 * run's thread draws the starting population and each generation's trials,
 * and the pool scores them, the merit and the optical merit of each.
 *
 *   1. On worker threads running the app's worker modules, the run's thread
 *      reads no material from the run's start to its end, and the run ends on
 *      the serial DE design.
 *   2. With a pool on this thread, the seeded run's first batch is the serial
 *      DE's starting population, scored with the serial DE's merits; the run
 *      ends on the serial DE design, merit and optical merit; every merit and
 *      optical merit it shows belongs to the design it shows with them.
 *   3. Stop while the pool scores the starting population ends the run
 *      stopped, with the pool and every worker ended, no best offered and no
 *      history row. A pool that fails on the starting population, or part-way,
 *      or answers no optical merits, leaves the run to the serial DE, which
 *      ends on the same design.
 *
 * Run: node tests/parallel_de_window_thread.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { NodeModuleWorker } from './_moduleWorker.mjs';

shimBrowserGlobals();
globalThis.Worker = NodeModuleWorker;

const { MFEVAL_WORKER_URL } = await import('../src/workerUrls.js');
const { WorkerPool } = await import('../src/utils/workers/workerPool.js');
const { InThreadOptimizerWorker } = await import('../src/utils/workers/inThreadOptimizerWorker.js');
const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');
const { runRefinement } = await import('../src/utils/refinement/runRefinement.js');
const { densifyForRun, buildPayload } = await import('../src/utils/refinement/workerInputs.js');
const { DEOptimizer } = await import('../src/utils/optimizers/index.js');
const { DLSOptimizer, makeOperand } = await import('../src/utils/physics/optimizer.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { getMaterialById } = await import('../src/utils/materials/catalogManager.js');
const { getTmmWasmBytesForWorker } = await import('../src/tmmcore.js');

const DESIGN = {
    id: 'ar6', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: [25, 40, 110, 85, 30, 70].map((thickness, i) => ({ id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness, locked: false })),
};
// An MNT row of 120 nm over layers 1 to 6, above the thin ones, so the merit
// and the optical merit differ.
const OPS = () => [
    makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    makeOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 6, target: 120, weight: 0.1 }),
];
const SETTINGS = { method: 'de', maxIter: 12, seed: 21, threads: 3 };
const makeWorker = () => new InThreadOptimizerWorker();
const quiet = run => async (...args) => {
    const { log, error } = console;
    console.log = () => {}; console.error = () => {};
    try { return await run(...args); } finally { Object.assign(console, { log, error }); }
};

const serial = await quiet(runRefinement)(DESIGN, OPS(), SETTINGS, { makeWorker });
assert.equal(serial.completed, true, 'the serial DE run completes');

// ── 1. Nothing read on the run's thread ─────────────────────────────────────
// Every object of the design's materials on this thread counts the wavelengths
// it is read at while `counting` is on.
const reads = [];
let counting = false;
const watched = new Map();
function watch(mat) {
    if (!mat || watched.has(mat)) return;
    const getNK = mat.getNK;
    watched.set(mat, getNK);
    mat.getNK = function (lambda) {
        if (counting) reads.push(lambda);
        return getNK.call(this, lambda);
    };
}
for (const id of ['TiO2', 'SiO2', 'BK7', 'Air']) { watch(getMaterial(id)); watch(getMaterialById(id)); }
{
    let result;
    try {
        result = await quiet(runRefinement)(DESIGN, OPS(), SETTINGS, {
            makeWorker,
            makeEvalPool: size => new WorkerPool(MFEVAL_WORKER_URL, size, { type: 'wasmInit', wasmBytes: getTmmWasmBytesForWorker() }),
            onStart: () => { counting = true; },
        });
    } finally {
        counting = false;
        for (const [mat, getNK] of watched) mat.getNK = getNK;
    }
    assert.equal(result.completed, true, `the run on worker threads completes (${result.stopReason})`);
    assert.equal(reads.length, 0, `its own thread reads no material (${reads.length} reads, first at ${reads.slice(0, 5).join(', ')} nm)`);
    assert.deepEqual(result.frontLayers, serial.frontLayers, 'and it ends on the serial DE design');
    assert.equal(result.mf, serial.mf, 'with the serial DE merit');
    assert.equal(result.omf, serial.omf, 'and optical merit');
}

// ── 2. The serial DE's population, best and end ─────────────────────────────
// A pool on this thread, built as mfEvalWorker.js builds its evaluator, that
// keeps the vectors of every batch and what it answered.
function recordingPool(batches) {
    let evaluator = null;
    return {
        map: async jobs => {
            const answers = jobs.map(job => {
                evaluator ??= new DLSOptimizer(job.operands, job.design, makeResolveMat(job.materials, 'test'));
                return {
                    mfs: job.vectors.map(v => evaluator.mfAt(v)),
                    omfs: job.vectors.map(v => evaluator.mfOpticalAt(v)),
                };
            });
            batches.push({
                vectors: jobs.flatMap(job => job.vectors),
                mfs: answers.flatMap(a => a.mfs),
            });
            return answers;
        },
        terminate() {},
    };
}
{
    const ops = densifyForRun(OPS().filter(op => op.enabled), DESIGN);
    const payload = buildPayload(DESIGN);
    const lookup = designMaterialLookup(DESIGN);
    const own = new DEOptimizer(ops, payload, lookup, { maxIter: SETTINGS.maxIter, seed: SETTINGS.seed });
    const batches = [], patches = [];
    const result = await quiet(runRefinement)(DESIGN, OPS(), SETTINGS, {
        makeWorker, makeEvalPool: () => recordingPool(batches), onProgress: patch => patches.push(patch),
    });
    assert.equal(result.completed, true, 'the run with a pool on this thread completes');
    assert.deepEqual(batches[0].vectors, own.pop, 'its first batch is the serial DE\'s starting population');
    assert.ok(batches[0].mfs.every((mf, p) => Object.is(mf, own.popMF[p])), 'scored with the serial DE\'s merits, bit for bit');
    assert.deepEqual(result.frontLayers, serial.frontLayers, 'the run ends on the serial DE design');
    assert.equal(result.mf, serial.mf, 'with its merit');
    assert.equal(result.omf, serial.omf, 'and its optical merit');

    // Each merit shown with a design, and the optical merit with it, are that
    // design's own.
    const scoreOf = frontLayers => {
        const at = new DLSOptimizer(ops, { ...payload, frontLayers }, lookup);
        return { mf: at.mf, omf: at.mfOpticalAt(at.thicknesses) };
    };
    let shown = 0, apart = 0;
    patches.forEach((patch, i) => {
        const before = patches[i - 1];
        if (!before?.design || !('omf' in patch)) return;
        const own = scoreOf(before.design.frontLayers);
        assert.deepEqual([patch.mf, patch.omf], [own.mf, own.omf], `progress ${i}: the merit and optical merit shown are the design's own`);
        shown++;
        if (patch.mf !== patch.omf) apart++;
    });
    assert.ok(shown > 0 && apart > 0, `the run shows its best with its merits, some held apart by the MNT row (${apart} of ${shown})`);
}

// ── 3. Stop and failures ────────────────────────────────────────────────────
{
    const stop = new AbortController();
    const pool = { batches: 0, ended: false, reject: null };
    pool.map = () => {
        pool.batches++;
        setTimeout(() => stop.abort(), 0);
        return new Promise((_, reject) => { pool.reject = reject; });
    };
    pool.terminate = () => { pool.ended = true; pool.reject?.(new Error('pool terminated')); };
    const built = [], rows = [], bests = [];
    let timer;
    const hang = new Promise(resolve => { timer = setTimeout(() => resolve({ stopReason: 'hung' }), 20000); });
    const result = await Promise.race([quiet(runRefinement)(DESIGN, OPS(), SETTINGS, {
        signal: stop.signal,
        makeWorker: () => { const w = new InThreadOptimizerWorker(); built.push(w); return w; },
        makeEvalPool: () => pool,
        onRecord: row => rows.push(row),
        onProgress: patch => { if (patch.best) bests.push(patch.best); },
    }), hang]);
    clearTimeout(timer);
    assert.equal(result.stopReason, 'stopped', `Stop while the pool scores the starting population ends the run stopped (${result.stopReason})`);
    assert.equal(pool.batches, 1, 'the pool was sent the starting population only');
    assert.ok(pool.ended, 'the pool is ended');
    assert.ok(built.every(w => w.terminated), 'and every worker');
    assert.deepEqual([bests.length, rows.length], [0, 0], 'no best is offered and no row recorded');
    assert.deepEqual(result.frontLayers, buildPayload(DESIGN).frontLayers, 'the run hands back the start');
    assert.equal(result.mf, result.mfInitial, 'with the start\'s merit');
}
for (const failAt of [1, 3]) {
    let batches = 0;
    const onThread = recordingPool([]);
    const failing = () => ({
        map: jobs => (++batches === failAt ? Promise.reject(new Error('an evaluation worker failed')) : onThread.map(jobs)),
        terminate() {},
    });
    const result = await quiet(runRefinement)(DESIGN, OPS(), SETTINGS, { makeWorker, makeEvalPool: failing });
    const when = failAt === 1 ? 'on the starting population' : 'part-way';
    assert.equal(result.completed, true, `a pool that fails ${when} leaves a run that completes`);
    assert.deepEqual(result.frontLayers, serial.frontLayers, `on the serial DE design (pool failed ${when})`);
    assert.equal(result.omf, serial.omf, `with its optical merit (pool failed ${when})`);
}
{
    // A pool that answers merits without optical merits counts as failed.
    const onThread = recordingPool([]);
    const meritsOnly = () => ({ map: async jobs => (await onThread.map(jobs)).map(({ mfs }) => ({ mfs })), terminate() {} });
    const result = await quiet(runRefinement)(DESIGN, OPS(), SETTINGS, { makeWorker, makeEvalPool: meritsOnly });
    assert.deepEqual([result.completed, result.frontLayers, result.mf, result.omf], [true, serial.frontLayers, serial.mf, serial.omf],
        'a pool that answers no optical merits leaves the run to the serial DE');
}

console.log('parallel_de_window_thread: passed');
process.exit(0);
