/**
 * Needle run guard: a before/after identity check for a Needle Automatic run as
 * the window sees it.
 *
 * Each scenario drives a run end to end against a fake Needle window `ctx` and
 * an in-process pool that runs the real synthesis-worker handlers
 * (dispatchSynthesisJob) one job after another, so the run is deterministic in
 * Node. It snapshots what the window ends up showing: the generation rows, the
 * status lines and phases in order, the readout, the design and the run blocks,
 * and compares that to a committed golden.
 *
 * Determinism:
 *  - The pool size comes from the thread setting, fixed here at 3.
 *  - Date.now is frozen, so the live-preview throttle passes the first tick of
 *    a run and no other, whatever the machine's speed.
 *  - performance.now advances one millisecond per reading, so a worker's live
 *    previews and the rows' times fall at the same points on any machine.
 *  - Row ids, layer ids and times (tMs) are left out of the snapshot.
 *
 *   Update baseline (after a verified intentional change):  node tests/needle_runner_guard.mjs --update
 *   Run the guard:                                          node tests/needle_runner_guard.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, 'needle_runner_guard.golden.json');
const UPDATE = process.argv.includes('--update');

const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { runNeedleWorkerPool } = await import('../src/components/windows/optimization/needleVariation/runners/workerPool.js');
const { dispatchSynthesisJob } = await import('../src/utils/workers/synthesisWorker.js');
const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');
const { default: EN } = await import('../src/constants/locales/en.js');

const FROZEN_NOW = 1e12;
Date.now = () => FROZEN_NOW;
let clock = 0;
performance.now = () => ++clock;

// Window settings that live in local storage, set per scenario and cleared after.
const STORAGE = {
    threads: 'tfstudio-worker-threads',
    engine: 'tfstudio-synth-inner-engine-needle',
    smartSeed: 'tfstudio-synth-smart-seed-needle',
    candMode: 'tfstudio-synth-cand-batches',
    sensitivity: 'tfstudio-needle-sensitivity',
};

const mat = id => ({ id, name: id, mat: getMaterial(id) });
const POOL_TSM = ['TiO2', 'SiO2', 'MgF2'].map(mat);
const POOL_TS = ['TiO2', 'SiO2'].map(mat);
const BBAR = caseById('bbar').ops;
const REFLECTOR = [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 })];
const MNT = makeOperand({ type: 'MNT', target: 30, weight: 1 });

const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
const design = (extra = {}) => ({
    id: 'guard-design',
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [layer('S', 'SiO2', 100)], backLayers: [],
    surfaceMode: 'front_only', mfEvalMode: 'side',
    ...extra,
});

const BASE = { ops: BBAR, pool: POOL_TSM, maxLayers: 6, deltaNm: 0.5, dMin: 1, dlsIter: 30, targetMF: 1e-4 };

// Each scenario is one or more Run presses on one window.
const SCENARIOS = {
    plain: { presses: [{}] },
    regridAndRescue: { ops: REFLECTOR, pool: POOL_TS, dlsIter: 8, targetMF: 1e-6, presses: [{}] },
    smartSeed: { maxLayers: 5, storage: { smartSeed: '1' }, presses: [{}] },
    bothSides: {
        maxLayers: 4,
        design: design({ surfaceMode: 'both_independent', mfEvalMode: 'total', backLayers: [layer('B', 'SiO2', 100)] }),
        presses: [{}],
    },
    backOnly: {
        maxLayers: 4,
        design: design({ surfaceMode: 'back_only', mfEvalMode: 'total', frontLayers: [], backLayers: [layer('B', 'SiO2', 100)] }),
        presses: [{}],
    },
    sqpThorough: { maxLayers: 5, storage: { engine: 'sqp', candMode: 'thorough', sensitivity: 'medium' }, presses: [{}] },
    targetStop: { targetMF: 0.02, presses: [{}] },
    mntDropped: { ops: [...BBAR, MNT], presses: [{}] },
    secondPress: { presses: [{ maxLayers: 3 }, { maxLayers: 5 }] },
    stopThenRun: { presses: [{ stopAtMap: 3 }, {}] },
    errorAfterProgress: { presses: [{ failAtMap: 4 }] },
    noOperands: { ops: BBAR.map(op => ({ ...op, enabled: false })), presses: [{}] },
    noMaterials: { pool: [], presses: [{}] },
    // A pool that cannot be built, or that fails before the run has shown
    // anything, ends the run with the design as it was.
    poolNotBuilt: { presses: [{ poolThrows: true }] },
    failsAtFirstScan: { presses: [{ failAtMap: 1 }] },
    presampleFails: { pool: [...POOL_TSM, { id: 'Broken', name: 'Broken', mat: { getNK() { throw new Error('no data'); } } }], presses: [{}] },
    // A smart seed is on screen once it is refined, and so is a seed's live
    // preview, so a failure after either is a failure after progress.
    failsAfterSeed: { maxLayers: 5, storage: { smartSeed: '1' }, presses: [{ failAtMap: 2 }] },
    failsDuringSeed: { maxLayers: 5, storage: { smartSeed: '1' }, presses: [{ previewThenFailAtMap: 1 }] },
};

// A seed's in-flight design, as a worker's live preview sends it.
const PREVIEW = [layer('P1', 'TiO2', 60), layer('P2', 'SiO2', 90)];

// The in-process pool. `press.stopAtMap` presses Stop while the nth map call is
// in flight, as a real pool's terminate() would, `press.failAtMap` makes the
// nth map call fail, `press.previewThenFailAtMap` sends one live preview first,
// and `press.poolThrows` makes building the pool throw.
function makePool(win, press) {
    if (press.poolThrows) throw new Error('no workers');
    return {
        map(jobs, onProgress) {
            win.maps++;
            if (win.maps === press.stopAtMap) {
                win.ctx.stopOpt('');
                return Promise.reject(new Error('pool terminated'));
            }
            if (win.maps === press.failAtMap) return Promise.reject(new Error('the pool failed'));
            if (win.maps === press.previewThenFailAtMap) {
                onProgress(0, { type: 'tick', mf: 0.5, omf: 0.5, frontLayers: PREVIEW, backLayers: [], layers: PREVIEW });
                return Promise.reject(new Error('the pool failed'));
            }
            return Promise.all(jobs.map((job, i) => new Promise((resolve, reject) => {
                win.jobs[job.type] = (win.jobs[job.type] || 0) + 1;
                const post = (m) => {
                    if (m.type === 'tick') { onProgress && onProgress(i, m); return; }
                    if (m.type === 'error') { reject(new Error(m.message)); return; }
                    resolve(m);
                };
                try { dispatchSynthesisJob(job, makeResolveMat(job.materials || {}, 'guard'), post); }
                catch (e) { reject(e); }
            })));
        },
        terminate() { win.terminated++; },
    };
}

// A fake Needle window: the refs and setters useNeedleVariation.js builds, its
// Stop, and a recorder for what the window shows.
function makeWindow(spec) {
    const ref = current => ({ current });
    const win = {
        maps: 0, jobs: {}, terminated: 0,
        statuses: [], phases: [], shown: {}, applied: null, press: null,
    };
    const push = (list, v) => { if (list[list.length - 1] !== v) list.push(v); };
    const show = key => v => { win.shown[key] = v; };
    const ctx = {
        runningRef: ref(false), workerRef: ref(null),
        baseDesignRef: ref(null), savedDesignRef: ref(null), designRef: ref(spec.design || design()),
        operandsRef: ref(spec.ops.map(op => ({ enabled: true, ...op }))),
        gensRef: ref([]), genCountRef: ref(0),
        runsRef: ref([]), runOpenRef: ref(false),
        maxLayersRef: ref(spec.maxLayers), deltaNmRef: ref(spec.deltaNm), dMinRef: ref(spec.dMin),
        dlsIterRef: ref(spec.dlsIter), targetMFRef: ref(spec.targetMF),
        selectedCatsRef: ref([]), excludedMatsRef: ref(new Set()),
        updateDesignRef: ref((patch, opts) => {
            win.applied = { ...(win.applied || {}), ...patch };
            win.designUpdates = (win.designUpdates || 0) + 1;
            ctx.designRef.current = { ...ctx.designRef.current, ...patch };
            if (!opts?.transient) win.edits = (win.edits || 0) + 1;
        }),
        checkpointRef: ref(() => { win.checkpoints = (win.checkpoints || 0) + 1; }),
        setPhase: p => push(win.phases, p),
        setStatusMsg: m => push(win.statuses, m),
        setMf: show('mf'), setMfBest: show('mfBest'), setOmf: show('omf'), setOmfBest: show('omfBest'),
        setLayerCount: show('layerCount'), setCanReset: show('canReset'), setGeneration: show('generation'),
        setGenerations: v => { win.shown.rows = v.length; },
        setTopDesigns: v => { win.shown.top = v.map(g => g.genNum); },
        reconcileBaseWithEdits: () => {},
        getPoolMaterials: () => spec.pool,
        setCachedOptState: (id, cached) => { win.cached = { id, rows: cached.generations.length, runs: cached.runs.length }; },
        t: EN,
        makeWorkerPool: () => makePool(win, win.press),
    };
    // useNeedleVariation.js stopOpt + needleLifecycle.js teardownRun.
    ctx.stopOpt = (msg = '') => {
        const wasRunning = ctx.runningRef.current;
        ctx.runningRef.current = false;
        if (ctx.workerRef.current) {
            try { ctx.workerRef.current.terminate(); } catch (_) {}
            ctx.workerRef.current = null;
        }
        ctx.setPhase('idle');
        if (msg || wasRunning) ctx.setStatusMsg(msg);
    };
    win.ctx = ctx;
    return win;
}

async function settle(win) {
    for (let i = 0; i < 10000 && win.ctx.runningRef.current; i++) await new Promise(r => setTimeout(r, 1));
    await new Promise(r => setTimeout(r, 5));
}

const layersOf = arr => (arr || []).map(l => [l.material, l.thickness]);
const rowOf = g => {
    const { id, tMs, layers, frontSnap, backSnap, ...rest } = g;
    return { ...rest, layers: layersOf(layers), frontSnap: layersOf(frontSnap), backSnap: layersOf(backSnap) };
};

async function runScenario(name) {
    const spec = { ...BASE, ...SCENARIOS[name] };
    for (const [key, value] of Object.entries({ threads: '3', ...(spec.storage || {}) })) localStorage.setItem(STORAGE[key], value);
    const win = makeWindow(spec);
    const presses = [];
    const quiet = console.log, quietErr = console.error;
    console.log = () => {}; console.error = () => {};
    try {
        for (const press of spec.presses) {
            win.press = press;
            if (press.maxLayers) win.ctx.maxLayersRef.current = press.maxLayers;
            win.statuses = []; win.phases = [];
            runNeedleWorkerPool(win.ctx);
            await settle(win);
            presses.push({ statuses: win.statuses, phases: win.phases, running: win.ctx.runningRef.current });
        }
    } finally {
        console.log = quiet; console.error = quietErr;
        for (const key of Object.values(STORAGE)) localStorage.removeItem(key);
    }
    const ctx = win.ctx;
    return {
        presses,
        rows: ctx.gensRef.current.map(rowOf),
        shown: win.shown,
        design: win.applied && { front: layersOf(win.applied.frontLayers), back: layersOf(win.applied.backLayers) },
        base: ctx.baseDesignRef.current && { front: layersOf(ctx.baseDesignRef.current.frontLayers), back: layersOf(ctx.baseDesignRef.current.backLayers) },
        saved: ctx.savedDesignRef.current && layersOf(ctx.savedDesignRef.current.frontLayers),
        runs: ctx.runsRef.current.map(r => ({ runNum: r.runNum, baseline: layersOf(r.baseline?.frontLayers) })),
        runOpen: ctx.runOpenRef.current,
        genCount: ctx.genCountRef.current,
        cached: win.cached || null,
        checkpoints: win.checkpoints || 0,
        edits: win.edits || 0,
        designUpdates: win.designUpdates || 0,
        jobs: win.jobs,
        maps: win.maps,
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
if (fails === 0) { console.log(`PASS ✅  Needle runs identical to golden (${Object.keys(SCENARIOS).length} scenarios)`); process.exit(0); }
console.log(`FAIL ❌  ${fails} scenario(s) drifted`);
process.exit(1);
