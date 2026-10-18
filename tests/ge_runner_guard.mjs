/**
 * Gradual Evolution run guard: a before/after identity check for a Gradual
 * Evolution run as the window sees it.
 *
 * Each scenario drives a run end to end against a fake Gradual Evolution
 * window (_geWindow.mjs): the ctx useGradualEvolution.js hands the run, and
 * the global `Worker` the run's pool is built from, which runs the real
 * synthesis-worker handlers job by job, or answers each job with a scripted
 * result so a run takes a fixed path through the forced steps, the layer-limit
 * swap and the consolidation. The guard snapshots what the window ends up
 * showing (the history rows, the status lines and phases in order, the readout,
 * the design and the run blocks, the run cache) and compares that to a
 * committed golden.
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
import { initWasmForTest } from './_wasmInit.mjs';

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
const { runGeWorker } = await import('../src/components/windows/optimization/gradualEvolution/runners/workerPool.js');
const { layer, makeWindow, settle, useWindow, withWindowSettings } = await import('./_geWindow.mjs');

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

async function runScenario(name) {
    const spec = { ...BASE, design: design(), ...SCENARIOS[name] };
    const id = `ge-guard-${name}`;
    const win = makeWindow(spec, id);
    useWindow(win);
    const presses = [];
    await withWindowSettings(spec.storage, async () => {
        for (const press of spec.presses) {
            win.press = press;
            if (press.maxGeCycles) win.ctx.maxGeCyclesRef.current = press.maxGeCycles;
            win.statuses = []; win.phases = [];
            runGeWorker(win.ctx);
            await settle(win);
            presses.push({ statuses: win.statuses, phases: win.phases, running: win.ctx.runningRef.current });
        }
    });
    const ctx = win.ctx;
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

// The snapshot with every object's keys sorted, so it compares what was shown,
// not the order the fields were filled in.
const sorted = v => (Array.isArray(v) ? v.map(sorted)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v);

const results = {};
for (const name of Object.keys(SCENARIOS)) results[name] = sorted(await runScenario(name));

if (UPDATE || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
    console.log(`${UPDATE ? 'Updated' : 'Created'} golden: ${GOLDEN} (${Object.keys(results).length} scenarios)`);
    process.exit(0);
}

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
let fails = 0;
for (const name of Object.keys(SCENARIOS)) {
    const a = JSON.stringify(golden[name]), b = JSON.stringify(results[name]);
    if (a !== b) {
        fails++;
        console.log(`DRIFT ❌  ${name}`);
        console.log(`   golden : ${a}`);
        console.log(`   current: ${b}`);
    }
}
if (fails === 0) { console.log(`PASS ✅  Gradual Evolution runs identical to golden (${Object.keys(SCENARIOS).length} scenarios)`); process.exit(0); }
console.log(`FAIL ❌  ${fails} failure(s)`);
process.exit(1);
