/**
 * Gradual Evolution Deep search: when nothing is left to try, the run starts
 * again from the best design with its thicknesses perturbed instead of ending.
 *
 *   1. perturbBest: locked layers and the side not scanned stay as they are, no
 *      layer goes below the floor, the scale is 10 % after a new best and
 *      doubles with each perturbation that found nothing better (10, 20, 40,
 *      80 %, then 10 % again), and a run replays: the same state gives the same
 *      perturbation.
 *   2. Runner, against a scripted worker whose design has no improving needle,
 *      no forced step and no layer to free: without Deep search the run ends as
 *      stuck; with it the run perturbs the best design (a full refine and a
 *      Perturb row each time), goes past its GE-cycle limit, and ends on the
 *      target merit.
 *   3. Broadband AR 400-700 nm from TiO2 30 / SiO2 50 nm on BK7, 15 nm floor,
 *      Sequential QP, seed refined first, at most 7 layers, real synthesis jobs
 *      (worker path, in process) and on the main thread: without Deep search
 *      the run ends on its own; with it the run goes past that point, records
 *      Perturb rows, never holds more than 7 layers, and after two
 *      perturbations its best is no worse than the run without it.
 *
 * Run: node tests/ge_deep_search.mjs
 */
import { shimBrowserGlobals, useImmediateTimers } from './_uiShim.mjs';
import { initWasmForTest, tmmWasmActive } from './_wasmInit.mjs';

shimBrowserGlobals();
useImmediateTimers();
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 1 }, configurable: true, writable: true });
await initWasmForTest();

const O = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { dispatchSynthesisJob } = await import('../src/utils/workers/synthesisWorker.js');
const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');
const { perturbBest } = await import('../src/components/windows/optimization/gradualEvolution/runners/deepSearch.js');
const { runGeWorker } = await import('../src/components/windows/optimization/gradualEvolution/runners/workerPool.js');
const { runGeMainThread } = await import('../src/components/windows/optimization/gradualEvolution/runners/mainThread.js');
const { default: EN } = await import('../src/constants/locales/en.js');
const ST = EN.gradualEvolution.status;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const rm = id => getMaterial(id);
const media = (layers) => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: layers.map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false })),
});
const POOL = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: rm(id) }));
const ARC = () => [O.makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 })];
const _log = console.log;
let logged = [];
const quiet = () => { logged = []; console.log = (...a) => { logged.push(a.join(' ')); }; };
const loud = () => { console.log = _log; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ref = v => ({ current: v });
const noop = () => {};

// ── 1. perturbBest ───────────────────────────────────────────────────────────
{
    const best = {
        frontLayers: [
            { id: 'a', material: 'TiO2', thickness: 50, locked: true },
            { id: 'b', material: 'SiO2', thickness: 80, locked: false },
            { id: 'c', material: 'TiO2', thickness: 15, locked: false },
        ],
        backLayers: [{ id: 'k', material: 'SiO2', thickness: 100, locked: false }],
    };
    const S = { best: { mf: 1 } };
    const first = perturbBest(S, best, ['front'], 15);
    ok('perturbBest: 10 % after a new best', first.scale === 0.1, String(first.scale));
    ok('perturbBest: a locked layer is not moved', first.frontLayers[0].thickness === 50);
    const rel = first.frontLayers[1].thickness / 80 - 1;
    ok('perturbBest: an unlocked layer moves within the scale', rel !== 0 && Math.abs(rel) <= 0.1, rel.toFixed(4));
    ok('perturbBest: the side not scanned stays as it is', first.backLayers === best.backLayers);
    const scales = [1, 2, 3, 4].map(() => perturbBest(S, best, ['front'], 15).scale);
    ok('perturbBest: doubles with each perturbation that found nothing better, then starts over',
        scales.join(',') === '0.2,0.4,0.8,0.1', scales.join(','));
    S.best.mf = 0.5;
    ok('perturbBest: back to 10 % after a new best', perturbBest(S, best, ['front'], 15).scale === 0.1);
    let floorHeld = true;
    for (let i = 0; i < 200; i++) {
        const p = perturbBest(S, best, ['front'], 15);
        if (p.frontLayers.some(l => l.thickness < 15)) floorHeld = false;
    }
    ok('perturbBest: no layer goes below the floor', floorHeld);
    const a = perturbBest({ best: { mf: 1 } }, best, ['front'], 15);
    const b = perturbBest({ best: { mf: 1 } }, best, ['front'], 15);
    ok('perturbBest: a run replays', JSON.stringify(a) === JSON.stringify(b));
}

// ── 2. The runner with nothing left to try, against a scripted worker ────────
function geCtx(design, operands, settings) {
    const ctx = {
        runningRef: ref(false), timerRef: ref(null), workerRef: ref(null), dlsRef: ref(null),
        baseDesignRef: ref(null), savedDesignRef: ref(null), designRef: ref({ ...design, id: 'ge-deep' }),
        operandsRef: ref(operands.map(o => ({ ...o, enabled: true }))), cyclesRef: ref([]), genCountRef: ref(0), geStepsRef: ref(0),
        runsRef: ref([]), runOpenRef: ref(false), checkpointRef: ref(noop),
        updateDesignRef: ref(patch => { ctx.designRef.current = { ...ctx.designRef.current, ...patch }; }),
        maxLayersRef: ref(settings.maxLayers), maxGeCyclesRef: ref(settings.maxGeCycles), targetMFRef: ref(settings.targetMF),
        dlsIterRef: ref(settings.dlsIter), dMinRef: ref(settings.dMin), deepSearchRef: ref(!!settings.deepSearch),
        selectedCatsRef: ref([]), excludedMatsRef: ref([]),
        setPhase: noop, setStatusMsg: v => { ctx.status = v; }, setCanReset: noop, setMf: noop, setOmf: noop, setMfBest: noop, setOmfBest: noop,
        setCycles: noop, setGeneration: noop, setLayerCount: noop, setGeSteps: noop, reconcileBaseWithEdits: noop,
        stopOpt: () => { ctx.runningRef.current = false; },
        getPoolMaterials: () => POOL,
        t: EN,
    };
    return ctx;
}
// Run until the run ends or `until(ctx)` holds, then press Stop.
async function runUntil(run, ctx, until = () => false) {
    quiet();
    run(ctx);
    const t0 = Date.now();
    while (ctx.runningRef.current && !until(ctx) && Date.now() - t0 < 600000) await sleep(1);
    const endedOnItsOwn = !ctx.runningRef.current;
    ctx.runningRef.current = false;
    try { ctx.workerRef.current?.terminate?.(); } catch (_) { /* already stopped */ }
    await sleep(5);
    loud();
    return endedOnItsOwn;
}
const bestMf = ctx => Math.min(...ctx.cyclesRef.current.map(r => r.mf));
const perturbRows = ctx => ctx.cyclesRef.current.filter(r => r.type === 'perturb');

async function scriptedRun(deepSearch) {
    const jobs = [];
    const perturbMerits = [0.35, 0.28, 1e-10];
    globalThis.Worker = class {
        constructor() { this.onmessage = null; this.dead = false; }
        postMessage(job) {
            if (this.dead || !job || job.type === 'wasmInit') return;
            jobs.push(job);
            const front = job.design.frontLayers;
            const answers = {
                seedDls: () => {
                    const mf = job.jobId === 'perturb' ? perturbMerits.shift() : 0.30;
                    return { mf, omf: mf, side: 'front', layers: front, frontLayers: front, backLayers: [], iters: 0 };
                },
                scan: () => ({ mf0: 0.3, candidates: [] }),
                dropParked: () => ({ removed: 0 }),
                dropWeakest: () => ({ removed: 0 }),
                geStep: () => ({ empty: true }),
                removePass: () => ({ removed: 0, mf: 0.28, frontLayers: front, backLayers: [] }),
            };
            const data = { type: 'result', ...(answers[job.type] || (() => ({})))() };
            setTimeout(() => { if (!this.dead) this.onmessage?.({ data }); }, 0);
        }
        terminate() { this.dead = true; }
    };
    localStorage.setItem('tfstudio-synth-seed-mode', 'refine');
    const ctx = geCtx(media([['TiO2', 60], ['SiO2', 90]]), ARC(),
        { maxLayers: 50, maxGeCycles: 1, targetMF: 1e-6, dlsIter: 10, dMin: 15, deepSearch });
    await runUntil(runGeWorker, ctx);
    return { ctx, jobs };
}
{
    const off = await scriptedRun(false);
    ok('without Deep search: nothing left to try ends the run', off.ctx.status === ST.stuck, off.ctx.status);
    ok('without Deep search: no perturbation', !off.jobs.some(j => j.jobId === 'perturb'));

    const on = await scriptedRun(true);
    const refines = on.jobs.filter(j => j.jobId === 'perturb');
    ok('Deep search: perturbs the best design instead of ending', refines.length === 3, `${refines.length} perturbations`);
    ok('Deep search: each perturbation is refined in full', refines.every(j => j.type === 'seedDls' && j.dlsIter === 10));
    const d0 = refines[0]?.design.frontLayers.map(l => l.thickness) || [];
    const moved = d0.map((d, i) => d / [60, 90][i] - 1);
    ok('Deep search: the first perturbation stays within 10 % of the best design',
        moved.length === 2 && moved.every(m => Math.abs(m) <= 0.1) && moved.some(m => m !== 0), JSON.stringify(d0));
    ok('Deep search: every perturbation is a Perturb row', perturbRows(on.ctx).map(r => r.mf).join(',') === '0.35,0.28,1e-10',
        on.ctx.cyclesRef.current.map(r => `${r.type}:${r.mf}`).join(','));
    ok('Deep search: goes past the GE-cycle limit', on.ctx.geStepsRef.current > 1, String(on.ctx.geStepsRef.current));
    ok('Deep search: ends on the target merit', on.ctx.status === ST.targetMet(1e-10), on.ctx.status);
}

// ── 3. Broadband AR at most 7 layers, real synthesis jobs ────────────────────
localStorage.setItem('tfstudio-synth-inner-engine-ge', 'sqp');
localStorage.setItem('tfstudio-synth-seed-mode', 'refine');
const SETTINGS = { maxLayers: 7, maxGeCycles: 16, targetMF: 5e-4, dlsIter: 30, dMin: 15 };
globalThis.Worker = class {
    constructor() { this.onmessage = null; this.dead = false; }
    postMessage(job) {
        if (this.dead || !job || job.type === 'wasmInit') return;
        setTimeout(() => {
            if (this.dead) return;
            dispatchSynthesisJob(job, makeResolveMat(job.materials || {}, 'test'), m => {
                if (m.type !== 'tick' && !this.dead) this.onmessage?.({ data: m });
            });
        }, 0);
    }
    terminate() { this.dead = true; }
};
for (const [path, run] of [['worker path', runGeWorker], ['main thread', runGeMainThread]]) {
    const plain = geCtx(media([['TiO2', 30], ['SiO2', 50]]), ARC(), SETTINGS);
    const plainEnded = await runUntil(run, plain);
    ok(`${path}: without Deep search the run ends on its own`, plainEnded, plain.status);

    const deep = geCtx(media([['TiO2', 30], ['SiO2', 50]]), ARC(), { ...SETTINGS, deepSearch: true });
    const deepEnded = await runUntil(run, deep, ctx => perturbRows(ctx).length >= 2);
    ok(`${path}: with Deep search it goes past that point until Stop`, !deepEnded && perturbRows(deep).length >= 2,
        `${perturbRows(deep).length} Perturb rows, status ${deep.status}`);
    ok(`${path}: with Deep search no row holds more than 7 layers`, deep.cyclesRef.current.every(r => r.layerCount <= 7));
    ok(`${path}: with Deep search the best is no worse than without it`, bestMf(deep) <= bestMf(plain) + 1e-12,
        `${bestMf(deep)} vs ${bestMf(plain)}`);
}

console.log(`=== GE Deep search · WASM ${tmmWasmActive() ? 'ON' : 'off'} ===`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
