/**
 * Needle run guard: a before/after identity check for a Needle Automatic run as
 * the window sees it, utils/needle/runNeedle.js started and shown by the
 * window's windowRun.js.
 *
 * Each scenario drives a run end to end against a fake Needle window `ctx`
 * (_needleWindow.mjs) and an in-process pool that runs the real synthesis-worker handlers
 * (dispatchSynthesisJob) one job after another, so the run is deterministic in
 * Node. It snapshots what the window ends up showing: the generation rows, the
 * status lines and phases in order, the readout, the design and the run blocks,
 * and compares that to a committed golden. Beside the golden it checks what the
 * window must show whatever the golden holds: a closing row on screen and in
 * the readout, time running on across presses, and nothing shown from a run
 * the window has let go of.
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
import { timeRunsOn, sorted, letGoFailures } from './_windowRunChecks.mjs';

shimBrowserGlobals();
await initWasmForTest();

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, 'needle_runner_guard.golden.json');
const UPDATE = process.argv.includes('--update');

const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { startWindowRun } = await import('../src/components/windows/optimization/needleVariation/windowRun.js');
const { layer, makeWindow, makeWaitingPool, settle, withWindowSettings } = await import('./_needleWindow.mjs');

const FROZEN_NOW = 1e12;
Date.now = () => FROZEN_NOW;
let clock = 0;
performance.now = () => ++clock;

const mat = id => ({ id, name: id, mat: getMaterial(id) });
const POOL_TSM = ['TiO2', 'SiO2', 'MgF2'].map(mat);
const POOL_TS = ['TiO2', 'SiO2'].map(mat);
const BBAR = caseById('bbar').ops;
const REFLECTOR = [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 })];
const MNT = makeOperand({ type: 'MNT', target: 30, weight: 1 });

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

const layersOf = arr => (arr || []).map(l => [l.material, l.thickness]);
const rowOf = g => {
    const { id, tMs, layers, frontSnap, backSnap, ...rest } = g;
    return { ...rest, layers: layersOf(layers), frontSnap: layersOf(frontSnap), backSnap: layersOf(backSnap) };
};

async function runScenario(name) {
    const spec = { ...BASE, design: design(), ...SCENARIOS[name] };
    const win = makeWindow(spec);
    const presses = [], rowCounts = [];
    await withWindowSettings(spec.storage, async () => {
        for (const press of spec.presses) {
            win.press = press;
            if (press.maxLayers) win.ctx.maxLayersRef.current = press.maxLayers;
            win.statuses = []; win.phases = [];
            await startWindowRun(win.ctx);
            await settle(win);
            presses.push({ statuses: win.statuses, phases: win.phases, running: win.ctx.runningRef.current });
            rowCounts.push(win.ctx.gensRef.current.length);
        }
    });
    const ctx = win.ctx;
    WINDOW_TIMES[name] = timeRunsOn(rowCounts, ctx.gensRef.current);
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
        checkpoints: win.checkpoints,
        edits: win.edits,
        designUpdates: win.designUpdates,
        jobs: win.jobs,
        maps: win.maps,
        terminated: win.terminated,
    };
}

// ── What the window must show, whatever the golden holds ─────────────────────

// Whether each scenario's rows are timed on across its presses (runScenario).
const WINDOW_TIMES = {};

// The scenarios that must end on a closing row: a winner no accepted row
// shows. In secondPress it is the design a thin-start rescue set aside, which
// differs from the row before it, so it is on screen only if the window put it
// there. A run whose grid grows at its end also closes on a row, its winner
// re-scored on the new grid; any scenario that ends on a closing row is held to
// the same checks.
const CLOSING = ['secondPress'];

// Each closing row is what the readout and the design on screen show. Each
// press of a scenario is timed on from the presses before it.
function windowChecks(results) {
    const failed = [];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const sameDesign = (row, d) => row && same(d?.front, row.frontSnap) && same(d?.back, row.backSnap);
    const closing = Object.keys(results).filter(name => results[name].rows?.at(-1)?.final);
    for (const name of CLOSING) if (!closing.includes(name)) failed.push(`${name}: the run does not end on a closing row`);
    for (const name of closing) {
        const r = results[name], row = r.rows.at(-1);
        if (r.shown.mf !== row.mf) failed.push(`${name}: the readout shows ${r.shown.mf}, the closing row ${row.mf}`);
        if (!sameDesign(row, r.design)) failed.push(`${name}: the design on screen is not the closing row's`);
    }
    const before = results.secondPress.rows.at(-2);
    if (sameDesign(before, { front: results.secondPress.rows.at(-1)?.frontSnap, back: results.secondPress.rows.at(-1)?.backSnap })) {
        failed.push('secondPress: its closing row repeats the row before it, so the design check proves nothing');
    }
    for (const [name, ok] of Object.entries(WINDOW_TIMES)) if (!ok) failed.push(`${name}: a later press's rows are timed before an earlier one's`);
    return failed;
}

// Nothing shown from a run the window has let go of (letGoFailures).
function verifyLetGo() {
    const win = makeWindow({ ...BASE, design: design() });
    const pools = [];
    win.ctx.makeWorkerPool = () => { const pool = makeWaitingPool(); pools.push(pool); return pool; };
    return withWindowSettings({ smartSeed: '1' }, () => letGoFailures(win, startWindowRun, pools));
}

const results = {};
for (const name of Object.keys(SCENARIOS)) results[name] = sorted(await runScenario(name));

if (UPDATE || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
    console.log(`${UPDATE ? 'Updated' : 'Created'} golden: ${GOLDEN} (${Object.keys(results).length} scenarios)`);
    process.exit(0);
}

const windowFailures = [...windowChecks(results), ...await verifyLetGo()];
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
if (fails === 0) { console.log(`PASS ✅  Needle runs identical to golden (${Object.keys(SCENARIOS).length} scenarios), window checks pass`); process.exit(0); }
console.log(`FAIL ❌  ${fails} failure(s)`);
process.exit(1);
