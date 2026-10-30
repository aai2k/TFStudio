/**
 * A Structural refine has no time limit: it ends when its worker answers, when
 * the worker fails, or on Stop.
 *
 *   1. A refine that takes minutes answers and its run gets its rows, the same
 *      rows as when it answers at once, with no worker replaced.
 *   2. A starting refine that fails, as a job or with its worker, ends the run
 *      with the status that says so; through the API the run ends
 *      'refineFailed' with the error, also when its worker is a thread that
 *      exits.
 *   3. A worker that fails mid-run is replaced, so the jobs its slot takes
 *      afterwards are answered and the run ends on its own. When no
 *      replacement can be built, the jobs sent to the slot fail at once and the
 *      run still ends on its own. An answer the run cannot read ends its refine
 *      as a failed worker does.
 *   4. Stop during a long refine ends the run, with every worker ended, and the
 *      run pressed after it ends on its own.
 *
 * Timers of a second or more wait on a clock the test moves, so a refine of
 * minutes takes no time.
 *
 * Run: node tests/structural_refine_end.mjs
 */
import './_kernel.mjs';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

const LONG_MS = 1000;
const held = [];
let clock = 0;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {
    if (!(ms >= LONG_MS)) return realSetTimeout(fn, ms, ...args);
    const timer = { fn: () => fn(...args), at: clock + ms, done: false };
    held.push(timer);
    return timer;
};
globalThis.clearTimeout = handle => {
    if (held.includes(handle)) handle.done = true;
    else realClearTimeout(handle);
};

const { startWindowRun } = await import('../src/components/windows/optimization/structuralOptimizer/windowRun.js');
const { runStructural } = await import('../src/utils/structural/runStructural.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { InThreadOptimizerWorker } = await import('../src/utils/workers/inThreadOptimizerWorker.js');
const { NodeModuleWorker } = await import('./_moduleWorker.mjs');
const { makeWindow, useWindow, withWindowSettings } = await import('./_structuralWindow.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const tick = () => new Promise(r => realSetTimeout(r, 0));
const ticks = async n => { for (let i = 0; i < n; i++) await tick(); };

// Moves the clock on by `ms`, running each held timer that falls due on the
// way, in order.
async function advance(ms) {
    const until = clock + ms;
    for (;;) {
        const due = held.filter(timer => !timer.done && timer.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        clock = due.at;
        due.done = true;
        due.fn();
        await ticks(50);
    }
    clock = until;
}

// Waits until the run has ended, or two seconds have passed: a run stuck on a
// job nobody answers never ends.
async function settle(win) {
    const end = performance.now() + 2000;
    while (win.ctx.runningRef.current && performance.now() < end) await tick();
    await ticks(20);
}
const untilJob = async (win, n) => {
    for (let i = 0; i < 500 && win.jobCount < n; i++) await tick();
    await ticks(20);
};

const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
const DESIGN = {
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [layer('F1', 'TiO2', 90), layer('F2', 'SiO2', 110)], backLayers: [],
    surfaceMode: 'front_only', mfEvalMode: 'side',
};
const OPS = [{ id: 'op', type: 'RAV', enabled: true, lambdaStart: 500, lambdaEnd: 600, lambdaStep: 20, aoi: 0, pol: 'avg', target: 0.5, weight: 1 }];
const SPEC = {
    design: DESIGN, ops: OPS,
    cfg: { maxIter: 3, targetMF: 0, T0: 0.08, jitterPct: 0.15, refineIter: 5, dMin: 1, addMaxNm: 120, maxLayers: 20, kinds: ['perturb'], deepMode: false, deepMaxMin: 0, seed: 7 },
    normalMf: [0.6, 0.5],
};
const NEEDLES = { ...SPEC, cfg: { ...SPEC.cfg, kinds: ['add', 'perturb'] }, poolIds: ['TiO2', 'SiO2'] };

const rowsOf = win => win.ctx.gensRef.current.map(row => [row.kind, row.mf, row.layers.map(l => [l.material, l.thickness])]);

// A run through the API on `makeWorker`'s workers, `maxIter` iterations on one
// thread, with its console silenced. A run still going after ten seconds ends
// 'hung'.
async function apiRun(makeWorker, maxIter) {
    const pool = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
    const settings = { pool, maxIter, threads: 1, seed: 1, smartSeed: false, kinds: ['perturb'], refineIter: 5 };
    const quiet = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = () => {};
    try {
        return await Promise.race([
            runStructural(structuredClone(DESIGN), structuredClone(OPS), settings, { makeWorker }),
            new Promise(resolve => realSetTimeout(() => resolve({ stopReason: 'hung' }), 10000)),
        ]);
    } finally { Object.assign(console, quiet); }
}

// One Run press on a fresh window `id` over `spec`, with `pressed` for what the
// workers do. `during(win)` runs once the press has started, `storage` holds
// the window settings, and `makeWorker` builds the run's workers.
async function press(spec, id, pressed, { during = null, storage = {}, makeWorker = null } = {}) {
    const win = makeWindow(spec, id);
    if (makeWorker) win.ctx.makeWorker = makeWorker;
    useWindow(win);
    return withWindowSettings(storage, async () => {
        win.press = pressed;
        startWindowRun(win.ctx);
        if (during) await during(win);
        await settle(win);
        return {
            win, running: win.ctx.runningRef.current, status: win.statuses.at(-1), rows: rowsOf(win),
            built: win.workers, ended: win.terminated,
        };
    });
}
const sameRows = (a, b) => JSON.stringify(a.rows) === JSON.stringify(b.rows);

// The run every check compares with: each refine answered at once.
const atOnce = await press(SPEC, 'refine-at-once', {});

// ── 1. A refine that takes minutes ──────────────────────────────────────────
{
    const slowStart = await press(SPEC, 'slow-start', { slowAtJob: 1, slowMs: 60000 },
        { during: async win => { await untilJob(win, 1); await advance(60000); } });
    ok('a starting refine that takes a minute answers and the run gets its rows',
        !slowStart.running && slowStart.status === 'max-iterations' && slowStart.rows.length > 0,
        `${slowStart.status}, ${slowStart.rows.length} rows`);
    ok('the same rows as when it answers at once', sameRows(slowStart, atOnce));
    ok('with no worker replaced', slowStart.built === 1 && slowStart.ended === 1, `${slowStart.built} built, ${slowStart.ended} ended`);

    const slowProposal = await press(SPEC, 'slow-proposal', { slowAtJob: 2, slowMs: 600000 },
        { during: async win => { await untilJob(win, 2); await advance(600000); } });
    ok('a proposal refine that takes ten minutes is kept: the same rows as when it answers at once',
        slowProposal.status === 'max-iterations' && sameRows(slowProposal, atOnce),
        `${slowProposal.status}, ${slowProposal.rows.length} rows against ${atOnce.rows.length}`);
    ok('and its worker is not replaced', slowProposal.built === 1, `${slowProposal.built} built`);
}

// ── 2. A starting refine that fails ─────────────────────────────────────────
{
    const failed = await press(SPEC, 'start-fails', { failAtJob: 1 });
    ok('a starting refine that fails ends the run saying so', !failed.running && failed.status === 'refine-failed'
        && failed.rows.length === 0, `${failed.status}, ${failed.rows.length} rows`);
    const crashed = await press(SPEC, 'start-crashes', { dieAtJob: 1 });
    ok('so does one whose worker fails', !crashed.running && crashed.status === 'refine-failed', crashed.status);
    ok('its worker is replaced, and every worker is ended', crashed.built === 2 && crashed.ended === 2,
        `${crashed.built} built, ${crashed.ended} ended`);

    const failingWorker = () => ({
        onmessage: null, onerror: null,
        postMessage(job) {
            if (job?.type !== 'start') return;
            realSetTimeout(() => this.onmessage?.({ data: { type: 'error', message: 'RangeError: Array buffer allocation failed' } }), 0);
        },
        terminate() {},
    });
    const failedApi = await apiRun(failingWorker, 2);
    ok('through the API the run ends refineFailed with the error',
        failedApi.stopReason === 'refineFailed' && /allocation failed/.test(failedApi.message || ''), JSON.stringify(failedApi));
    ok('and with no design', failedApi.frontLayers === null && failedApi.mf === null);

    // A worker thread that exits as its first refine starts.
    const EXITS = 'data:text/javascript,' + encodeURIComponent(
        "globalThis.onmessage = e => { if (e.data && e.data.type === 'start') process.exit(3); };");
    const threads = [];
    const exiting = () => { const worker = new NodeModuleWorker(EXITS); threads.push(worker); return worker; };
    const exited = await apiRun(exiting, 2);
    ok('a worker thread that exits ends its refine, and the run ends refineFailed',
        exited.stopReason === 'refineFailed' && /exited with code 3/.test(exited.message || ''), `${exited.stopReason}: ${exited.message}`);
    ok('the thread is replaced, and both are ended', threads.length === 2 && threads.every(worker => worker.ended), `${threads.length} built`);
}

// ── 3. A worker that fails mid-run ──────────────────────────────────────────
{
    // The refine its worker dropped is lost as one that failed as a job; the
    // replacement answers the rest.
    const jobFailed = await press(SPEC, 'job-fails-mid-run', { failAtJob: 3 });
    const replaced = await press(SPEC, 'crash-mid-run', { dieAtJob: 3 });
    ok('a worker that fails mid-run is replaced and the run ends on its own',
        !replaced.running && replaced.status === 'max-iterations', replaced.status);
    ok('the replacement answers the later refines', sameRows(replaced, jobFailed),
        `${replaced.rows.length} rows against ${jobFailed.rows.length}`);
    ok('every worker built is ended', replaced.built === 2 && replaced.ended === 2, `${replaced.built} built, ${replaced.ended} ended`);

    // A worker that fails while it holds no job.
    const idle = await press(SPEC, 'crash-idle', { dieAfterJob: 1 });
    ok('a worker that fails between jobs is replaced before the next, and nothing is lost',
        !idle.running && idle.status === 'max-iterations' && sameRows(idle, atOnce), `${idle.status}, ${idle.rows.length} rows`);
    ok('every worker of that run is ended', idle.built === 2 && idle.ended === 2, `${idle.built} built, ${idle.ended} ended`);

    // On two threads, the second worker fails before its first job, as one
    // whose script does not load: it waits through the starting refine.
    const twoThreads = await press(SPEC, 'two-threads', {}, { storage: { threads: '2' } });
    let builds = 0;
    const neverLoads = await press(SPEC, 'never-loads', {}, {
        storage: { threads: '2' },
        makeWorker: () => {
            const worker = new globalThis.Worker();
            if (++builds === 2) setTimeout(() => worker.crash(), 0);
            return worker;
        },
    });
    ok('a worker that fails before its first job is replaced, and nothing is lost',
        neverLoads.status === 'max-iterations' && sameRows(neverLoads, twoThreads) && neverLoads.built === 3,
        `${neverLoads.status}, ${neverLoads.rows.length} rows against ${twoThreads.rows.length}, ${neverLoads.built} built`);

    // The first worker builds; its replacement cannot.
    builds = 0;
    const unbuilt = await press(NEEDLES, 'crash-unbuilt', { dieAtJob: 2 }, {
        makeWorker: () => {
            if (++builds > 1) throw new Error('no workers');
            return new globalThis.Worker();
        },
    });
    ok('a worker that cannot be replaced leaves the run going to its own end, needle jobs and all',
        builds === 2 && !unbuilt.running && unbuilt.status === 'max-iterations', `${builds} builds, ${unbuilt.status}`);

    // An answer the run cannot read: the worker reports a message error. The
    // refine is lost as one that failed as a job; the replacement answers the
    // rest.
    const atStart = (n, lose) => () => {
        const worker = new InThreadOptimizerWorker();
        const post = worker.postMessage.bind(worker);
        worker.postMessage = job => {
            if (job?.type === 'start' && ++n.starts === 2) { realSetTimeout(() => lose(worker), 0); return; }
            post(job);
        };
        n.built++;
        return worker;
    };
    const asJob = { starts: 0, built: 0 }, garbling = { starts: 0, built: 0 };
    const lostAsJob = await apiRun(atStart(asJob, worker => worker.onmessage?.({ data: { type: 'error', message: 'lost' } })), 3);
    const garbled = await apiRun(atStart(garbling, worker => worker.onmessageerror?.({})), 3);
    ok('an answer the run cannot read ends its refine, and the run ends on its own',
        garbled.stopReason === 'maxIter' && garbling.built === 2, `${garbled.stopReason}, ${garbling.built} built`);
    ok('the replacement answers the later refines', lostAsJob.stopReason === 'maxIter'
        && JSON.stringify([garbled.mf, garbled.frontLayers]) === JSON.stringify([lostAsJob.mf, lostAsJob.frontLayers]),
    `${garbled.mf} against ${lostAsJob.mf}`);
}

// ── 4. Stop during a long refine ────────────────────────────────────────────
{
    const win = makeWindow(SPEC, 'stop-long-refine');
    useWindow(win);
    const seen = await withWindowSettings({}, async () => {
        win.press = { slowAtJob: 2, slowMs: 600000 };
        startWindowRun(win.ctx);
        await untilJob(win, 2);
        await advance(50000);
        const runningBeforeStop = win.ctx.runningRef.current;
        win.ctx.stopOpt();
        await settle(win);
        const stopped = { runningBeforeStop, running: win.ctx.runningRef.current, status: win.statuses.at(-1), built: win.workers, ended: win.terminated };
        win.press = {};
        startWindowRun(win.ctx);
        await settle(win);
        return { ...stopped, next: win.statuses.at(-1), nextRunning: win.ctx.runningRef.current };
    });
    ok('a refine still under way after fifty seconds holds its run', seen.runningBeforeStop);
    ok('Stop ends the run', !seen.running && seen.status === 'stopped', seen.status);
    ok('and every worker of it', seen.built === 1 && seen.ended === 1, `${seen.built} built, ${seen.ended} ended`);
    ok('the run pressed after it ends on its own', !seen.nextRunning && seen.next === 'max-iterations', seen.next);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
