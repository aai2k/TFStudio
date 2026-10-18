/**
 * Structural run guard: a before/after identity check for a Structural
 * Optimizer run as the window sees it.
 *
 * Each scenario drives a run end to end against a fake Structural window
 * (_structuralWindow.mjs): the ctx useStructuralOptimizer.js hands the run,
 * and the global `Worker` its refines go to, which answers each refine with a
 * scripted merit, or runs the real optimizer job on the calling thread. The
 * guard snapshots what the window ends up showing (the history rows, the trend,
 * the status lines in order, the readout, the design and the run blocks, the
 * run cache) and compares that to a committed golden. Beside the golden it
 * checks that a seed replays its run, that each press is timed on from the
 * presses before it, that every press checks the design for edits first, and
 * that a second Run press while a run is going is ignored.
 *
 * Determinism:
 *  - One thread unless a scenario sets more; the seed is fixed per scenario.
 *  - Date.now is frozen, so the live-readout throttle passes the first tick of
 *    a run and no other, whatever the machine's speed.
 *  - performance.now advances one millisecond per reading, so the rows' times
 *    and the Deep search time limit fall at the same points on any machine.
 *  - Row ids and times (tMs) are left out of the snapshot.
 *
 *   Update baseline (after a verified intentional change):  node tests/structural_runner_guard.mjs --update
 *   Run the guard:                                          node tests/structural_runner_guard.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest, TMMCORE_WASM_PATH } from './_wasmInit.mjs';
import { timeRunsOn, sorted } from './_windowRunChecks.mjs';

shimBrowserGlobals();
await initWasmForTest();

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, 'structural_runner_guard.golden.json');
const UPDATE = process.argv.includes('--update');

Date.now = () => 1700000000000;
let clock = 0;
performance.now = () => ++clock;

// Keep the kernel bytes for workers, as the app does, so the refines carry them.
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);

const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { MUTATION_KINDS } = await import('../src/utils/synthesis/structuralOptimizer.js');
const { runStructuralWorker } = await import('../src/components/windows/optimization/structuralOptimizer/runners/workerPool.js');
const { reconcileStructuralBaseWithEdits } = await import('../src/components/windows/optimization/structuralOptimizer/useStructuralOptimizer.js');
const { makeWindow, useWindow, withWindowSettings } = await import('./_structuralWindow.mjs');

const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });

function design(surfaceMode = 'front_only', front = null) {
    return {
        referenceWavelength: 550, incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 },
        frontLayers: front || (surfaceMode === 'back_only' ? [] : [layer('F1', 'TiO2', 90), layer('F2', 'SiO2', 110)]),
        backLayers: surfaceMode === 'front_only' ? [] : [layer('B1', 'SiO2', 105), layer('B2', 'TiO2', 95)],
        surfaceMode, mfEvalMode: 'side',
    };
}

const RAV = { id: 'guard-op', type: 'RAV', enabled: true, lambdaStart: 500, lambdaEnd: 600, lambdaStep: 20, aoi: 0, pol: 'avg', target: 0.5, weight: 1 };
const op = (id, fields) => ({ ...makeOperand(fields), id, enabled: true });

const CFG = {
    maxIter: 3, targetMF: 0, T0: 0.08, jitterPct: 0.15, refineIter: 5, dMin: 1, addMaxNm: 120,
    maxLayers: 20, kinds: ['perturb'], deepMode: false, deepMaxMin: 0, seed: 7,
};

// Each scenario: the surface mode or design, the operands, settings over CFG,
// the pool, local storage, the merits the scripted proposals score, and the
// Run presses with what the workers do during each. The run scores what a
// refine returns by the design's own merit, so a scripted merit counts only
// where that fails; with no jitter a perturbation returns the design it was
// given, which never improves.
const SCENARIOS = {
    frontNormal:      { normalMf: [0.6, 0.7, 0.4] },
    backNormal:       { surfaceMode: 'back_only', normalMf: [0.65, 0.75, 0.45] },
    bothSides:        { surfaceMode: 'both_independent', normalMf: [0.6, 0.5] },
    symmetricSmartSeedFailure: { surfaceMode: 'symmetric', storage: { smartSeed: '1', threads: '2' }, normalMf: [0.8] },
    everyKind:        { cfg: { kinds: MUTATION_KINDS, maxIter: 4 }, poolIds: ['TiO2', 'SiO2', 'MgF2'], storage: { threads: '3' }, normalMf: [0.6, 0.7, 0.5, 0.4] },
    dlsEngine:        { storage: { engine: 'dls' }, normalMf: [0.6] },
    targetReached:    { cfg: { targetMF: 0.5 }, normalMf: [0.6, 0.45] },
    stalled:          { cfg: { maxIter: 20, jitterPct: 0 }, normalMf: [0.9] },
    layerCap:         { cfg: { kinds: ['add'], maxLayers: 2 }, poolIds: ['TiO2', 'SiO2'], normalMf: [0.6] },
    deepTimeUp:       { cfg: { deepMode: true, deepMaxMin: 1e-6 }, normalMf: [0.9] },
    deepReheat:       { cfg: { deepMode: true, jitterPct: 0 }, normalMf: [0.9], presses: [{ stopAtJob: 22 }] },
    mntMxtBounds:     { ops: [RAV, op('mnt', { type: 'MNT', target: 30, weight: 1 }), op('mxt', { type: 'MXT', target: 150, weight: 1 })], normalMf: [0.6] },
    stopThenRun:      { cfg: { maxIter: 6 }, normalMf: [0.6, 0.7, 0.5, 0.45, 0.4, 0.35], presses: [{ stopAtJob: 3 }, {}] },
    stopEditRun:      { cfg: { maxIter: 4 }, normalMf: [0.6], presses: [{ stopAtJob: 3 }, { edit: true }] },
    secondPress:      { normalMf: [0.6, 0.5], presses: [{}, {}] },
    failsAtBaseline:  { normalMf: [0.6], presses: [{ failAtJob: 1 }] },
    failsMidRun:      { normalMf: [0.6, 0.5], presses: [{ failAtJob: 3 }] },
    malformedMidRun:  { normalMf: [0.6], presses: [{ malformedAtJob: 3 }] },
    noOperands:       { ops: [], normalMf: [0.6] },
    noMaterials:      { front: [], cfg: { kinds: ['add'] }, poolIds: [], normalMf: [0.6] },
    presampleFails:   { front: [layer('X', 'NoSuchMaterial', 100)], normalMf: [0.6] },
    workersFail:      { normalMf: [0.6], presses: [{ workersThrow: true }] },
    realWorker: {
        worker: 'real', front: [layer('A', 'TiO2', 30), layer('B', 'SiO2', 50)], ops: caseById('bbar').ops,
        cfg: { kinds: MUTATION_KINDS, maxIter: 4, refineIter: 10, T0: 0.3, addMaxNm: 200 },
        poolIds: ['TiO2', 'SiO2'], storage: { threads: '2' },
    },
};

const layersOf = list => (list || []).map(l => [l.material, l.thickness, !!l.locked]);
const sides = d => d && { front: layersOf(d.frontLayers), back: layersOf(d.backLayers) };
const rowOf = g => {
    const { id, tMs, layers, frontSnap, backSnap, ...rest } = g;
    return { ...rest, layers: layersOf(layers), frontSnap: layersOf(frontSnap), backSnap: layersOf(backSnap) };
};

const tick = () => new Promise(r => setTimeout(r, 0));
async function settle(win) {
    for (let i = 0; i < 200000 && win.ctx.runningRef.current; i++) await tick();
    for (let i = 0; i < 20; i++) await tick();
}

// Whether each scenario's rows are timed on across its presses.
const WINDOW_TIMES = {};

async function runScenario(name) {
    const s = SCENARIOS[name];
    const spec = {
        design: design(s.surfaceMode, s.front), ops: s.ops || [RAV], cfg: { ...CFG, ...s.cfg },
        poolIds: s.poolIds, normalMf: s.normalMf, worker: s.worker,
    };
    const win = makeWindow(spec, `structural-guard-${name}`);
    useWindow(win);
    const presses = [], rowCounts = [];
    await withWindowSettings(s.storage || {}, async () => {
        for (const press of s.presses || [{}]) {
            if (press.edit) win.edit();
            win.press = press;
            win.statuses = [];
            // A stopped press's refines wait out their timeout; the guard does
            // not wait for them.
            runStructuralWorker(win.ctx);
            await settle(win);
            presses.push({ statuses: win.statuses, running: win.ctx.runningRef.current });
            rowCounts.push(win.ctx.gensRef.current.length);
        }
    });
    const ctx = win.ctx;
    WINDOW_TIMES[name] = timeRunsOn(rowCounts, ctx.gensRef.current);
    const cached = win.cached();
    return {
        presses,
        rows: ctx.gensRef.current.map(rowOf),
        trend: ctx.trendRef.current.map(({ iter, cur, best, runNum }) => ({ iter, cur, best, runNum })),
        shown: win.shown,
        design: sides(ctx.designRef.current),
        base: sides(ctx.baseDesignRef.current),
        saved: sides(ctx.savedDesignRef.current),
        runs: ctx.runsRef.current.map(r => ({ runNum: r.runNum, baseline: sides(r.baseline) })),
        runOpen: ctx.runOpenRef.current,
        genCount: ctx.genCountRef.current,
        cached: cached && { rows: cached.generations.length, runs: cached.runs.length, trend: cached.trend.length, base: sides(cached.baseDesign) },
        checkpoints: win.checkpoints, applied: win.applied, edits: win.edits, reconciles: win.reconciles,
        workers: { built: win.workers, terminated: win.terminated, jobs: win.jobCount },
        firstJob: win.firstJob,
    };
}

const results = {};
for (const name of Object.keys(SCENARIOS)) results[name] = sorted(await runScenario(name));

if (UPDATE || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
    console.log(`${UPDATE ? 'Updated' : 'Created'} golden: ${GOLDEN} (${Object.keys(results).length} scenarios)`);
    process.exit(0);
}

// ── What the window must show, whatever the golden holds ─────────────────────

// A run draws from the seed in its seed field, or from a fresh one the field
// then shows, and every row keeps it. The same seed replays the run; another
// seed runs differently.
async function seededRun(seed) {
    const win = makeWindow({ design: design(), ops: [RAV], cfg: { ...CFG, seed }, normalMf: [0.6, 0.7, 0.4] }, `structural-guard-seed-${seed}`);
    useWindow(win);
    await withWindowSettings({}, async () => { runStructuralWorker(win.ctx); await settle(win); });
    return { shown: win.shown.seed, seeds: win.ctx.gensRef.current.map(g => g.seed), layers: win.ctx.gensRef.current.map(g => layersOf(g.layers)) };
}
async function seedFailures() {
    const failed = [];
    const first = await seededRun(11), again = await seededRun(11), other = await seededRun(12);
    try {
        assert.deepEqual(again, first, 'the same seed does not replay the run');
        assert.notDeepEqual(other.layers, first.layers, 'another seed runs the same proposals');
        assert.equal(first.shown, 11, 'the run does not show its seed');
        assert.ok(first.seeds.every(seed => seed === 11), 'a row does not record the seed');
        const fresh = await seededRun(null);
        assert.ok(Number.isInteger(fresh.shown) && fresh.shown >= 1, `an empty seed field drew no seed (${fresh.shown})`);
        assert.ok(fresh.seeds.every(seed => seed === fresh.shown), 'a row does not record the seed drawn');
    } catch (err) { failed.push(`seed: ${err.message}`); }
    return failed;
}

// A second Run press while a run is going is ignored.
async function secondPressFailures() {
    const win = makeWindow({ design: design(), ops: [RAV], cfg: CFG, normalMf: [0.6] }, 'structural-guard-second-press');
    useWindow(win);
    return withWindowSettings({}, async () => {
        runStructuralWorker(win.ctx);
        runStructuralWorker(win.ctx);
        await settle(win);
        return win.workers === 1 && win.reconciles === 1 ? []
            : [`second press: ${win.workers} workers built, ${win.reconciles} presses taken`];
    });
}

// A manual edit bumps the design revision: the next Run drops the cached base
// and closes a block a Stop left open, so it does not overwrite the edit.
function reconcileFailures() {
    let revision = 4;
    const refs = {
        designRef: { current: { id: 'edited' } }, baseDesignRef: { current: { stale: true } },
        baseRevRef: { current: 4 }, runOpenRef: { current: true },
    };
    const failed = [];
    if (reconcileStructuralBaseWithEdits(refs, () => revision) !== false || !refs.baseDesignRef.current) {
        failed.push('edits: an unchanged design lost the base a Stop left');
    }
    revision = 5;
    if (reconcileStructuralBaseWithEdits(refs, () => revision) !== true
        || refs.baseDesignRef.current !== null || refs.runOpenRef.current !== false || refs.baseRevRef.current !== 5) {
        failed.push('edits: the base a Stop left survived a manual edit');
    }
    return failed;
}

const windowFailures = [
    ...Object.entries(WINDOW_TIMES).filter(([, ok]) => !ok).map(([name]) => `${name}: a later press's rows are timed before an earlier one's`),
    ...Object.entries(results).filter(([, r]) => r.reconciles !== r.presses.length).map(([name]) => `${name}: a press did not check the design for edits`),
    ...await seedFailures(),
    ...await secondPressFailures(),
    ...reconcileFailures(),
];
for (const failure of windowFailures) console.log(`FAIL ❌  ${failure}`);

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
let fails = windowFailures.length;
for (const name of Object.keys(SCENARIOS)) {
    const a = JSON.stringify(golden[name]), b = JSON.stringify(results[name]);
    if (a !== b) {
        fails++;
        console.log(`DRIFT ❌  ${name}`);
        console.log(`   golden : ${a}`);
        console.log(`   current: ${b}`);
    }
}
// A stopped press leaves refines waiting out their timeout; they show nothing.
if (fails === 0) { console.log(`PASS ✅  Structural runs identical to golden (${Object.keys(SCENARIOS).length} scenarios), window checks pass`); process.exit(0); }
console.log(`FAIL ❌  ${fails} failure(s)`);
process.exit(1);
