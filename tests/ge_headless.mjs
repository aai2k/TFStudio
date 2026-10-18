/**
 * A Gradual Evolution run in Node (utils/gradualEvolution/runGradualEvolution.js),
 * on an in-process pool that runs the real `dispatchSynthesisJob` handlers one
 * job after another (the code the Web Worker runs), so the run is
 * deterministic.
 *
 *   1. A broadband AR from TiO2 30 / SiO2 50 nm: the run ends on its own, its
 *      rows are numbered from 1 with the seed first, two runs agree, and the
 *      answer is a design one of its rows shows.
 *   2. Settings: unknown ones and values the run cannot take are refused, and
 *      the defaults are the window's.
 *   3. Stop before the run starts and while it runs; a hook that throws as the
 *      run starts.
 *   4. A run that carries on a history numbers its rows and GE steps on from
 *      it and records no seed row.
 *   5. A target of Infinity ends the run at its first accepted step.
 *
 * Run: node tests/ge_headless.mjs
 */
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest, tmmWasmActive } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const O = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { runGradualEvolution } = await import('../src/utils/gradualEvolution/runGradualEvolution.js');
const { planRun } = await import('../src/utils/gradualEvolution/settings.js');
const { defaultThreadCount } = await import('../src/utils/synthesis/synthesisConfig.js');
const { dispatchSynthesisJob } = await import('../src/utils/workers/synthesisWorker.js');
const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const throws = (fn, pattern) => { try { fn(); return false; } catch (err) { return pattern.test(err.message); } };

const _log = console.log;
console.log = () => {};

const POOL = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
const ARC = [O.makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 })];
const seedDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: [['TiO2', 30], ['SiO2', 50]].map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false })),
});
const SETTINGS = { pool: POOL, maxLayers: 8, maxGeCycles: 4, targetMF: 1e-6, refineIter: 10, dMin: 15, threads: 3 };

// The in-process pool: jobs answer as they are posted. It counts the jobs it
// runs and the times it is terminated, and keeps the jobs.
function makePool(counter) {
    const runJob = (job, onTick) => new Promise((resolve, reject) => {
        counter.n++;
        counter.jobs.push(job);
        dispatchSynthesisJob(job, makeResolveMat(job.materials || {}, 'headless'), m => {
            if (m.type === 'tick') { onTick?.(m); return; }
            if (m.type === 'error') reject(new Error(m.message)); else resolve(m);
        });
    });
    return {
        map: (jobs, onProgress) => Promise.all(jobs.map((job, i) => runJob(job, onProgress && (m => onProgress(i, m))))),
        run: (job, onProgress) => runJob(job, onProgress),
        terminate() { counter.terminated++; },
    };
}

async function runOnce(settings = SETTINGS, hooks = {}) {
    const counter = { n: 0, terminated: 0, jobs: [] };
    const rows = [];
    let geSteps = 0;
    const result = await runGradualEvolution(seedDesign(), ARC, settings, {
        makeWorkerPool: () => makePool(counter),
        onRow: (row, info) => { if (info.replacesLast) rows[rows.length - 1] = row; else rows.push(row); },
        onProgress: p => { if ('geSteps' in p) geSteps = p.geSteps; },
        ...hooks,
    });
    return { result, rows, counter, geSteps };
}

// ── 1. A run ────────────────────────────────────────────────────────────────
const A = await runOnce();
const B = await runOnce();
console.log = _log;
console.log(`=== Gradual Evolution run in Node · WASM ${tmmWasmActive() ? 'ON' : 'off'} ===`);
console.log(`  jobs run: ${A.counter.n}, end: ${A.result.stopReason}, rows: ${A.rows.map(r => r.type).join(',')}`);
console.log = () => {};

ok('a completed run with its stop reason', A.result.completed && ['target', 'maxGeCycles', 'stuck'].includes(A.result.stopReason),
    A.result.stopReason);
ok('the pool ran the jobs, and was terminated once', A.counter.n > 0 && A.counter.terminated === 1);
ok('rows are numbered from 1, the starting design first', A.rows[0]?.genNum === 1 && A.rows[0]?.type === 'baseline'
    && A.rows.every((r, i) => r.genNum === i + 1), A.rows.map(r => `${r.genNum}:${r.type}`).join(','));
ok('the run took forced steps and needles', A.rows.some(r => r.type === 'ge') && A.rows.some(r => r.type === 'needle'));
// A row keeps the merit of the grid it was recorded on, so the answer is
// matched to a row by its design.
const stackOf = layers => JSON.stringify((layers || []).map(l => [l.material, l.thickness]));
const answerRow = A.rows.find(r => stackOf(r.frontSnap) === stackOf(A.result.frontLayers));
ok('the answer is a design one of its rows shows', !!answerRow && Number.isFinite(A.result.mf));
ok('deterministic run-to-run', JSON.stringify(A.rows.map(r => [r.type, r.mf, r.layerCount]))
    === JSON.stringify(B.rows.map(r => [r.type, r.mf, r.layerCount])));
ok('the result carries the GE steps the run reported', A.result.geSteps > 0 && A.result.geSteps === A.geSteps,
    `${A.result.geSteps} vs ${A.geSteps}`);
{
    // Preserve bulk, the default seed mode, keeps the seed as it is and
    // refines each step gently (synthesisConfig/seedMode.js).
    const bulk = await runOnce({ ...SETTINGS, refineIter: 30 });
    const of = type => bulk.counter.jobs.filter(job => job.type === type);
    ok('preserve bulk: the seed is scored, not refined', of('seedDls')[0]?.dlsIter === 0);
    ok('preserve bulk: each candidate is refined at most 15 iterations', of('candidate').length > 0
        && of('candidate').every(job => job.dlsIter === 15), JSON.stringify([...new Set(of('candidate').map(job => job.dlsIter))]));
}

// ── 2. Settings ─────────────────────────────────────────────────────────────
ok('an unknown setting is refused', throws(() => planRun({ ...SETTINGS, maxGeCycle: 4 }), /unknown setting 'maxGeCycle'/));
ok('an unknown history field is refused', throws(() => planRun({ ...SETTINGS, history: { gesteps: 2 } }), /unknown history field 'gesteps'/));
ok('a GE-step budget of 0 is refused', throws(() => planRun({ ...SETTINGS, maxGeCycles: 0 }), /maxGeCycles/));
ok('a target of 0 is taken', planRun({ ...SETTINGS, targetMF: 0 }).targetMF === 0);
ok('an unknown seed mode is refused', throws(() => planRun({ ...SETTINGS, seedMode: 'thick' }), /seedMode/));
ok('a pool entry without its material is refused', throws(() => planRun({ pool: [{ id: 'X', name: 'X', mat: null }] }), /pool/));
// The window's fields start from these too (useGradualEvolution.js).
const plan = planRun({ pool: POOL });
const WINDOW_DEFAULTS = {
    maxLayers: 50, maxGeCycles: 16, targetMF: 5e-4, refineIter: 30, dMin: 15, deepSearch: false,
    innerEngine: 'cg', maxBatches: 2, sensFloor: 0, smartSeed: true, preserveBulk: true,
    consolidate: true, consolidateTol: 0.05, threads: defaultThreadCount(),
};
const offDefault = Object.keys(WINDOW_DEFAULTS).filter(key => plan[key] !== WINDOW_DEFAULTS[key]);
ok(`the defaults are the window's (${offDefault.join(', ') || 'all'})`, offDefault.length === 0);
let refused = false;
try { await runGradualEvolution(seedDesign(), ARC, SETTINGS, {}); } catch (err) { refused = /makeWorkerPool/.test(err.message); }
ok('a run without a pool factory is refused', refused);

// ── 3. Stop ─────────────────────────────────────────────────────────────────
{
    const stop = new AbortController();
    stop.abort();
    let built = false;
    const before = await runGradualEvolution(seedDesign(), ARC, SETTINGS, { signal: stop.signal, makeWorkerPool: () => { built = true; } });
    ok('a run stopped before it starts builds no pool', before.stopReason === 'stopped' && !built && before.frontLayers === null);
}
{
    const stop = new AbortController();
    const during = await runOnce(SETTINGS, { signal: stop.signal, onRow: (row) => { if (row.genNum === 3) stop.abort(); } });
    ok('a run stopped while it runs ends stopped, without an answer', during.result.stopReason === 'stopped'
        && during.result.frontLayers === null && !during.result.completed);
    ok('its pool is terminated once', during.counter.terminated === 1);
}
{
    // A hook that throws from a step of the run ends it as a failing pool
    // does: after the run reported a design, with the error's message.
    const _error = console.error;
    console.error = () => {};
    const thrown = await runOnce(SETTINGS, { onRow: row => { if (row.genNum === 3) throw new Error('onRow threw'); } });
    console.error = _error;
    ok('a run whose onRow throws while it runs ends with the error', thrown.result.stopReason === 'workerError'
        && thrown.result.message === 'onRow threw' && thrown.counter.terminated === 1, JSON.stringify(thrown.result));
}
for (const hook of ['onStart', 'onProgress']) {
    // A caller's hook that throws as the run starts ends the run, and its
    // pool goes with it.
    const counter = { n: 0, terminated: 0 };
    let rejected = false;
    try {
        await runGradualEvolution(seedDesign(), ARC, SETTINGS, {
            makeWorkerPool: () => makePool(counter),
            [hook]: () => { throw new Error(`${hook} threw`); },
        });
    } catch (err) { rejected = err.message === `${hook} threw`; }
    ok(`a run whose ${hook} throws at the start rejects and terminates its pool`, rejected && counter.terminated === 1);
}

// ── 4. A history carried on ─────────────────────────────────────────────────
{
    const steps = [];
    const carried = await runOnce({ ...SETTINGS, history: { genNum: 5, geSteps: 2, bestMF: 1e-3, elapsedMs: 1000, hasRows: true } },
        { onProgress: p => { if ('geSteps' in p) steps.push(p.geSteps); } });
    ok('rows are numbered on from the history', carried.rows[0]?.genNum === 6, String(carried.rows[0]?.genNum));
    ok('a history that has rows gets no seed row', !carried.rows.some(r => r.type === 'baseline' || r.type === 'seed'));
    ok('GE steps are counted on from the history', steps[0] === 3, JSON.stringify(steps.slice(0, 3)));
    ok('time runs on from the history', carried.rows.every(r => r.tMs >= 1000));
}

// ── 5. A target of Infinity ─────────────────────────────────────────────────
{
    const first = await runOnce({ ...SETTINGS, targetMF: Infinity });
    ok('a target of Infinity ends the run at its first accepted step', first.result.stopReason === 'target'
        && first.rows.filter(r => r.type === 'needle' || r.type === 'refine').length === 1, first.rows.map(r => r.type).join(','));
}

console.log = _log;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
