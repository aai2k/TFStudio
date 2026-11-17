/**
 * Runs through the headless API on worker threads (src/api/runThreads.js).
 * On plain Node the API starts none, which this file checks there; it then
 * runs itself again on the app's own runtime, Electron's Node, where the API
 * starts them. There each run on threads is compared with the same call made
 * with process.versions.electron taken out, which keeps it on the calling
 * thread. Where Electron is not installed (the CI test job skips its
 * download) only the plain Node check runs.
 *
 *   1. On plain Node no run starts a thread.
 *   On Electron's Node:
 *   2. Each run gives on threads the answer it gives on the calling thread:
 *      Needle, Gradual Evolution, Structural and Deep Synthesis, and a refine
 *      by DLS multi-start, given threads and not, by Differential Evolution,
 *      and by a list of methods that holds it. Each starts threads of the
 *      kinds its window starts workers of, at least `threads` of them, and
 *      when the call answers every thread has ended on its own, between jobs,
 *      none terminated.
 *   3. Stop while threads compute jobs ends the run stopped with the design
 *      as it was, its threads ended between jobs, and no hook is called after
 *      the call has answered.
 *   4. A job posted to a thread that is still starting, and ended before it
 *      starts, is not run.
 *   5. No thread for a run of one thread, nor for a refine whose methods each
 *      use one worker, given threads or not.
 *   6. A thread that dies while it holds no job, or every thread dying as it
 *      starts, ends the run as a worker failure, and the call answers.
 *   7. A hook that throws ends the run as it does on the calling thread, with
 *      nothing thrown past the call.
 *
 * Run: node tests/api_run_threads.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import nodeThreads from 'node:worker_threads';
import { electronBinary } from './_electron.mjs';

const api = await import('../src/api/index.js');
const { runWorkers } = await import('../src/api/runThreads.js');
await api.init();

const quietly = async run => {
    const { log, warn, error } = console;
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    try { return await run(); } finally { Object.assign(console, { log, warn, error }); }
};

// Every thread started: its kind, whether it was terminated rather than ending
// on its own, its exit code once it has exited, and the jobs posted to it and
// answered by it. Threads of the kind `dying` names are ended as they start:
// the next one, or with `every` each one.
const RealThread = nodeThreads.Worker;
const NOT_AN_ANSWER = new Set(['tick', 'progress', 'init', 'warn']);
const NOT_A_JOB = new Set(['wasmInit', 'endThread']);
let started = [];
const dying = { kind: null, every: false };
class CountedThread extends RealThread {
    constructor(url, options) {
        super(url, options);
        const record = { kind: options?.workerData?.kind, terminated: false, died: false, exitCode: null, posted: 0, answered: 0 };
        started.push(record);
        this.record = record;
        this.once('exit', code => { record.exitCode = code; });
        this.on('message', message => { if (!NOT_AN_ANSWER.has(message?.type)) record.answered++; });
        const end = this.terminate.bind(this);
        this.terminate = () => { record.terminated = true; return end(); };
        if (dying.kind === record.kind) {
            if (!dying.every) dying.kind = null;
            record.died = true;
            end();
        }
    }
    postMessage(message) {
        if (!NOT_A_JOB.has(message?.type)) this.record.posted++;
        super.postMessage(message);
    }
}
nodeThreads.Worker = CountedThread;
syncBuiltinESMExports();

const AR = [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }];
const start = api.setMerit(api.stackFromFormula(api.newDesign({ name: 'AR' }), { formula: '(HL)^2' }), AR);
const POOL = ['TiO2', 'SiO2'];
const THREADS = 3;
const RUNS = {
    needle: { kinds: ['synthesis'], call: hooks => api.synthesize(start, { method: 'needle', pool: POOL, settings: { maxLayers: 8, threads: THREADS } }, hooks) },
    ge: { kinds: ['synthesis'], call: hooks => api.synthesize(start, { method: 'ge', pool: POOL, settings: { maxLayers: 8, maxGeCycles: 2, threads: THREADS } }, hooks) },
    structural: { kinds: ['optimizer'], call: hooks => api.synthesize(start, { method: 'structural', pool: POOL, settings: { maxIter: 4, refineIter: 5, seed: 7, threads: THREADS } }, hooks) },
    deep: { kinds: ['synthesis'], call: hooks => api.synthesize(start, { method: 'deep', pool: POOL, settings: { dMin: 20, maxLayers: 6, seed: 7, threads: THREADS, method: { search: { rounds: 2, children: 3 } } } }, hooks) },
    'dls-multi': { kinds: ['optimizer'], call: hooks => api.refine(start, { method: 'dls-multi', nRestarts: 6, seed: 3, threads: THREADS }, hooks) },
    'dls-multi given no threads': { kinds: ['optimizer'], call: hooks => api.refine(start, { method: 'dls-multi', nRestarts: 6, seed: 3 }, hooks) },
    de: { kinds: ['optimizer', 'merit'], call: hooks => api.refine(start, { method: 'de', maxIter: 30, seed: 3, threads: THREADS }, hooks) },
    'cg, then de': { kinds: ['optimizer', 'merit'], call: hooks => api.refine(start, { method: ['cg', 'de'], seed: 3, threads: THREADS }, hooks) },
};

// ── 1. Plain Node ───────────────────────────────────────────────────────────
if (!process.versions.electron) {
    for (const [name, { call }] of Object.entries(RUNS)) {
        started = [];
        await quietly(() => call());
        assert.equal(started.length, 0, `${name} on plain Node starts no thread`);
    }
    const electron = electronBinary();
    if (!electron) {
        console.log('PASS: api_run_threads (on plain Node; Electron is not installed, so the runs on threads were not checked)');
        process.exit(0);
    }
    const there = spawnSync(electron, [fileURLToPath(import.meta.url)], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 300000,
    });
    process.stdout.write(there.stdout ?? '');
    if (there.status !== 0) process.stderr.write(`${there.stderr ?? ''}\nthe checks on Electron's Node failed: ${there.error?.message ?? `exit ${there.status}`}\n`);
    process.exit(there.status === 0 ? 0 : 1);
}

// ── On Electron's Node ──────────────────────────────────────────────────────
// The call on threads, or with process.versions.electron taken out, on the
// calling thread.
const ELECTRON = Object.getOwnPropertyDescriptor(process.versions, 'electron');
async function onThreads(yes, call) {
    if (!yes) delete process.versions.electron;
    try { return await quietly(call); } finally { if (!yes) Object.defineProperty(process.versions, 'electron', ELECTRON); }
}
const layersOf = design => [design.frontLayers, design.backLayers].map(side => side.map(l => [l.material, l.thickness]));
const answerOf = ({ result, design }) => ({ stopReason: result.stopReason, mf: result.mf, layers: layersOf(design) });
const endedOnTheirOwn = () => started.filter(t => !t.died).every(t => t.exitCode === 0 && !t.terminated);
const describe = () => JSON.stringify(started);
function within(promise, ms) {
    let timer;
    const late = new Promise(resolve => { timer = setTimeout(() => resolve('no answer'), ms); });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// ── 2. The same answer on threads ───────────────────────────────────────────
for (const [name, { kinds, call }] of Object.entries(RUNS)) {
    started = [];
    const here = answerOf(await onThreads(false, () => call()));
    assert.equal(started.length, 0, `${name} with process.versions.electron taken out starts no thread`);
    const threaded = answerOf(await onThreads(true, () => call()));
    assert.deepStrictEqual(threaded, here, `${name} on threads gives the answer it gives on the calling thread`);
    assert.deepEqual([...new Set(started.map(t => t.kind))], kinds, `${name} starts threads of the kinds its window starts workers of`);
    assert.ok(started.length >= THREADS, `${name} starts a thread for each of its ${THREADS}: ${started.length}`);
    assert.ok(endedOnTheirOwn(), `every thread of ${name} has ended between jobs when the call answers: ${describe()}`);
}

// ── 3. Stop while threads compute ───────────────────────────────────────────
const STOPPED = {
    needle: hooks => api.synthesize(start, { method: 'needle', pool: POOL, settings: { maxLayers: 20, targetMF: 0, threads: THREADS } }, hooks),
    structural: hooks => api.synthesize(start, { method: 'structural', pool: POOL, settings: { maxIter: 40, seed: 7, threads: THREADS } }, hooks),
    'dls-multi': hooks => api.refine(start, { method: 'dls-multi', nRestarts: 30, seed: 3, threads: THREADS }, hooks),
};
for (const [name, call] of Object.entries(STOPPED)) {
    started = [];
    const stop = new AbortController();
    let answered = false, late = 0, inFlight = 0;
    const onProgress = () => {
        if (answered) { late++; return; }
        const computing = started.reduce((n, t) => n + t.posted - t.answered, 0);
        if (computing > 0 && !stop.signal.aborted) { inFlight = computing; stop.abort(); }
    };
    const stopped = await onThreads(true, () => call({ signal: stop.signal, onProgress }));
    answered = true;
    assert.ok(inFlight > 0, `${name} was stopped while its threads computed jobs`);
    assert.equal(stopped.result.stopReason, 'stopped', `${name} stopped ends stopped`);
    assert.equal(stopped.design, start, `${name} stopped answers with the design as it was`);
    assert.ok(endedOnTheirOwn(), `${name} stopped has its threads ended between jobs when the call answers: ${describe()}`);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(late, 0, `${name} calls no hook after the call has answered`);
}

// ── 4. A job that has not started when its thread is ended ──────────────────
{
    started = [];
    const workers = runWorkers(2);
    const pool = workers.makeWorkerPool(2);
    const job = pool.run({ type: 'noSuchJob' }).catch(err => err.message);
    pool.terminate();
    await workers.close();
    assert.equal(await job, 'pool terminated', 'the job is given up when its pool is ended');
    assert.deepEqual(started.map(t => [t.posted, t.answered]), [[0, 0], [1, 0]], 'and its thread, ended while starting, does not run it');
}

// ── 5. No thread for one ────────────────────────────────────────────────────
started = [];
await onThreads(true, () => api.synthesize(start, { method: 'needle', pool: POOL, settings: { maxLayers: 6, threads: 1 } }));
await onThreads(true, () => api.refine(start, { method: 'dls-multi', nRestarts: 3, seed: 3, threads: 1 }));
assert.equal(started.length, 0, 'a run of one thread starts none');
for (const method of ['dls', 'sqp', ['cg', 'dls']]) {
    const limit = Array.isArray(method) ? {} : { maxIter: 20 };
    await onThreads(true, () => api.refine(start, { method, ...limit, threads: THREADS }));
    await onThreads(true, () => api.refine(start, { method, ...limit }));
}
assert.equal(started.length, 0, 'nor a refine whose methods each use one worker, given threads or not');

// ── 6. Threads that die ─────────────────────────────────────────────────────
// The first synthesis thread holds no job when it dies: the first job, the
// scan, goes to the last thread the pool built.
for (const [every, what] of [[false, 'a thread that died while it held no job'], [true, 'threads that all died as they started']]) {
    started = [];
    Object.assign(dying, { kind: 'synthesis', every });
    const died = await within(onThreads(true, () => RUNS.needle.call()), 30000);
    Object.assign(dying, { kind: null, every: false });
    assert.notEqual(died, 'no answer', `a run with ${what} answers: ${describe()}`);
    assert.ok(['workerFailed', 'workerError'].includes(died.result.stopReason), `${what}: the run ends as a worker failure: ${died.result.stopReason}`);
    assert.equal(died.design, start, `${what}: with the design as it was`);
    assert.ok(started.every(t => t.exitCode !== null), `${what}: once its threads have ended: ${describe()}`);
}

// ── 7. A hook that throws ───────────────────────────────────────────────────
// The third report throws.
const throwing = () => {
    let calls = 0;
    return { onProgress: () => { if (++calls === 3) throw new Error('the hook threw'); } };
};
const outcomeOf = run => run.then(({ result }) => result.stopReason, error => `threw: ${error.message}`);
for (const name of ['needle', 'dls-multi']) {
    const uncaught = [];
    const caught = error => uncaught.push(error.message);
    process.on('uncaughtException', caught);
    const here = await onThreads(false, () => outcomeOf(RUNS[name].call(throwing())));
    started = [];
    const threaded = await onThreads(true, () => outcomeOf(RUNS[name].call(throwing())));
    await new Promise(resolve => setTimeout(resolve, 200));
    process.off('uncaughtException', caught);
    assert.deepEqual(uncaught, [], `${name}: a hook that throws on threads throws nothing past the call`);
    assert.equal(threaded, here, `${name}: a hook that throws ends the run on threads as on the calling thread`);
    assert.ok(endedOnTheirOwn(), `${name}: and its threads have ended when the call answers: ${describe()}`);
}

nodeThreads.Worker = RealThread;
syncBuiltinESMExports();
console.log('PASS: api_run_threads (on plain Node and on Electron\'s Node)');
