/**
 * A Structural run in Node (utils/structural/runStructural.js), refining on
 * the calling thread through InThreadOptimizerWorker, the optimizer job the
 * Web Worker runs.
 *
 *   1. A broadband AR from TiO2 30 / SiO2 50 nm: the run ends on its own, its
 *      rows are numbered from 0 with the starting design first, the same seed
 *      repeats the run, and the answer is the design of its last row.
 *   2. Settings: unknown ones and values the run cannot take are refused, and
 *      the defaults are the window's.
 *   3. Stop before the run starts and while it runs; hooks that throw; a run
 *      that cannot start.
 *   4. A run that carries on a history numbers its rows and trend on from it
 *      and records no starting row.
 *
 * Run: node tests/structural_headless.mjs
 */
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { MUTATION_KINDS } = await import('../src/utils/synthesis/structuralOptimizer.js');
const { ENGINE_DEFAULTS, SMART_SEED_DEFAULTS, defaultThreadCount } = await import('../src/utils/synthesis/synthesisConfig.js');
const { runStructural } = await import('../src/utils/structural/runStructural.js');
const { planRun, STRUCTURAL_DEFAULTS } = await import('../src/utils/structural/settings.js');
const { prepare } = await import('../src/utils/structural/setup.js');
const { InThreadOptimizerWorker } = await import('../src/utils/workers/inThreadOptimizerWorker.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const throws = (fn, pattern) => { try { fn(); return false; } catch (err) { return pattern.test(err.message); } };

const quiet = { log: console.log, warn: console.warn, error: console.error };
const silence = () => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => Object.assign(console, quiet);

const POOL = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
const OPS = caseById('bbar').ops.map((op, i) => ({ ...op, id: `op${i}`, enabled: true }));
const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
const seedDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: [layer('L0', 'TiO2', 30), layer('L1', 'SiO2', 50)],
});
const SETTINGS = { pool: POOL, maxIter: 5, refineIter: 10, threads: 2, seed: 99, targetMF: 0, T0: 0.3, addMaxNm: 200 };

// Workers on the calling thread, counted as they are built and ended.
function countedWorkers(counter) {
    return () => {
        const worker = new InThreadOptimizerWorker();
        counter.built++;
        const end = worker.terminate.bind(worker);
        worker.terminate = () => { counter.ended++; end(); };
        return worker;
    };
}

async function runOnce(settings = SETTINGS, hooks = {}, design = seedDesign()) {
    const counter = { built: 0, ended: 0 };
    const rows = [], trend = [];
    silence();
    try {
        const result = await runStructural(design, OPS, settings, {
            makeWorker: countedWorkers(counter),
            onRow: row => rows.push(row),
            onProgress: p => { if (p.trend) trend.push(p.trend.iter); },
            ...hooks,
        });
        return { result, rows, trend, counter };
    } finally { loud(); }
}

// ── 1. A run ────────────────────────────────────────────────────────────────
const A = await runOnce();
const B = await runOnce();
console.log(`=== Structural run in Node ===\n  end: ${A.result.stopReason}, rows: ${A.rows.map(r => `${r.genNum}:${r.kind}`).join(',')}`);
ok('a completed run ends on its iteration limit', A.result.completed && A.result.stopReason === 'maxIter' && A.result.iters === 5,
    `${A.result.stopReason} after ${A.result.iters}`);
ok('it builds its workers once and ends each of them once', A.counter.built === 2 && A.counter.ended === 2,
    `${A.counter.built} built, ${A.counter.ended} ended`);
ok('rows are numbered from 0, the starting design first', A.rows[0]?.genNum === 0 && A.rows[0]?.kind === 'baseline'
    && A.rows.every((r, i) => r.genNum === i), A.rows.map(r => r.genNum).join(','));
ok('every row records the seed', A.rows.every(r => r.seed === 99) && A.result.seed === 99);
ok('the answer is the design of the last row', JSON.stringify(A.result.frontLayers) === JSON.stringify(A.rows.at(-1).frontSnap)
    && A.result.mf <= A.rows.at(-1).mf + 1e-12);
ok('the same seed repeats the run', JSON.stringify(A.rows.map(r => [r.kind, r.mf])) === JSON.stringify(B.rows.map(r => [r.kind, r.mf])));
ok('it reports the optical merit of its answer', Number.isFinite(A.result.omf), String(A.result.omf));

// ── 2. Settings ─────────────────────────────────────────────────────────────
ok('an unknown setting is refused', throws(() => planRun({ ...SETTINGS, maxIters: 5 }), /unknown setting 'maxIters'/));
ok('an unknown history field is refused', throws(() => planRun({ ...SETTINGS, history: { trendIters: 2 } }), /unknown history field 'trendIters'/));
ok('an iteration limit of 0 is refused', throws(() => planRun({ ...SETTINGS, maxIter: 0 }), /maxIter/));
ok('an empty list of kinds is refused', throws(() => planRun({ ...SETTINGS, kinds: [] }), /kinds/));
ok('an unknown kind is refused', throws(() => planRun({ ...SETTINGS, kinds: ['swap'] }), /kinds/));
ok('a seed of 0 is refused', throws(() => planRun({ ...SETTINGS, seed: 0 }), /seed/));
ok('a null seed asks for a fresh one', planRun({ ...SETTINGS, seed: null }).seed === null);
ok('0 refine iterations score proposals as they are', planRun({ ...SETTINGS, refineIter: 0 }).refineIter === 0);
ok('a starting temperature of 0 is taken', planRun({ ...SETTINGS, T0: 0 }).T0 === 0);
// The run's defaults, which the window's fields start from too
// (useStructuralOptimizer.js), and the synthesis settings' defaults.
const plan = planRun({ pool: POOL });
const WINDOW_DEFAULTS = {
    maxIter: 80, targetMF: 5e-4, T0: 0.3, jitterPct: 0.15, refineIter: 60, dMin: 1, addMaxNm: 500, maxLayers: 80,
    deepSearch: false, deepMaxMin: 0, seed: null,
    innerEngine: ENGINE_DEFAULTS.structural, smartSeed: SMART_SEED_DEFAULTS.structural, threads: defaultThreadCount(),
};
const offDefault = Object.keys(WINDOW_DEFAULTS).filter(key => plan[key] !== WINDOW_DEFAULTS[key]);
ok(`the defaults are the window's (${offDefault.join(', ') || 'all'})`, offDefault.length === 0
    && MUTATION_KINDS.every(kind => plan.kinds.has(kind)) && Object.keys(STRUCTURAL_DEFAULTS).every(key => key in WINDOW_DEFAULTS));
{
    // The strictest MNT row is the floor and the strictest MXT row the ceiling;
    // a row switched off counts for nothing.
    const bound = (type, target, enabled = true) => ({ type, target, weight: 1, id: `${type}${target}`, enabled });
    const rows = [...OPS, bound('MNT', 20), bound('MNT', 30), bound('MNT', 45, false), bound('MXT', 200), bound('MXT', 150), bound('MXT', 60, false)];
    silence();
    const prep = prepare(seedDesign(), rows, planRun({ ...SETTINGS, dMin: 5 }));
    loud();
    ok('the strictest enabled MNT and MXT rows bound the layers', prep.dMin === 30 && prep.dMax === 150, `${prep.dMin}..${prep.dMax}`);
    ok('a disabled row is left out', prep.enabled.length === OPS.length + 4 && prep.enabled.every(o => o.enabled));
}
let refused = false;
try { await runStructural(seedDesign(), OPS, SETTINGS, {}); } catch (err) { refused = /makeWorker/.test(err.message); }
ok('a run without a worker factory is refused', refused);

// ── 3. Stop, hooks that throw, a run that cannot start ──────────────────────
{
    const stop = new AbortController();
    stop.abort();
    let built = false;
    const before = await runStructural(seedDesign(), OPS, SETTINGS, { signal: stop.signal, makeWorker: () => { built = true; } });
    ok('a run stopped before it starts builds no worker', before.stopReason === 'stopped' && !built && before.frontLayers === null);
}
{
    const stop = new AbortController();
    const during = await runOnce(SETTINGS, { signal: stop.signal, onRow: row => { if (row.genNum === 1) stop.abort(); } });
    ok('a run stopped while it runs ends stopped, without an answer', during.result.stopReason === 'stopped'
        && during.result.frontLayers === null && !during.result.completed);
    ok('its workers are ended once each', during.counter.ended === during.counter.built, `${during.counter.ended} of ${during.counter.built}`);
}
for (const hook of ['onStart', 'onProgress']) {
    const counter = { built: 0, ended: 0 };
    let rejected = false;
    silence();
    try {
        await runStructural(seedDesign(), OPS, SETTINGS, {
            makeWorker: countedWorkers(counter), [hook]: () => { throw new Error(`${hook} threw`); },
        });
    } catch (err) { rejected = err.message === `${hook} threw`; } finally { loud(); }
    ok(`a run whose ${hook} throws at the start rejects and ends its workers`, rejected && counter.ended === counter.built && counter.built > 0);
}
{
    const thrown = await runOnce(SETTINGS, { onRow: row => { if (row.genNum === 1) throw new Error('onRow threw'); } });
    ok('a run whose onRow throws while it runs ends with the error', thrown.result.stopReason === 'workerError'
        && thrown.result.message === 'onRow threw' && thrown.counter.ended === thrown.counter.built, JSON.stringify(thrown.result));
}
{
    const noOps = await runStructural(seedDesign(), [], SETTINGS, { makeWorker: () => new InThreadOptimizerWorker() });
    ok('a run without operands does not start', noOps.stopReason === 'noOperands');
    const noPool = await runStructural(seedDesign(), OPS, { ...SETTINGS, pool: [], kinds: ['add'] }, { makeWorker: () => new InThreadOptimizerWorker() });
    ok('a run that can only grow, with no pool, does not start', noPool.stopReason === 'noMaterials');
    const keeps = await runOnce({ ...SETTINGS, pool: [], maxIter: 2 });
    ok('with no pool a run still removes, merges and perturbs', keeps.result.completed, keeps.result.stopReason);
    const partly = { built: 0, ended: 0 };
    const counted = countedWorkers(partly);
    let calls = 0;
    silence();
    const unbuilt = await runStructural(seedDesign(), OPS, SETTINGS, {
        makeWorker: () => { if (++calls === 2) throw new Error('no second worker'); return counted(); },
    });
    loud();
    ok('workers built before one that fails are ended', unbuilt.stopReason === 'workerFailed' && partly.built === 1 && partly.ended === 1,
        `${partly.built} built, ${partly.ended} ended`);
    silence();
    const noWorkers = await runStructural(seedDesign(), OPS, SETTINGS, { makeWorker: () => { throw new Error('no workers'); } });
    loud();
    ok('a run whose workers cannot be built does not start', noWorkers.stopReason === 'workerFailed');
}

// ── 4. A history carried on ─────────────────────────────────────────────────
{
    const carried = await runOnce({ ...SETTINGS, history: { genNum: 4, hasRows: true, elapsedMs: 1000, trendIter: 7 } });
    ok('rows are numbered on from the history', carried.rows[0]?.genNum === 5, String(carried.rows[0]?.genNum));
    ok('a history that has rows gets no starting row', !carried.rows.some(r => r.kind === 'baseline' || r.kind === 'seed'));
    ok('the trend runs on from the history', carried.trend[0] === 7 && carried.trend[1] === 8, JSON.stringify(carried.trend.slice(0, 3)));
    ok('time runs on from the history', carried.rows.every(r => r.tMs >= 1000));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
