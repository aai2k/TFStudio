/**
 * Gradual Evolution run guard: a before/after identity check for a Gradual
 * Evolution run as the window sees it, utils/gradualEvolution/
 * runGradualEvolution.js started and shown by the window's windowRun.js.
 *
 * Each scenario drives a run end to end against a fake Gradual Evolution
 * window (_geWindow.mjs): the ctx useGradualEvolution.js hands the run, and
 * the global `Worker` the run's pool is built from, which runs the real
 * synthesis-worker handlers job by job, or answers each job with a scripted
 * result so a run takes a fixed path through the forced steps, the layer-limit
 * swap and the consolidation. The guard snapshots what the window ends up
 * showing (the history rows, the status lines and phases in order, the readout,
 * the design and the run blocks, the run cache) and compares that to a
 * committed golden. Beside the golden it checks what the window must show
 * whatever the golden holds: time running on across presses, a second Run
 * press ignored, nothing shown from a run the window has let go of, and every
 * field of the window reaching the run.
 *
 * Determinism:
 *  - The pool size comes from the thread setting, fixed here at 3.
 *  - Date.now is frozen, so the live-preview throttle passes the first tick of
 *    a run and no other, whatever the machine's speed.
 *  - performance.now advances one millisecond per reading, so a worker's live
 *    previews and the rows' times fall at the same points on any machine.
 *  - Row ids, layer ids and times (tMs) are left out of the snapshot.
 *
 *   Update baseline (after a verified intentional change):  node tests/ge_runner_guard.mjs --update
 *   Run the guard:                                          node tests/ge_runner_guard.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shimBrowserGlobals, useImmediateTimers } from './_uiShim.mjs';
import { initWasmForTest, TMMCORE_WASM_PATH } from './_wasmInit.mjs';
import { timeRunsOn, sorted, letGoFailures } from './_windowRunChecks.mjs';

shimBrowserGlobals();
useImmediateTimers();
await initWasmForTest();

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, 'ge_runner_guard.golden.json');
const UPDATE = process.argv.includes('--update');

const FROZEN_NOW = 1e12;
Date.now = () => FROZEN_NOW;
let clock = 0;
performance.now = () => ++clock;

const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { getCached } = await import('../src/components/windows/optimization/gradualEvolution/sessionState.js');
const { startWindowRun } = await import('../src/components/windows/optimization/gradualEvolution/windowRun.js');
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
const { layer, makeWindow, makeWaitingPool, settle, useWindow, withWindowSettings } = await import('./_geWindow.mjs');

const mat = id => ({ id, name: id, mat: getMaterial(id) });
const POOL = ['TiO2', 'SiO2'].map(mat);
const BBAR = caseById('bbar').ops;
const MNT = makeOperand({ type: 'MNT', target: 20, weight: 1 });
// A 480-520 nm reflection notch with a 600-650 nm pass band, for the scripted
// worker, whose answers do not depend on the merit.
const NOTCH = [
    makeOperand({ type: 'RAV', lambdaStart: 480, lambdaEnd: 520, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    makeOperand({ type: 'TAV', lambdaStart: 600, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
];

const design = (extra = {}) => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [layer('S', 'SiO2', 100)], backLayers: [],
    surfaceMode: 'front_only', mfEvalMode: 'side',
    ...extra,
});

const BASE = {
    worker: 'real', ops: BBAR, pool: POOL,
    maxLayers: 6, maxGeCycles: 3, targetMF: 1e-4, dlsIter: 10, dMin: 15, deepSearch: false,
};
const SCRIPTED = {
    worker: 'scripted', ops: NOTCH, maxLayers: 4, maxGeCycles: 5, targetMF: 1e-9, dlsIter: 5, dMin: 10,
};

// Each scenario is one or more Run presses on one window.
const SCENARIOS = {
    plain: { presses: [{}] },
    refineSeedMode: { storage: { seedMode: 'refine' }, presses: [{}] },
    refineNoSmartSeed: { storage: { seedMode: 'refine', smartSeed: '0' }, presses: [{}] },
    consolidateOff: { storage: { consolidate: '0' }, presses: [{}] },
    bothSides: {
        maxLayers: 4,
        design: design({ surfaceMode: 'both_independent', mfEvalMode: 'total', backLayers: [layer('B', 'SiO2', 100)] }),
        presses: [{}],
    },
    backOnly: {
        design: design({ surfaceMode: 'back_only', mfEvalMode: 'total', frontLayers: [], backLayers: [layer('B', 'SiO2', 100)] }),
        presses: [{}],
    },
    layerLimit: { maxLayers: 3, maxGeCycles: 4, presses: [{}] },
    deepSearch: { deepSearch: true, maxLayers: 3, presses: [{ stopAtJob: 150 }] },
    targetStop: { targetMF: 0.05, presses: [{}] },
    sqpThorough: { storage: { engine: 'sqp', candMode: 'thorough', sensitivity: 'medium' }, presses: [{}] },
    mntKept: { ops: [...BBAR, MNT], presses: [{}] },
    secondPress: { presses: [{ maxGeCycles: 1 }, { maxGeCycles: 3 }] },
    stopThenRun: { presses: [{ stopAtJob: 12 }, {}] },
    errorAfterProgress: { presses: [{ failAtJob: 9 }] },
    noOperands: { ops: BBAR.map(op => ({ ...op, enabled: false })), presses: [{}] },
    noMaterials: { pool: [], presses: [{}] },
    // A pool that cannot be built, or that fails before the run has shown
    // anything, ends the run with the design as it was.
    poolNotBuilt: { presses: [{ poolThrows: true }] },
    failsAtFirstJob: { presses: [{ failAtJob: 1 }] },
    presampleFails: { pool: [...POOL, { id: 'Broken', name: 'Broken', mat: { getNK() { throw new Error('no data'); } } }], presses: [{}] },
    // The refined seed is on screen, and so is a live preview of it, so a
    // failure after either is a failure after progress.
    failsDuringSeed: { presses: [{ previewThenFailAtJob: 1 }] },
    failsDuringSmartSeed: { storage: { seedMode: 'refine' }, presses: [{ previewThenFailAtJob: 1 }] },
    failsAfterSeed: { presses: [{ failAtJob: 2 }] },
    scriptedFront: { ...SCRIPTED, design: design({ frontLayers: [layer('L1', 'TiO2', 110)] }), presses: [{}] },
    scriptedBack: {
        ...SCRIPTED,
        design: design({ surfaceMode: 'back_only', frontLayers: [], backLayers: [layer('B1', 'TiO2', 110)] }),
        presses: [{}],
    },
};

const layersOf = arr => (arr || []).map(l => [l.material, l.thickness]);
const rowOf = cy => {
    const { id, tMs, layers, frontSnap, backSnap, ...rest } = cy;
    return { ...rest, layers: layersOf(layers), frontSnap: layersOf(frontSnap), backSnap: layersOf(backSnap) };
};
const sideLayers = d => d && { front: layersOf(d.frontLayers), back: layersOf(d.backLayers) };

// Whether each scenario's rows are timed on across its presses (runScenario).
const WINDOW_TIMES = {};

async function runScenario(name) {
    const spec = { ...BASE, design: design(), ...SCENARIOS[name] };
    const id = `ge-guard-${name}`;
    const win = makeWindow(spec, id);
    useWindow(win);
    const presses = [], rowCounts = [];
    await withWindowSettings(spec.storage, async () => {
        for (const press of spec.presses) {
            win.press = press;
            if (press.maxGeCycles) win.ctx.maxGeCyclesRef.current = press.maxGeCycles;
            win.statuses = []; win.phases = [];
            await startWindowRun(win.ctx);
            await settle(win);
            presses.push({ statuses: win.statuses, phases: win.phases, running: win.ctx.runningRef.current });
            rowCounts.push(win.ctx.cyclesRef.current.length);
        }
    });
    const ctx = win.ctx;
    WINDOW_TIMES[name] = timeRunsOn(rowCounts, ctx.cyclesRef.current);
    const cached = getCached(id);
    return {
        presses,
        rows: ctx.cyclesRef.current.map(rowOf),
        shown: win.shown,
        design: win.applied && sideLayers(win.applied),
        base: sideLayers(ctx.baseDesignRef.current),
        saved: ctx.savedDesignRef.current && layersOf(ctx.savedDesignRef.current.frontLayers),
        runs: ctx.runsRef.current.map(r => ({ runNum: r.runNum, baseline: layersOf(r.baseline?.frontLayers) })),
        runOpen: ctx.runOpenRef.current,
        genCount: ctx.genCountRef.current,
        geSteps: ctx.geStepsRef.current,
        cached: cached && { rows: cached.cycles.length, runs: cached.runs.length, geSteps: cached.geSteps, base: sideLayers(cached.baseDesign) },
        checkpoints: win.checkpoints,
        edits: win.edits,
        designUpdates: win.designUpdates,
        jobs: win.jobs,
        workers: win.workers,
        terminated: win.terminated,
    };
}

// ── What the window must show, whatever the golden holds ─────────────────────

// Every window field reaches the run: one press with values other than the
// defaults, read back from the jobs the workers get. MgF2 is in the pool and
// excluded, so no job may offer it.
async function verifySettingsReachRun() {
    const failed = [];
    const win = makeWindow({ ...BASE, design: design(), pool: [...POOL, mat('MgF2')], dMin: 12, dlsIter: 12 }, 'ge-guard-settings');
    useWindow(win);
    win.ctx.excludedMatsRef.current = new Set(['MgF2']);
    await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);
    await withWindowSettings({ consolidateTol: '0.2', seedMode: 'refine' }, async () => {
        await startWindowRun(win.ctx);
        await settle(win);
    });
    const of = type => win.posted.filter(job => job.type === type);
    const offered = new Set([...of('scan').flatMap(job => job.poolSlice), ...of('geStep').flatMap(job => job.pool)].map(p => p.id));
    if (win.reconciles !== 1) failed.push(`settings: the press checked the design for edits ${win.reconciles} times, not once`);
    if (win.initMessage?.type !== 'wasmInit' || !win.initMessage.wasmBytes) failed.push('settings: the workers were not sent the WASM kernel');
    if (offered.has('MgF2') || !offered.has('TiO2') || !offered.has('SiO2')) failed.push(`settings: the jobs offer ${[...offered].join(', ')}, not TiO2 and SiO2`);
    if (!of('scan').length || !of('scan').every(job => job.dMin === 12)) failed.push('settings: the scans do not take the window\'s min thickness');
    if (!of('candidate').length || !of('candidate').every(job => job.dlsIter === 12)) failed.push('settings: the candidates do not take the window\'s refine iterations');
    if (of('seedDls')[0]?.dlsIter !== 12) failed.push('settings: the seed is not refined, as the refine seed mode asks');
    if (!of('removePass').length || !of('removePass').every(job => job.tol === 0.2)) failed.push('settings: the consolidation does not take its tolerance');
    return failed;
}

// Nothing shown from a run the window has let go of (letGoFailures).
function verifyLetGo() {
    const win = makeWindow({ ...BASE, design: design() }, 'ge-guard-let-go');
    useWindow(win);
    const pools = [];
    win.ctx.makeWorkerPool = () => { const pool = makeWaitingPool(); pools.push(pool); return pool; };
    return withWindowSettings({}, () => letGoFailures(win, startWindowRun, pools));
}

const results = {};
for (const name of Object.keys(SCENARIOS)) results[name] = sorted(await runScenario(name));

if (UPDATE || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
    console.log(`${UPDATE ? 'Updated' : 'Created'} golden: ${GOLDEN} (${Object.keys(results).length} scenarios)`);
    process.exit(0);
}

const windowFailures = [
    ...Object.entries(WINDOW_TIMES).filter(([, ok]) => !ok).map(([name]) => `${name}: a later press's rows are timed before an earlier one's`),
    ...await verifyLetGo(),
    ...await verifySettingsReachRun(),
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
if (fails === 0) { console.log(`PASS ✅  Gradual Evolution runs identical to golden (${Object.keys(SCENARIOS).length} scenarios), window checks pass`); process.exit(0); }
console.log(`FAIL ❌  ${fails} failure(s)`);
process.exit(1);
