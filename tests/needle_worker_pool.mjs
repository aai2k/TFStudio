/**
 * A Needle run in Node (utils/needle/runNeedle.js), on an in-process pool whose
 * `map` runs the real `dispatchSynthesisJob` handlers one job after another
 * (the code the Web Worker runs), so the run is deterministic.
 *
 *   1. A broadband AR from one 100 nm layer: the run grows the stack, each
 *      generation improves on the one before except across a thin-start rescue,
 *      the answer is usable, two runs agree, and the result is a design one of
 *      its rows shows.
 *   2. Settings: unknown ones and values the run cannot take are refused, and
 *      the defaults are the window's.
 *   3. Stop before the run starts and while it runs.
 *   4. A run that carries on a history numbers its rows on from it.
 *   5. A rescue whose thicker start never beats the design it stalled on ends
 *      on that design, recorded as the closing row.
 *
 * Run: node tests/needle_worker_pool.mjs
 */
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest, tmmWasmActive } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { runNeedle } = await import('../src/utils/needle/runNeedle.js');
const { planRun } = await import('../src/utils/needle/settings.js');
const { defaultThreadCount } = await import('../src/utils/synthesis/synthesisConfig.js');
const { dispatchSynthesisJob } = await import('../src/utils/workers/synthesisWorker.js');
const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('FAIL:', name); } };
const throws = (fn, pattern) => { try { fn(); return false; } catch (err) { return pattern.test(err.message); } };

// Quiet the run's per-step console.log spam.
const _log = console.log; console.log = () => {};

const ops = caseById('bbar').ops;   // BBAR: TGT 420–680 → T=1
const POOL = [
    { id: 'TiO2', name: 'TiO2', mat: getMaterial('TiO2') },
    { id: 'SiO2', name: 'SiO2', mat: getMaterial('SiO2') },
    { id: 'MgF2', name: 'MgF2', mat: getMaterial('MgF2') },
];
const seedDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [{ id: 'S', material: 'SiO2', thickness: 100, locked: false }],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});
const SETTINGS = { pool: POOL, maxLayers: 6, deltaNm: 0.5, dMin: 1.0, refineIter: 30, targetMF: 1e-4, threads: 3 };

// The in-process pool. It counts the jobs it runs and the times it is
// terminated; `onMap(n)` is called before the nth map call runs.
function makePool(counter, onMap = () => {}) {
    return {
        map(jobs, onProgress) {
            onMap(++counter.maps);
            return Promise.all(jobs.map((job, i) => new Promise((resolve, reject) => {
                counter.n++;
                const resolveMat = makeResolveMat(job.materials || {}, 'fakePool');
                const post = (m) => {
                    if (m.type === 'tick') { onProgress && onProgress(i, m); return; }
                    if (m.type === 'error') { reject(new Error(m.message)); return; }
                    resolve(m);
                };
                try { dispatchSynthesisJob(job, resolveMat, post); }
                catch (e) { reject(e); }
            })));
        },
        terminate() { counter.terminated++; },
    };
}

async function runOnce(settings = SETTINGS, hooks = {}) {
    const counter = { n: 0, maps: 0, terminated: 0 };
    const rows = [];
    const result = await runNeedle(seedDesign(), ops.map(o => ({ ...o, enabled: true })), settings, {
        makeWorkerPool: () => makePool(counter, hooks.onMap),
        onGeneration: row => rows.push(row),
        ...hooks,
    });
    return { result, rows, counter };
}

// ── 1. A run ────────────────────────────────────────────────────────────────
const A = await runOnce();
const B = await runOnce();
console.log = _log;
console.log(`=== Needle run in Node · WASM ${tmmWasmActive() ? 'ON' : 'off'} ===`);
console.log(`  jobs run: ${A.counter.n}, end: ${A.result.stopReason}`);
for (const g of A.rows) console.log(`  gen ${g.genNum}: ${g.layerCount} layers, MF=${g.mf.toFixed(6)}`);
console.log = () => {};

ok('the pool ran the jobs, and was terminated once', A.counter.n > 0 && A.counter.terminated === 1);
ok('grew the stack (≥1 accepted generation)', A.rows.length >= 1);
// A generation may hold fewer layers than it inserted: a needle the refine
// parks on the floor is taken out when the stack is better without it, and the
// first generation can then be the refined seed alone.
ok('grew past the seed (the last generation has ≥2 layers)', A.rows.at(-1).layerCount >= 2);
ok('merit finite', A.rows.every(g => Number.isFinite(g.mf)));
// The accept rule guarantees each recorded generation strictly improves on the
// one before it, EXCEPT across a thin-start rescue: that restarts the loop from
// a thicker design chosen for the room it has to grow, not for the merit it
// starts at, so the first generation after it is allowed to read worse. The
// rescue tags that generation, and the run still ends on the better of the two
// designs, so a rescue can never make the run's answer worse.
let mono = true;
for (let i = 1; i < A.rows.length; i++) {
    if (A.rows[i].rescued) continue;
    if (!(A.rows[i].mf < A.rows[i - 1].mf - 1e-9)) mono = false;
}
ok('merit improves monotonically within each phase of a run', mono);
ok('reached a usable BBAR (final MF < 0.05)', A.result.mf < 0.05);
ok('a completed run with its stop reason', A.result.completed
    && ['maxLayers', 'needleOptimal', 'target'].includes(A.result.stopReason));
const sameLayers = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A row's merit and the answer's can differ in the last digits: a design kept
// aside by a rescue is re-scored when the run moves to a finer grid.
ok('the answer is a design one of its rows shows', A.rows.some(g => Math.abs(g.mf - A.result.mf) < 1e-12
    && sameLayers(g.frontSnap, A.result.frontLayers) && sameLayers(g.backSnap, A.result.backLayers)));
// Determinism: the pool runs jobs in order and the math has no RNG affecting
// merit, so two runs from the same seed produce an identical generation sequence.
ok('deterministic run-to-run (identical generation sequence)', A.rows.length === B.rows.length &&
    A.rows.every((g, i) => g.layerCount === B.rows[i].layerCount && Math.abs(g.mf - B.rows[i].mf) < 1e-12));

// ── 2. Settings ─────────────────────────────────────────────────────────────
ok('an unknown setting is refused', throws(() => planRun({ ...SETTINGS, maxLayer: 5 }), /unknown setting 'maxLayer'/));
ok('a layer cap of 0 is refused', throws(() => planRun({ ...SETTINGS, maxLayers: 0 }), /maxLayers/));
ok('a fractional refine count is refused', throws(() => planRun({ ...SETTINGS, refineIter: 2.5 }), /refineIter/));
ok('an inner refiner synthesis does not offer is refused', throws(() => planRun({ ...SETTINGS, innerEngine: 'de' }), /innerEngine/));
ok('a run without a material pool is refused', throws(() => planRun({ maxLayers: 5 }), /pool/));
ok('a pool entry without its material is refused', throws(() => planRun({ pool: [{ id: 'X', name: 'X', mat: null }] }), /pool/));
{
    const firstOnly = await runOnce({ ...SETTINGS, targetMF: Infinity });
    ok('a target of Infinity ends the run at its first accepted generation',
        firstOnly.result.stopReason === 'target' && firstOnly.rows.length === 1);
}
// The window's fields start from these too (useNeedleVariation.js).
const plan = planRun({ pool: POOL });
const WINDOW_DEFAULTS = {
    maxLayers: 60, targetMF: 5e-4, deltaNm: 0.5, dMin: 1, refineIter: 60, innerEngine: 'trust-region',
    maxBatches: 2, sensFloor: 0, smartSeed: false, threads: defaultThreadCount(),
};
const offDefault = Object.keys(WINDOW_DEFAULTS).filter(key => plan[key] !== WINDOW_DEFAULTS[key]);
ok(`the defaults are the window's (${offDefault.join(', ') || 'all'})`, offDefault.length === 0);
let refused = false;
try { await runNeedle(seedDesign(), ops, SETTINGS, {}); } catch (err) { refused = /makeWorkerPool/.test(err.message); }
ok('a run without a pool factory is refused', refused);

// ── 3. Stop ─────────────────────────────────────────────────────────────────
{
    const stop = new AbortController();
    stop.abort();
    let built = false;
    const before = await runNeedle(seedDesign(), ops, SETTINGS, { signal: stop.signal, makeWorkerPool: () => { built = true; } });
    ok('a run stopped before it starts builds no pool', before.stopReason === 'stopped' && !built && before.frontLayers === null);
}
{
    const stop = new AbortController();
    const during = await runOnce(SETTINGS, { signal: stop.signal, onMap: n => { if (n === 3) stop.abort(); } });
    ok('a run stopped while it runs ends stopped, without an answer', during.result.stopReason === 'stopped'
        && during.result.frontLayers === null && !during.result.completed);
    ok('its pool is terminated once', during.counter.terminated === 1);
}
for (const hook of ['onStart', 'onProgress']) {
    // A caller's hook that throws as the run starts ends the run, and its
    // pool goes with it.
    const counter = { n: 0, maps: 0, terminated: 0 };
    let rejected = false;
    try {
        await runNeedle(seedDesign(), ops, SETTINGS, {
            makeWorkerPool: () => makePool(counter),
            [hook]: () => { throw new Error(`${hook} threw`); },
        });
    } catch (err) { rejected = err.message === `${hook} threw`; }
    ok(`a run whose ${hook} throws at the start rejects and terminates its pool`, rejected && counter.terminated === 1);
}

// ── 4. A history carried on ─────────────────────────────────────────────────
{
    const carried = await runOnce({ ...SETTINGS, history: { genNum: 5, bestMF: 1e-3, elapsedMs: 1000, rows: [] } });
    const first = carried.rows[0];
    ok('rows are numbered on from the history', first?.genNum === 6);
    ok('the first ΔMF is measured from the history\'s best', Math.abs(first.dMF - (first.mf - 1e-3)) < 1e-15);
    ok('time runs on from the history', first.tMs >= 1000);
}

// ── 5. A rescue that ends on the design it stalled on ───────────────────────
{
    // Scans find no needle, and the thicker starts all score worse (0.5) than
    // the start (0.3). The run takes the best of them, finds no needle again,
    // and ends on the start design, which no accepted row shows. One wavelength
    // keeps the run on its launch grid, so nothing re-scores these merits.
    const oneLine = [makeOperand({ type: 'T', lambdaStart: 550, lambdaEnd: 550, pol: 'avg', target: 1, weight: 1 })];
    const counter = { terminated: 0 };
    const pool = {
        map: async (jobs) => jobs.map(job => (job.type === 'scan'
            ? { type: 'result', mf0: 0.3, candidates: [] }
            : { type: 'result', mf: 0.5, omf: 0.5, frontLayers: job.design.frontLayers, backLayers: [] })),
        terminate() { counter.terminated++; },
    };
    const rows = [];
    const ended = await runNeedle(seedDesign(), oneLine, SETTINGS, { makeWorkerPool: () => pool, onGeneration: r => rows.push(r) });
    ok('the run ends on the design it stalled on', ended.completed && ended.mf === 0.3
        && ended.frontLayers?.[0]?.thickness === 100);
    const closing = rows.length === 1 ? rows[0] : {};
    ok('that design is the closing row', [closing.final === true, closing.rescued === true,
        closing.mf === 0.3, closing.frontSnap?.[0]?.thickness === 100].every(Boolean));
}

console.log = _log;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
