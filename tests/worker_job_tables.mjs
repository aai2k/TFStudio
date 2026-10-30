/**
 * A run's material tables go to each worker once (utils/workers/jobTables.js).
 * At a fine Step one job's tables run to tens of megabytes, and every post that
 * carries them is copied on the posting thread, the window's in the app.
 *
 *   1. postJob leaves a job's tables out when its worker was last sent that
 *      tables object, and marks the job; the worker's holder gives that job
 *      the tables it holds. To another worker, with other tables, or after a
 *      job without tables, the tables go again. A marked job at a worker that
 *      holds none is refused.
 *   2. A DLS multi-start of 6 restarts on 2 threads sends the tables 3 times,
 *      to its two workers and its scoring worker, and ends where the same run
 *      ends with one worker per restart.
 *   3. On worker threads running the app's worker modules, no worker is sent
 *      the same tables twice: a Structural run ends where it ends on the
 *      calling thread, parallel DE on the serial DE design, and a Needle run
 *      where it ends with every job on the calling thread. An evaluation
 *      worker scores a second DE run with the tables it holds.
 *
 * Run: node tests/worker_job_tables.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { NodeModuleWorker } from './_moduleWorker.mjs';

shimBrowserGlobals();

const { postJob, makeTableHolder } = await import('../src/utils/workers/jobTables.js');
const { InThreadOptimizerWorker } = await import('../src/utils/workers/inThreadOptimizerWorker.js');
const { InThreadSynthesisPool } = await import('../src/utils/workers/inThreadSynthesisPool.js');
const { WorkerPool } = await import('../src/utils/workers/workerPool.js');
const { OPTIMIZER_WORKER_URL, MFEVAL_WORKER_URL, SYNTHESIS_WORKER_URL } = await import('../src/workerUrls.js');
const { runRefinement } = await import('../src/utils/refinement/runRefinement.js');
const { runStructural } = await import('../src/utils/structural/runStructural.js');
const { runNeedle } = await import('../src/utils/needle/runNeedle.js');
const { densifyForRun, presampleMaterials, buildPayload } = await import('../src/utils/refinement/workerInputs.js');
const { DLSOptimizer, makeOperand } = await import('../src/utils/physics/optimizer.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { getTmmWasmBytesForWorker } = await import('../src/tmmcore.js');

// The kernel bytes every pool is built with, as the window builds its pools.
const wasmInit = () => ({ type: 'wasmInit', wasmBytes: getTmmWasmBytesForWorker() });

// What one run's posts carried: `tables`, posts that brought tables; `held`,
// posts that named the tables their worker holds; `again`, posts that brought
// a worker a tables object it had been sent before.
let sent;
const seen = new WeakMap();
function note(worker, job) {
    if (job?.materialsHeld) sent.held++;
    if (!job?.materials) return;
    sent.tables++;
    const had = seen.get(worker) || new Set();
    if (had.has(job.materials)) sent.again++;
    seen.set(worker, had.add(job.materials));
}
class CountedInThreadWorker extends InThreadOptimizerWorker {
    postMessage(job) { note(this, job); super.postMessage(job); }
}
class CountedThread extends NodeModuleWorker {
    postMessage(job) { note(this, job); super.postMessage(job); }
}
globalThis.Worker = CountedThread;

const log = console.log;
async function counted(run) {
    sent = { tables: 0, held: 0, again: 0 };
    console.log = () => {};
    try { return { result: await run(), ...sent }; } finally { console.log = log; }
}

// ── 1. postJob and the worker's holder ─────────────────────────────────────
{
    const posted = [];
    const a = { postMessage: job => posted.push(job) }, b = { postMessage: job => posted.push(job) };
    const T = { TiO2: { lambdas: [500], n: [2.3], k: [0] } }, U = { ...T };
    for (const id of [1, 2, 3]) postJob(a, { id, materials: T });
    assert.deepEqual(posted.map(j => [j.id, j.materials === T, j.materialsHeld === true]),
        [[1, true, false], [2, false, true], [3, false, true]], 'the tables go with the first job only');
    const atA = makeTableHolder();
    assert.ok(posted.every(j => atA(j) === T), 'and every job reads them');
    posted.length = 0;
    postJob(b, { id: 4, materials: T });
    postJob(a, { id: 5, materials: U });
    postJob(a, { id: 6 });
    postJob(a, { id: 7, materials: U });
    postJob(a, { id: 8, materials: U });
    assert.deepEqual(posted.map(j => [j.id, !!j.materials]), [[4, true], [5, true], [6, false], [7, true], [8, false]],
        'another worker, other tables, and the tables after a job without them go again');
    assert.deepEqual(posted.slice(1).map(atA), [U, {}, U, U], 'the holder follows what its worker was sent');
    assert.throws(() => makeTableHolder()({ type: 'start', materialsHeld: true }), /never sent/,
        'a marked job at a worker that holds no tables is refused');
}

// ── 2. A DLS multi-start sends the tables once to each worker ──────────────
const AR = {
    id: 'ar4', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [25, 40, 110, 85].map((thickness, i) => ({ id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness, locked: false })),
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
};
const RAV = () => [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 })];
const inThread = () => new CountedInThreadWorker();
{
    const multi = threads => counted(() => runRefinement(AR, RAV(),
        { method: 'dls-multi', nRestarts: 6, maxIter: 30, seed: 5, threads }, { makeWorker: inThread }));
    const two = await multi(2), six = await multi(6);
    assert.deepEqual([two.tables, two.held, two.again], [3, 4, 0], 'on 2 threads the tables go to the 2 workers and the scoring worker');
    assert.deepEqual([six.tables, six.held], [7, 0], 'with a worker per restart, to each of them');
    assert.equal(two.result.completed, true);
    assert.deepEqual(two.result.frontLayers, six.result.frontLayers, 'both end on the same design');
    assert.equal(two.result.mf, six.result.mf, 'with the same merit');
}

// ── 3. On worker threads ───────────────────────────────────────────────────
const POOL = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
const BBAR = caseById('bbar').ops.map((op, i) => ({ ...op, id: `op${i}`, enabled: true }));
const twoLayers = () => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: [{ id: 'L0', material: 'TiO2', thickness: 30, locked: false }, { id: 'L1', material: 'SiO2', thickness: 50, locked: false }],
});
{
    const settings = { pool: POOL, maxIter: 5, refineIter: 10, threads: 2, seed: 99, targetMF: 0, T0: 0.3, addMaxNm: 200 };
    const structural = makeWorker => counted(() => runStructural(twoLayers(), BBAR, settings, { makeWorker }));
    const threads = await structural(() => new Worker(OPTIMIZER_WORKER_URL, { type: 'module' }));
    const here = await structural(inThread);
    assert.equal(threads.result.completed, true, `Structural on worker threads completes (${threads.result.stopReason})`);
    assert.ok(threads.held > 0 && threads.again === 0, `Structural: no worker is sent the same tables twice (${JSON.stringify({ ...threads, result: undefined })})`);
    assert.deepEqual(threads.result.frontLayers, here.result.frontLayers, 'and the run ends where it ends on the calling thread');
    assert.equal(threads.result.mf, here.result.mf);
}
{
    const settings = { method: 'de', maxIter: 12, seed: 21, threads: 3 };
    const serial = await runRefinement(AR, RAV(), settings, { makeWorker: inThread });
    const parallel = await counted(() => runRefinement(AR, RAV(), settings,
        { makeWorker: inThread, makeEvalPool: size => new WorkerPool(MFEVAL_WORKER_URL, size, wasmInit()) }));
    assert.deepEqual([parallel.tables, parallel.again], [4, 0], 'parallel DE sends the tables to its 3 evaluation workers and the scoring worker');
    assert.ok(parallel.held >= 3 * 11, `and every later generation names them (${parallel.held})`);
    assert.deepEqual(parallel.result.frontLayers, serial.frontLayers, 'parallel DE ends on the serial DE design');
    assert.equal(parallel.result.mf, serial.mf);

    // An evaluation worker builds its evaluator for each DE run (sid), and
    // builds it from the tables it holds when a job names them.
    const ops = densifyForRun(RAV(), AR), design = buildPayload(AR), materials = presampleMaterials(AR, ops);
    const vectors = [[30, 45, 100, 90]];
    const pool = new WorkerPool(MFEVAL_WORKER_URL, 1, wasmInit());
    const job = sid => ({ type: 'evalBatch', sid, operands: ops, design, materials, vectors });
    const mfs = [...await pool.map([job('a')]), ...await pool.map([job('b')])].map(r => r.mfs[0]);
    pool.terminate();
    const here = new DLSOptimizer(ops, design, designMaterialLookup(AR)).mfAt(vectors[0]);
    assert.deepEqual(mfs, [here, here], 'a second run on the same worker scores with the tables it holds');
}
{
    const seed = () => ({ ...twoLayers(), frontLayers: [{ id: 'S', material: 'SiO2', thickness: 100, locked: false }] });
    const settings = { pool: [...POOL, { id: 'MgF2', name: 'MgF2', mat: getMaterial('MgF2') }], maxLayers: 6, deltaNm: 0.5, dMin: 1, refineIter: 30, targetMF: 1e-4, threads: 3 };
    const needle = makeWorkerPool => counted(() => runNeedle(seed(), caseById('bbar').ops, settings, { makeWorkerPool }));
    const pooled = await needle(size => new WorkerPool(SYNTHESIS_WORKER_URL, size, wasmInit()));
    const here = await needle(size => new InThreadSynthesisPool(size));
    assert.ok(pooled.held > 0 && pooled.again === 0, `Needle: no worker is sent the same tables twice (${JSON.stringify({ ...pooled, result: undefined })})`);
    const stack = run => run.result.frontLayers.map(({ material, thickness }) => [material, thickness]);
    assert.deepEqual(stack(pooled), stack(here), 'and the run ends where it ends on the calling thread');
    assert.equal(pooled.result.mf, here.result.mf);
}

console.log('worker_job_tables: passed');
