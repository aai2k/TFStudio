/**
 * Refinement run guard: a before/after identity check for a Refinement run as
 * the window sees it, utils/refinement/runRefinement.js (the DLS worker pool,
 * the method flow and the promise engines) started and shown by the window's
 * windowRun.js.
 *
 * This is the RUN path (worker orchestration + run-state aggregation), which the
 * UI render-hash harness does NOT execute. This guard drives each run end-to-end
 * against a fake Refinement `ctx`, snapshots its observable output (the design
 * it applies, MF / best / iter, end reason, and the history rows it records),
 * and compares that to a committed golden.
 *
 * Determinism:
 *  - Math.random is seeded, so a run whose seed field is empty draws the same
 *    seed, and so the same multi-start perturbations, every time.
 *  - The run consumes WORKER messages. A deterministic mock `Worker` emits a
 *    scripted progress→done stream keyed by the restart index, so the run's
 *    aggregation (global-best selection, cumulative iter, history, finalize) is
 *    exercised identically for the golden and the current run. The mock stands
 *    in for the worker's physics: this guard checks the RUN logic, not the
 *    optimizer kernel (that is optimizer_refactor_guard's job).
 *
 * Random ids (history-entry ids) are excluded from the snapshot.
 *
 *   Update baseline (after a verified intentional change):  node tests/refinement_runner_guard.mjs --update
 *   Run the guard:                                          node tests/refinement_runner_guard.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeOperand } from '../src/utils/physics/optimizer.js';
import { perturbPayload, restartRng } from '../src/utils/refinement/restarts.js';
import EN from '../src/constants/locales/en.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, 'refinement_runner_guard.golden.json');
const UPDATE = process.argv.includes('--update');

// ── Seeded RNG (mulberry32) installed over Math.random for reproducibility ────
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// Async-aware: keeps the seeded RNG installed for the ENTIRE run, including the
// setTimeout-driven perturbation that fires after the run starts.
async function withSeed(fn) {
    const orig = Math.random;
    Math.random = mulberry32(0x1234abcd);
    try { return await fn(); } finally { Math.random = orig; }
}

// How a mock job fails before any progress, by MockWorker.errorOnStart.
const MOCK_FAILURES = {
    message: w => w._post({ type: 'error', message: 'the job threw' }),
    event:   w => w.onerror?.({ message: 'the worker script did not load' }),
};

// ── Deterministic mock Worker: scripted progress→done keyed by restart index ──
// mf is a fixed function of the restart index so a specific restart is the clear
// global best; layer thicknesses are a fixed function of the restart index so the
// applied design is reproducible. Both `progress` and `done` are emitted.
class MockWorker {
    constructor(url) {
        if (MockWorker.failConstruct) throw new Error('module workers are blocked');
        this.url = url; this.onmessage = null; this.onerror = null; this.terminated = false;
        MockWorker.built.push(this);
    }
    postMessage(job) {
        if (this.terminated) return;
        if (job?.type === 'start') MockWorker.startJobs.push(job);
        setTimeout(() => { if (!this.terminated) this._run(job); }, 0);
    }
    terminate() { this.terminated = true; }
    _run(job) {
        // Parallel-DE path (mfEvalWorker via WorkerPool): score each trial vector
        // with a fixed quadratic bowl so DEOptimizer has a deterministic landscape.
        if (job.type === 'evalBatch') {
            const mfs = (job.vectors || []).map(v => v.reduce((a, x) => a + (x - 100) * (x - 100), 0) * 1e-6);
            this._post({ type: 'done', mfs });
            return;
        }
        if (job.type !== 'start') return;              // ignore init / unknown
        const fail = MOCK_FAILURES[MockWorker.errorOnStart];
        if (fail) { fail(this); return; }
        const r = job.restartIdx || 0;                 // 0 = unperturbed baseline
        const mf = 0.05 * (1 / (1 + ((r * 7) % 5)));    // r===2 → global best (0.01)
        const front = (job.design.frontLayers || []).map((l, i) => ({ ...l, thickness: (l.thickness || 0) + r + i }));
        const back  = (job.design.backLayers  || []).map((l, i) => ({ ...l, thickness: (l.thickness || 0) + r + i }));
        const hangs = job.method && job.method === MockWorker.hangOn;
        const shown = hangs && MockWorker.hangMf != null ? MockWorker.hangMf : mf * 1.1;
        this._post({ type: 'progress', iter: 5, mf: shown, mfBest: shown, omf: shown, omfBest: shown,
            frontLayers: front, backLayers: back, bestFrontLayers: front, bestBackLayers: back });
        // Stands in for a method still working when the user presses Stop: it
        // reports progress and then goes quiet, so the flow is genuinely waiting
        // on a worker message that will never arrive.
        if (hangs) {
            const notify = MockWorker.onHang; MockWorker.onHang = null;
            notify && notify();
            return;
        }
        this._post({ type: 'done', iter: 10, mf, mfBest: mf, omf: mf, omfBest: mf,
            frontLayers: front, backLayers: back, bestFrontLayers: front, bestBackLayers: back, reason: 'stalled' });
    }
    _post(data) { if (!this.terminated && this.onmessage) this.onmessage({ data }); }
}
MockWorker.hangOn = null;    // method name to stall after its progress message
MockWorker.hangMf = null;    // the merit that stalled method reports, when set
MockWorker.onHang = null;    // called once when that method stalls
MockWorker.startJobs = [];   // every 'start' job posted, in order
MockWorker.failConstruct = false;   // new Worker() throws
MockWorker.errorOnStart = null;     // a job fails before any progress: by 'message' or by error 'event'
MockWorker.built = [];              // every worker constructed, in order
globalThis.Worker = MockWorker;

// Pin the detected core count. Pool sizes and the serial-vs-parallel DE branch
// (windowRun.js: more than two hardware threads) key off
// navigator.hardwareConcurrency, so without this the golden would only match on
// a machine with the same core count. Pinned high enough to take the parallel-DE
// path, exactly as this guard pins Math.random.
Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 8 }, configurable: true, writable: true,
});

// Import the run AFTER installing the mock Worker global.
const { startWindowRun } = await import('../src/components/windows/optimization/refinement/windowRun.js');

const ref = v => ({ current: v });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Build a fake Refinement ctx + a snapshot recorder. `method` is the window's
// method, or a list of methods tried one by one.
function makeCtx(design, ops, { method = 'dls', nRestarts = 1, perturbPct = 30, maxIter = 40, seed = null } = {}) {
    const snap = { applied: null, mf: null, mfBest: null, mfInitial: null, iter: 0, stopReason: null, history: [], mfHistory: [], seed: null };
    const ctx = {
        runningRef: ref(false), designRef: ref(design), operandsRef: ref(ops),
        methodRef: ref(method), maxIterRef: ref(maxIter), nRestartsRef: ref(nRestarts),
        perturbPctRef: ref(perturbPct), checkpointRef: ref(() => {}),
        optimizerRef: ref(null), baselineRef: ref(false), lastBestRef: ref(null),
        abortRef: ref(null), activeRunRef: ref(null), histRunCount: ref(0), seedRef: ref(seed),
        commitBaseline: () => {},
        bumpRunCount: () => { ctx.histRunCount.current += 1; },
        addHistEntry: (e) => { snap.history.push({ label: e.label, iter: e.iter, mf: e.mf, layerCount: e.layerCount, layerSide: e.layerSide ?? null, mfHistory: e.mfHistory, seed: e.seed }); },
        setSeed: v => { snap.seed = v; ctx.seedRef.current = v; },
        // Mirrors stopRun in useRefinement.js: the run's own abort stops its workers.
        stopOpt: () => { ctx.runningRef.current = false; ctx.abortRef.current?.abort(); ctx.abortRef.current = null; },
        updateDesignRef: ref((patch) => {
            const d = ctx.designRef.current;
            ctx.designRef.current = { ...d, ...patch };
            snap.applied = {
                front: (ctx.designRef.current.frontLayers || []).map(l => l.thickness),
                back:  (ctx.designRef.current.backLayers  || []).map(l => l.thickness),
            };
        }),
        setMf: v => snap.mf = v, setMfBest: v => snap.mfBest = v, setMfInitial: v => snap.mfInitial = v,
        setOmf: () => {}, setOmfBest: () => {}, setOmfInitial: () => {},
        setIter: v => snap.iter = v,
        setMfHistory: v => { snap.mfHistory = typeof v === 'function' ? v(snap.mfHistory) : v; },
        setRunning: () => {}, setCanReset: () => {}, setRestartIdx: () => {},
        setStopReason: v => snap.stopReason = v,
        t: { refinement: { ...EN.refinement, history: { run: (n) => `Run ${n}` } } },
    };
    return { ctx, snap };
}

async function waitIdle(ctx, ms = 8000) {
    const t0 = Date.now();
    while (ctx.runningRef.current) {
        if (Date.now() - t0 > ms) throw new Error('the run did not finish in time');
        await sleep(3);
    }
    await sleep(5);   // let any trailing scheduled callbacks settle
}

const runOnce = async (ctx) => { await startWindowRun(ctx); await waitIdle(ctx); };

// Rounded snapshot (kills last-bit FP noise in the values real optimizer code
// computes: the baseline merit and the parallel DE run).
const rnd = x => (x == null ? x : Number(x.toFixed(9)));
function finalize(snap) {
    return {
        applied: snap.applied && { front: snap.applied.front.map(rnd), back: snap.applied.back.map(rnd) },
        mf: rnd(snap.mf), mfBest: rnd(snap.mfBest), mfInitial: rnd(snap.mfInitial),
        iter: snap.iter, stopReason: snap.stopReason,
        history: snap.history.map(hh => ({ label: hh.label, iter: hh.iter, mf: rnd(hh.mf), layerCount: hh.layerCount, layerSide: hh.layerSide })),
    };
}

// ── Designs / operands ────────────────────────────────────────────────────────
const frontDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'L1', material: 'TiO2', thickness: 110, locked: false },
        { id: 'L2', material: 'SiO2', thickness: 90,  locked: false },
        { id: 'L3', material: 'TiO2', thickness: 65,  locked: false },
    ],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});
const backDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [],
    backLayers: [
        { id: 'B1', material: 'TiO2', thickness: 105, locked: false },
        { id: 'B2', material: 'SiO2', thickness: 95,  locked: false },
    ],
    surfaceMode: 'back_only', mfEvalMode: 'side',
});
const bothDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [{ id: 'F1', material: 'TiO2', thickness: 100, locked: false }, { id: 'F2', material: 'SiO2', thickness: 120, locked: false }],
    backLayers:  [{ id: 'K1', material: 'TiO2', thickness: 80,  locked: false }, { id: 'K2', material: 'SiO2', thickness: 95,  locked: false }],
    surfaceMode: 'both_independent', mfEvalMode: 'side',
});
const OPS = () => [
    makeOperand({ type: 'RAV', lambdaStart: 480, lambdaEnd: 520, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    makeOperand({ type: 'TAV', lambdaStart: 600, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
];

// ── Scenarios ─────────────────────────────────────────────────────────────────
// Each: the design and the window settings. 'dls' and 'dls-multi' run on the
// DLS worker pool; a list runs on the method flow.
const SCENARIO_RUNS = {
    'dlsPool/single/front':    { design: frontDesign, opts: { method: 'dls' } },
    'dlsPool/multi/front':     { design: frontDesign, opts: { method: 'dls-multi', nRestarts: 5 } },
    'dlsPool/multi/back':      { design: backDesign,  opts: { method: 'dls-multi', nRestarts: 5 } },
    'methodsFlow/cg/front':    { design: frontDesign, opts: { method: ['cg'] } },
    'methodsFlow/multi/front': { design: frontDesign, opts: { method: ['cg', 'sa', 'dls-multi'], nRestarts: 4 } },
    'methodsFlow/cg/both':     { design: bothDesign,  opts: { method: ['cg', 'sa'] } },
    'methodsFlow/de/both':     { design: bothDesign,  opts: { method: ['de'] } },
};
const SCENARIOS = Object.keys(SCENARIO_RUNS);

async function runScenario(name) {
    const { design, opts } = SCENARIO_RUNS[name];
    const { ctx, snap } = makeCtx(design(), OPS(), opts);
    await withSeed(() => runOnce(ctx));
    return finalize(snap);
}

async function verifyIterationHistories() {
    {
        const { ctx, snap } = makeCtx(frontDesign(), OPS());
        await withSeed(() => runOnce(ctx));
        assert.equal(snap.iter, 10, 'DLS displays the done message iteration');
        assert.deepEqual(snap.mfHistory.map(p => p.iter), [5, 10], 'DLS retains its final plot sample');
        assert.deepEqual(snap.history[0].mfHistory.map(p => p.iter), [5, 10], 'DLS stores its plot in Design History');
    }
    {
        const { ctx, snap } = makeCtx(frontDesign(), OPS(), { method: ['cg', 'sa'] });
        await withSeed(() => runOnce(ctx));
        assert.equal(snap.iter, 20, 'Try All displays cumulative optimizer iterations');
        assert.deepEqual(snap.mfHistory.map(p => p.iter), [0, 5, 10, 15, 20], 'Try All plots actual cumulative iterations');
        assert.deepEqual(snap.history.map(e => e.mfHistory.map(p => p.iter)), [[0, 5, 10], [0, 5, 10]],
            'Try All stores an independent plot for every method');
    }
}

// Stop part-way through a multi-method run, while 'sa' is in flight with the
// merit `hangMf` reported. The flow must unwind instead of waiting forever on a
// terminated worker, Best must hold the best result so far, the stopped method
// leaves no history row, and the design stays where the user stopped it.
async function stopDuringRun(hangMf) {
    const { ctx, snap } = makeCtx(frontDesign(), OPS(), { method: ['cg', 'sa'] });
    MockWorker.built = [];
    MockWorker.hangOn = 'sa';
    MockWorker.hangMf = hangMf;
    const stalled = new Promise(resolve => { MockWorker.onHang = resolve; });
    const flow = withSeed(() => startWindowRun(ctx));
    await stalled;

    const appliedAtStop = snap.applied;
    ctx.stopOpt();
    await Promise.race([
        flow,
        sleep(4000).then(() => { throw new Error('the method flow never settled after Stop'); }),
    ]);
    MockWorker.hangOn = null;
    MockWorker.hangMf = null;

    assert.equal(ctx.runningRef.current, false, 'Stop ends the run');
    assert.ok(MockWorker.built.every(w => w.terminated), 'Stop leaves no worker running');
    assert.ok(ctx.lastBestRef.current, 'Best is armed');
    assert.ok(Array.isArray(ctx.lastBestRef.current.frontLayers) && ctx.lastBestRef.current.frontLayers.length,
        'Best carries a design, not just a merit value');
    assert.equal(snap.history.length, 1, 'only the method that finished is recorded');
    assert.deepEqual(snap.applied, appliedAtStop,
        'a stopped run does not rewrite the design on the way out');
    return { ctx, snap };
}

async function verifyStopDuringRun() {
    // The stopped method is behind the finished one: Best holds what the readout showed.
    {
        const { ctx, snap } = await stopDuringRun(null);
        assert.equal(rnd(ctx.lastBestRef.current.mfBest), rnd(snap.mfBest),
            'Best holds the merit the readout was showing when Stop was pressed');
    }
    // The stopped method is ahead of the finished one: what it found still reaches Best.
    {
        const { ctx } = await stopDuringRun(0.02);
        assert.equal(rnd(ctx.lastBestRef.current.mfBest), 0.02,
            'a method cut short by Stop still hands its best to Best');
    }
}

// A design switch stops the run (useDesignCacheSync), and nothing the stopped
// run still reports while it unwinds lands on the design switched to: not its
// best, not its readout, not a history row.
async function verifyDesignSwitch() {
    const { ctx, snap } = makeCtx({ ...frontDesign(), id: 'A' }, OPS(), { method: ['cg', 'sa'] });
    MockWorker.hangOn = 'sa';
    MockWorker.hangMf = 0.02;
    const stalled = new Promise(resolve => { MockWorker.onHang = resolve; });
    const flow = withSeed(() => startWindowRun(ctx));
    await stalled;

    ctx.designRef.current = { ...backDesign(), id: 'B' };
    ctx.stopOpt();
    const calls = [];
    for (const name of ['setMf', 'setMfBest', 'setOmfBest', 'setIter', 'setMfHistory', 'setStopReason', 'addHistEntry']) {
        ctx[name] = () => calls.push(name);
    }
    const bestAtSwitch = ctx.lastBestRef.current;
    await flow;
    MockWorker.hangOn = null;
    MockWorker.hangMf = null;

    assert.deepEqual(calls, [], 'the stopped run reports nothing onto the design switched to');
    assert.equal(ctx.lastBestRef.current, bestAtSwitch, 'and leaves Best alone');
    assert.equal(snap.applied.front.length, 3, 'and writes no layers onto it');
}

// A run that throws ends instead of leaving the window running.
async function verifyRunThatThrows() {
    const { ctx } = makeCtx(frontDesign(), OPS());
    ctx.setCanReset = () => { throw new Error('a setter failed'); };
    MockWorker.built = [];
    await startWindowRun(ctx);
    assert.equal(ctx.runningRef.current, false, 'a run that throws ends');
    assert.ok(MockWorker.built.every(w => w.terminated), 'and stops its workers');
}

// A stochastic run draws from one seed: the one in the seed field, or a fresh
// one the field then shows. The same seed replays the run; the Design History
// row keeps it. Math.random is left unseeded here, so anything still drawing
// from it shows up as a run that does not replay.
async function verifySeededRuns() {
    const payload = { surfaceMode: 'front_only', frontLayers: frontDesign().frontLayers, backLayers: [] };
    const thicknesses = seed => perturbPayload(payload, 30, 3, restartRng(seed, 3)).frontLayers.map(l => l.thickness);
    assert.deepEqual(thicknesses(77), thicknesses(77), 'a multi-start restart perturbs the same way from the same seed');
    assert.notDeepEqual(thicknesses(77), thicknesses(78), 'and differently from another seed');

    const deRun = async (seed) => {
        const { ctx, snap } = makeCtx(bothDesign(), OPS(), { method: ['de'], seed });
        await runOnce(ctx);
        return snap;
    };
    const a = await deRun(4242), b = await deRun(4242);
    assert.deepEqual(a.applied, b.applied, 'parallel DE with the same seed applies the same design');
    assert.equal(a.history[0].seed, 4242, 'the DE history row keeps its seed');

    const fresh = await deRun(null);
    assert.ok(Number.isInteger(fresh.seed) && fresh.seed >= 1, `an empty seed field draws a seed and shows it (${fresh.seed})`);
    assert.equal(fresh.history[0].seed, fresh.seed, 'and the row keeps the seed the run drew');

    MockWorker.startJobs = [];
    const { ctx } = makeCtx(frontDesign(), OPS(), { method: ['sa', 'cg'], seed: 99 });
    await runOnce(ctx);
    const [saJob, cgJob] = MockWorker.startJobs;
    assert.equal(saJob.engineOpts?.seed, 99, 'the SA worker job carries the run seed');
    assert.equal(cgJob.engineOpts?.halfWaveProbe, true, 'Refinement CG takes the half-wave first probe');
}

const WORKER_FAILURES = [
    ['cannot be built',                () => { MockWorker.failConstruct = true; }],
    ['reports an error before progress', () => { MockWorker.errorOnStart = 'message'; }],
    ['fires an error event before progress', () => { MockWorker.errorOnStart = 'event'; }],
];

// One DLS run with the failure `arm` installs, then the failure cleared again.
async function runFailing(ctx, arm) {
    MockWorker.built = [];
    arm();
    try { await withSeed(() => runOnce(ctx)); }
    finally { MockWorker.failConstruct = false; MockWorker.errorOnStart = null; }
}

const DLS_RUNS = [
    { name: 'single', opts: { method: 'dls', seed: 7 }, nextReason: 'stalled' },
    { name: 'multi-start', opts: { method: 'dls-multi', nRestarts: 4, seed: 7 }, nextReason: null },
];

// A worker that cannot be built, or fails before its first progress message,
// ends the run with the design as it was and the badge says why. The next run
// that works replaces the badge.
async function verifyWorkerFailures() {
    for (const [what, arm] of WORKER_FAILURES) {
        for (const { name, opts, nextReason } of DLS_RUNS) {
            const { ctx, snap } = makeCtx(frontDesign(), OPS(), opts);
            await runFailing(ctx, arm);
            const run = `a ${name} DLS run whose worker ${what}`;
            assert.equal(ctx.runningRef.current, false, `${run} ends`);
            assert.equal(snap.stopReason, 'workerFailed', `${run} shows the worker failure`);
            assert.equal(snap.applied, null, `${run} leaves the design as it was`);
            assert.equal(snap.history.length, 0, `${run} records no history row`);
            assert.ok(MockWorker.built.every(w => w.terminated), `${run} terminates every worker it built`);

            await withSeed(() => runOnce(ctx));
            assert.equal(snap.stopReason, nextReason, `the run after ${run} replaces the badge`);
        }
    }

    // An error event that a stopped run's worker still delivers is not acted on.
    const { ctx, snap } = makeCtx(frontDesign(), OPS());
    MockWorker.built = [];
    const run = startWindowRun(ctx);
    ctx.stopOpt();
    MockWorker.built[0].onerror({ message: 'late error' });
    await run;
    assert.equal(snap.stopReason, null, 'a late worker error after Stop leaves the badge alone');
}

// A design whose material cannot be prepared for the workers ends the run
// before it starts: no worker, no undo checkpoint, no run number.
async function verifyPresampleFailure() {
    const design = frontDesign();
    design.frontLayers[1].material = 'user_x:Nope';
    const runs = [
        ['single DLS', { method: 'dls' }],
        ['multi-start DLS', { method: 'dls-multi', nRestarts: 4, seed: 7 }],
        ['CG', { method: ['cg'] }],
        ['a method list', { method: ['cg', 'sa'], seed: 7 }],
    ];
    for (const [name, opts] of runs) {
        const { ctx, snap } = makeCtx(JSON.parse(JSON.stringify(design)), OPS(), opts);
        MockWorker.built = [];
        await runOnce(ctx);
        assert.equal(snap.stopReason, 'presampleFailed', `${name}: the badge says the materials could not be prepared`);
        assert.equal(MockWorker.built.length, 0, `${name}: no worker is built`);
        assert.equal(ctx.baselineRef.current, false, `${name}: no undo checkpoint is taken`);
        assert.equal(ctx.histRunCount.current, 0, `${name}: no run number is used`);
        assert.equal(snap.applied, null, `${name}: the design is left as it was`);
    }
}

await verifyIterationHistories();
await verifyStopDuringRun();
await verifyDesignSwitch();
await verifyRunThatThrows();
await verifySeededRuns();
await verifyWorkerFailures();
await verifyPresampleFailure();

const results = {};
for (const name of SCENARIOS) results[name] = await runScenario(name);

if (UPDATE || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
    console.log(`${UPDATE ? 'Updated' : 'Created'} golden: ${GOLDEN} (${SCENARIOS.length} scenarios)`);
    process.exit(0);
}

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
let fails = 0;
for (const name of SCENARIOS) {
    const a = JSON.stringify(golden[name]), b = JSON.stringify(results[name]);
    if (a !== b) {
        fails++;
        console.log(`DRIFT ❌  ${name}`);
        console.log(`   golden : ${a}`);
        console.log(`   current: ${b}`);
    }
}
if (fails === 0) { console.log(`PASS ✅  refinement runs identical to golden (${SCENARIOS.length} scenarios)`); process.exit(0); }
console.log(`FAIL ❌  ${fails} scenario(s) drifted`);
process.exit(1);
