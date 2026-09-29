/**
 * Deep Synthesis runner guard.
 *
 * Drives the window's runner (runDeepSynthesisWorker) headless on the bbar
 * case, from an empty front stack, with a TiO2/SiO2 pool, a 20 nm floor, a cap
 * of 6 layers, a fixed seed and a short search. The run goes to its own worker
 * and its jobs to two real synthesis workers (node:worker_threads). The rows,
 * trend, final design, status and the jobs sent to the synthesis workers are
 * compared with the golden. Around it:
 *   - when the pool cannot be built the run worker runs the jobs itself and
 *     ends on the same rows, trend and design (thread count changes nothing);
 *   - Stop at the first search round ends the run with the best design so far
 *     written to the editor, and leaves the run block open; without a pool it
 *     ends on the same rows, trend and design;
 *   - Stop in the middle of gradual evolution does the same, with and without
 *     a pool, and keeps the steps up to the Stop;
 *   - after Stop the window shows the run until its worker has ended, and a
 *     Run pressed before then is refused, so the stopped run's kept design is
 *     written as with a Stop alone;
 *   - Reset afterwards brings the empty stack back and drops the run's rows;
 *   - a locked layer on the synthesized side refuses the run;
 *   - without a run worker, or with one that does not load, the run is
 *     refused, not run on this thread, and leaves no run block or checkpoint;
 *   - Stop before any design within the cap says so and leaves the start;
 *   - Reset in the middle of a run clears the phase and progress it showed;
 *   - when the run regrids, the run worker samples the window's material
 *     tables, for built-in materials and for a substrate and a pool material
 *     from a user catalog.
 * Every run worker is gone when its run has ended. Row ids and elapsed times
 * are left out.
 *
 * Update after an intentional behavior change:
 *   node tests/deep_synthesis_runner_guard.mjs --update
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { NodeModuleWorker } from './_moduleWorker.mjs';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';

shimBrowserGlobals();

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, 'deep_synthesis_runner_guard.golden.json');
const UPDATE = process.argv.includes('--update');
const ROOT = '../src/components/windows/optimization/deepSynthesis';

// The app's start-up: the WASM kernel on this thread, its bytes kept for the
// workers, so the pool and the serial fallback run the same kernel.
// The golden was recorded on that kernel.
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
if (!(await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true))) {
    console.log('SKIP: the WASM kernel is not available');
    process.exit(0);
}

const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { poolCatalogs, poolMatEntries, getPoolMaterials } = await import(
    '../src/components/windows/optimization/synthesisShared/catalogPool.js');
const { presampleSynthesisMaterials } = await import(
    '../src/components/windows/optimization/synthesisShared/runGrid.js');
const { addCatalog } = await import('../src/utils/materials/catalogManager.js');
const { createRunContext, stopDeepSynthesis, abandonDeepSynthesis } = await import(`${ROOT}/runners/lifecycle.js`);
const { runDeepSynthesisWorker } = await import(`${ROOT}/runners/workerPool.js`);
const { freshHistory, resetLastRun } = await import(`${ROOT}/historyActions.js`);

const log = console.log;
console.log = () => {};

// ── Workers: real run and synthesis workers, counted ──────────────────────────
// `counts` holds the synthesis workers and the messages sent to them, which the
// golden records; the run workers are counted apart, with the material tables
// they sampled when their run regridded.
const counts = { constructed: 0, jobs: {} };
const runWorkers = { constructed: 0, terminated: 0, regrids: [] };
const isRunWorker = url => String(url).endsWith('/deepSynthesisWorker.js');

class CountingWorker extends NodeModuleWorker {
    constructor(url, opts) {
        super(url, opts);
        this.runWorker = isRunWorker(url);
        if (this.runWorker) runWorkers.constructed += 1;
        else counts.constructed += 1;
        if (this.runWorker) {
            this.thread.on('message', (m) => { if (m?.type === 'regrid') runWorkers.regrids.push(m); });
        }
    }
    postMessage(message) {
        if (!this.runWorker) counts.jobs[message.type] = (counts.jobs[message.type] || 0) + 1;
        super.postMessage(message);
    }
    terminate() {
        if (this.runWorker) runWorkers.terminated += 1;
        super.terminate();
    }
}

// A run worker, but no synthesis worker: the pool cannot be built.
class NoPoolWorker extends CountingWorker {
    constructor(url, opts) {
        if (!isRunWorker(url)) throw new Error('no synthesis workers here');
        super(url, opts);
    }
}

// A synthesis worker, but no run worker.
class NoRunWorker extends CountingWorker {
    constructor(url, opts) {
        if (isRunWorker(url)) throw new Error('no run worker here');
        super(url, opts);
    }
}

// A run worker whose module is not there: it is built, then fails to load.
class MissingRunWorker extends NodeModuleWorker {
    constructor(url, opts) {
        super(isRunWorker(url) ? new URL('./missingRunWorker.js', url) : url, opts);
    }
}

// ── Fixture ───────────────────────────────────────────────────────────────────
const copy = value => JSON.parse(JSON.stringify(value));
const OPERANDS = caseById('bbar').ops.map(op => ({ ...op, enabled: true }));
const builtin = poolCatalogs(null).find(cat => cat.id === 'builtin');
const EXCLUDED = new Set(poolMatEntries(builtin).map(e => e.fullId).filter(id => id !== 'TiO2' && id !== 'SiO2'));
const CONFIG = {
    dMin: 20, maxLayers: 6, seed: 7, threads: 2,
    method: { search: { rounds: 2, children: 3 } },
};

// Engine codes as the window's text, so the golden does not follow the wording.
const td = {
    statusStopping: 'stopping', statusStopped: 'stopped', statusStoppedEmpty: 'stopped-empty',
    statusNoDesign: 'no-design',
    statusWorkerError: 'worker-error', statusPresampleFailed: 'presample-failed', statusNoWorker: 'no-worker',
    statusDone: (mf, n) => `done:${n}`, statusFailed: message => `failed:${message}`,
    runSeparator: n => `run:${n}`,
    phaseStatus: new Proxy({}, { get: (_, key) => `phase:${String(key)}` }),
    blocked: new Proxy({}, { get: (_, key) => `blocked:${String(key)}` }),
};

function designWith(frontLayers) {
    return {
        id: 'deep-guard', incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 }, surfaceMode: 'front_only', mfEvalMode: 'side',
        frontLayers, backLayers: [], meritOperands: copy(OPERANDS),
    };
}

// A context as the window hook builds one, with the view kept in `view`.
function makeCtx(frontLayers, onPublish = () => {}) {
    const view = { statuses: [] };
    const ctx = createRunContext((patch) => {
        Object.assign(view, patch);
        if (patch.statusMsg) view.statuses.push(patch.statusMsg);
        onPublish(patch, view, ctx);
    });
    ctx.hist = freshHistory();
    ctx.td = td;
    ctx.cfgRef.current = copy(CONFIG);
    ctx.designRef.current = designWith(frontLayers);
    ctx.operandsRef.current = copy(OPERANDS);
    ctx.selectedCatsRef.current = new Set(['builtin']);
    ctx.excludedMatsRef.current = EXCLUDED;
    ctx.applied = 0;
    ctx.checkpoints = 0;
    ctx.updateDesign = (patch) => {
        ctx.designRef.current = { ...ctx.designRef.current, ...copy(patch) };
        ctx.applied += 1;
    };
    ctx.checkpoint = () => { ctx.checkpoints += 1; };
    ctx.getDesignRevision = () => 0;
    return { ctx, view };
}

// Numbers to nine significant digits; ids and elapsed times left out.
const stable = value => JSON.parse(JSON.stringify(value, (key, v) => {
    if (key === 'id' || key === 'tMs') return undefined;
    return typeof v === 'number' ? Number(v.toPrecision(9)) : v;
}));

function resultOf(ctx, view) {
    return stable({
        rows: ctx.hist.rows.map(row => ({
            genNum: row.genNum, runNum: row.runNum, seed: row.seed, kind: row.kind, move: row.move,
            mf: row.mf, dMF: row.dMF, layerCount: row.layerCount, tot: row.tot,
            layers: row.layers.map(({ material, thickness }) => ({ material, thickness })),
        })),
        trend: ctx.hist.trend,
        design: ctx.designRef.current.frontLayers.map(({ material, thickness }) => ({ material, thickness })),
        view: {
            running: view.running, status: view.statusMsg, mfBest: view.mfBest, layerCount: view.layerCount,
            parts: view.parts, startInfo: view.startInfo, statuses: view.statuses,
        },
        hist: { runOpen: ctx.hist.runOpen, runs: ctx.hist.runs.length, applied: ctx.applied, checkpoints: ctx.checkpoints },
    });
}

async function run(frontLayers, onPublish) {
    const { ctx, view } = makeCtx(frontLayers, onPublish);
    await runDeepSynthesisWorker(ctx);
    assert.equal(ctx.runningRef.current, false, 'the run finished');
    assert.equal(runWorkers.terminated, runWorkers.constructed, 'the run worker is gone');
    return { ctx, view };
}

const withoutWorkers = ({ workers, ...rest }) => rest;

// The tables the run worker sampled at each regrid since the last check are
// the ones the window samples for the same grid from its own materials.
function assertRegridTables(design, pool, what) {
    const regrids = runWorkers.regrids.splice(0);
    assert.ok(regrids.length > 0, `${what}: the run regrids`);
    for (const { operands, materials } of regrids) {
        const want = presampleSynthesisMaterials(design, operands, pool);
        assert.deepEqual(materials, want, `${what}: the run worker samples the window's tables`);
    }
}
const poolOf = (selected, excluded, design) => getPoolMaterials(selected, { excluded, design });

// The fallbacks say what they fall back from on the console.
const quietly = async (body) => {
    const { warn, error } = console;
    console.warn = () => {};
    console.error = () => {};
    try { return await body(); } finally { Object.assign(console, { warn, error }); }
};

// ── 1. The pool run, against the golden ───────────────────────────────────────
globalThis.Worker = CountingWorker;
const pooled = await run([]);
const results = { pool: { ...resultOf(pooled.ctx, pooled.view), workers: copy(counts) } };
assert.ok(counts.constructed === CONFIG.threads, `a pool of ${CONFIG.threads} workers (${counts.constructed})`);
assert.equal(runWorkers.constructed, 1, 'one run worker');
assertRegridTables(designWith([]), poolOf(new Set(['builtin']), EXCLUDED, designWith([])), 'built-in materials');
assert.ok(pooled.ctx.hist.rows.length > 0, 'the run records its best designs');
assert.ok(pooled.ctx.hist.rows.every(row => row.layerCount <= CONFIG.maxLayers), 'every row is within the cap');

// ── 2. No pool: the run worker runs the jobs, with the same result ────────────
globalThis.Worker = NoPoolWorker;
{
    const pooledWorkers = counts.constructed;
    const serial = await quietly(() => run([]));
    assert.equal(counts.constructed, pooledWorkers, 'no synthesis worker is built');
    assert.equal(runWorkers.constructed, 2, 'the run has a worker of its own');
    assert.deepEqual(resultOf(serial.ctx, serial.view), withoutWorkers(results.pool),
        'the serial fallback ends on the pool run\'s rows, trend and design');
}

// ── 3. Stop at the first search round keeps the best design so far ────────────
// The Stop comes with the round's trend point. The run worker has gone on by
// then and ends at its next batch, which the window refuses; without a pool the
// run worker waits for the window's turn before each batch, so it ends there
// too.
function stopWhen(matches) {
    let phase = null;
    return (patch, view, ctx) => {
        if (patch.phase !== undefined) phase = patch.phase;
        if (matches(patch, phase) && ctx.runningRef.current) stopDeepSynthesis(ctx);
    };
}
const atFirstRound = (patch, phase) => phase === 'search' && !!patch.trend;
const atGeStep = step => (patch, phase) => phase === 'ge' && patch.step === step;
const layersOf = layers => stable(layers.map(({ material, thickness }) => ({ material, thickness })));

function assertKeptBest({ ctx, view }, what) {
    const lowest = ctx.hist.rows.reduce((a, b) => (a.mf <= b.mf ? a : b));
    assert.equal(view.statusMsg, 'stopped', `${what}: a Stop ends on the stopped status`);
    assert.deepEqual(layersOf(ctx.designRef.current.frontLayers), layersOf(lowest.layers),
        `${what}: the editor holds the best design so far`);
    assert.equal(ctx.hist.runOpen, true, `${what}: a Stop leaves the run block open`);
}

globalThis.Worker = CountingWorker;
const stopped = await run([], stopWhen(atFirstRound));
results.stop = resultOf(stopped.ctx, stopped.view);
assertKeptBest(stopped, 'search');

globalThis.Worker = NoPoolWorker;
{
    const serialStop = await quietly(() => run([], stopWhen(atFirstRound)));
    assert.deepEqual(resultOf(serialStop.ctx, serialStop.view), results.stop,
        'without a pool a Stop in the search ends on the same rows, trend and design');
}

// ── 3b. Stop in the middle of gradual evolution ───────────────────────────────
// Stop as the third step comes in: the steps up to it stay, none after.
{
    globalThis.Worker = CountingWorker;
    const pooledStop = await run([], stopWhen(atGeStep(3)));
    assertKeptBest(pooledStop, 'evolution');
    assert.deepEqual(stable(pooledStop.ctx.hist.trend), results.pool.trend.slice(0, 3),
        'the trend holds the steps up to the Stop');
    globalThis.Worker = NoPoolWorker;
    const serialStop = await quietly(() => run([], stopWhen(atGeStep(3))));
    assert.deepEqual(resultOf(serialStop.ctx, serialStop.view), resultOf(pooledStop.ctx, pooledStop.view),
        'without a pool a Stop in gradual evolution ends on the same rows, trend and design');
}

// ── 3c. Run right after Stop ──────────────────────────────────────────────────
// Run pressed as soon as Stop is, while the stopped run's worker has yet to
// end: the window still shows the run, the Run is refused, and the stopped
// run ends as a Stop alone does.
globalThis.Worker = CountingWorker;
{
    const built = runWorkers.constructed;
    const press = { running: null, again: null };
    const stop = stopWhen(atFirstRound);
    const stopThenRun = (patch, view, ctx) => {
        const wasRunning = ctx.runningRef.current;
        stop(patch, view, ctx);
        if (!wasRunning || ctx.runningRef.current) return;
        press.running = view.running;
        press.again = runDeepSynthesisWorker(ctx);
    };
    const again = await run([], stopThenRun);
    assert.equal(press.running, true, 'after Stop the window shows the run until its worker ends');
    assert.equal(press.again, undefined, 'a Run before the stopped run has ended is refused');
    assert.equal(runWorkers.constructed, built + 1, 'no second run worker is built');
    assert.deepEqual(resultOf(again.ctx, again.view), results.stop,
        'the stopped run writes its kept design as with a Stop alone');
}

// ── 4. Reset brings the start back ────────────────────────────────────────────
resetLastRun(stopped.ctx);
assert.deepEqual(stopped.ctx.designRef.current.frontLayers, [], 'Reset restores the empty stack');
assert.equal(stopped.ctx.hist.rows.length, 0, 'and drops the run\'s rows');

// ── 5. A locked layer refuses the run ─────────────────────────────────────────
globalThis.Worker = CountingWorker;
{
    const { ctx, view } = makeCtx([{ id: 'L', material: 'SiO2', thickness: 100, locked: true }]);
    const before = { pool: counts.constructed, run: runWorkers.constructed };
    await runDeepSynthesisWorker(ctx);
    assert.equal(view.statusMsg, 'blocked:locked', 'the status names the lock');
    assert.deepEqual({ pool: counts.constructed, run: runWorkers.constructed }, before, 'no worker is built');
    assert.equal(ctx.hist.runs.length, 0, 'no run block is opened');
}

// ── 5b. Without a run worker the run is refused ───────────────────────────────
globalThis.Worker = NoRunWorker;
{
    const { ctx, view } = makeCtx([]);
    const before = counts.constructed;
    await quietly(() => runDeepSynthesisWorker(ctx));
    assert.equal(view.statusMsg, 'no-worker', 'the status says the run has no worker');
    assert.equal(counts.constructed, before, 'no synthesis worker is built');
    assert.equal(ctx.hist.runs.length, 0, 'no run block is opened');
    assert.equal(ctx.runningRef.current, false, 'nothing runs');
    assert.equal(ctx.applied, 0, 'the design is untouched');
}
globalThis.Worker = MissingRunWorker;
{
    const { ctx, view } = makeCtx([]);
    await quietly(() => runDeepSynthesisWorker(ctx));
    await quietly(() => runDeepSynthesisWorker(ctx));
    assert.equal(view.statusMsg, 'no-worker', 'a run worker that does not load says so');
    assert.equal(ctx.runningRef.current, false, 'and nothing runs');
    assert.equal(view.running, false, 'the window shows no run');
    assert.equal(ctx.hist.runs.length, 0, 'no run block is opened, however often Run is pressed');
    assert.equal(ctx.checkpoints, 0, 'no undo checkpoint is taken');
    assert.equal(ctx.applied, 0, 'the design is untouched');
}

// ── 6. Stop before any design within the cap ──────────────────────────────────
// An 8-layer start over the cap of 6, stopped as its first refine begins.
globalThis.Worker = CountingWorker;
{
    const over = Array.from({ length: 8 }, (_, i) => ({
        id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness: i % 2 ? 80 : 50, locked: false,
    }));
    const { ctx, view } = await run(over, stopWhen(patch => !!patch.phase));
    assert.equal(view.statusMsg, 'stopped-empty', 'the status says no design was kept');
    assert.equal(ctx.hist.rows.length, 0, 'no row is recorded');
    assert.equal(ctx.designRef.current.frontLayers.length, 8, 'the start stays in the editor');
}

// ── 7. Reset in the middle of a run clears its progress ───────────────────────
// Reset as a click right after the search phase begins: the window leaves the
// run, whose own ending then writes nothing.
{
    const resetInSearch = (patch, view, ctx) => {
        if (patch.phase === 'search' && ctx.runningRef.current) {
            abandonDeepSynthesis(ctx, '');
            resetLastRun(ctx);
        }
    };
    const { ctx, view } = await run([], resetInSearch);
    assert.deepEqual({ running: view.running, phase: view.phase, step: view.step, round: view.round },
        { running: false, phase: null, step: 0, round: 0 }, 'the control bar shows no progress');
    assert.deepEqual(ctx.designRef.current.frontLayers, [], 'Reset restores the empty stack');
}

// ── 8. Materials from a user catalog ──────────────────────────────────────────
// A substrate and a pool material from a catalog the run worker has no copy
// of: it samples them from the records the window sends, to the same tables.
{
    const tab = (n0, slope) => [300, 500, 800, 1200].map(lam => [lam, n0 + slope * (550 - lam) / 1000, 0]);
    addCatalog({
        id: 'guard', name: 'Guard', source: 'user',
        materials: {
            Hi: { name: 'Hi', formulaNum: -1, tabData: tab(2.1, 0.12) },
            Glass: { name: 'Glass', formulaNum: -1, tabData: tab(1.52, 0.02) },
        },
    });
    const selected = new Set(['builtin', 'guard']);
    const excluded = new Set([...EXCLUDED, 'TiO2', 'guard:Glass']);
    let stoppedAt = null;
    const stopAfterRegrid = (patch, view, ctx) => {
        if (runWorkers.regrids.length > 0 && ctx.runningRef.current) {
            stoppedAt = runWorkers.regrids.length;
            stopDeepSynthesis(ctx);
        }
    };
    const { ctx } = makeCtx([], stopAfterRegrid);
    ctx.selectedCatsRef.current = selected;
    ctx.excludedMatsRef.current = excluded;
    ctx.designRef.current = { ...ctx.designRef.current, substrate: { material: 'guard:Glass', thickness: 1 } };
    const launch = ctx.designRef.current;
    runWorkers.regrids.length = 0;
    await runDeepSynthesisWorker(ctx);
    assert.ok(stoppedAt > 0, 'the run regrids before the Stop');
    assert.deepEqual(poolOf(selected, excluded, launch).map(m => m.id).sort(), ['SiO2', 'guard:Hi'], 'the pool');
    assertRegridTables(launch, poolOf(selected, excluded, launch), 'user catalog');
}

console.log = log;

if (UPDATE || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
    console.log(`${UPDATE ? 'Updated' : 'Created'} golden: ${GOLDEN}`);
    process.exit(0);
}

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
let failures = 0;
for (const name of Object.keys(results)) {
    const expected = JSON.stringify(golden[name]);
    const actual = JSON.stringify(results[name]);
    if (expected !== actual) {
        failures += 1;
        console.error(`DRIFT ${name}`);
        console.error(`  golden: ${expected}`);
        console.error(`  actual: ${actual}`);
    }
}
if (failures) {
    console.error(`FAIL: ${failures} Deep Synthesis runner scenario(s) drifted`);
    process.exit(1);
}
console.log(`PASS: Deep Synthesis runner matches golden (${Object.keys(results).length} scenarios)`);
process.exit(0);
