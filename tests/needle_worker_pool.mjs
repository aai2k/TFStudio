/**
 * Behavioral gate for the Needle worker-POOL engine (needleEngine.js →
 * runNeedleWorkerPool).
 *
 * The default standalone-needle path orchestrates a WorkerPool of stateless
 * synthesis primitives (scan / candidate / seedDls) from the main thread. That
 * async orchestration — smart-seed → scan fan-out → best-of-batch candidate
 * refine → accept/record → finalize — is the file's real complexity and had NO
 * automated coverage (the synthesis_* tests exercise the primitives, not the
 * loop). This test drives it in-process by injecting a FAKE pool whose `map`
 * runs the real `dispatchSynthesisJob` handlers synchronously (same code the
 * Web Worker runs), so the whole orchestration executes deterministically in
 * Node. It gates both the extraction of runOpt out of the component and its
 * decomposition into small helpers against any behavior change.
 *
 * Run: node tests/needle_worker_pool.mjs
 */
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest, tmmWasmActive } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { runNeedleWorkerPool } = await import('../src/components/windows/optimization/needleEngine.js');
const { dispatchSynthesisJob } = await import('../src/utils/workers/synthesisWorker.js');
const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('FAIL:', name); } };

// Quiet the engine's per-step console.log spam.
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

const tStub = { needle: { noOperands: 'no operands', smartSeeding: (n) => `smart-seeding ${n}` } };

// In-process fake pool: exactly mirrors the Web Worker's onmessage — per job it
// rebuilds resolveMat from job.materials and runs dispatchSynthesisJob, routing
// ticks to onProgress and resolving with the final {type:'result'} message.
// jobsRun counts dispatches so the test can prove the worker path actually ran
// (rather than silently falling back to the main-thread loop).
function makeFakePool(counter) {
    return {
        map(jobs, onProgress) {
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
        terminate() {},
    };
}

function makeRun(counter) {
    const design = seedDesign();
    const noop = () => {};
    const ref = (v) => ({ current: v });
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const ctx = {
        runningRef: ref(false), timerRef: ref(null), workerRef: ref(null), dlsRef: ref(null),
        baseDesignRef: ref(null), savedDesignRef: ref(null), designRef: ref(design),
        operandsRef: ref(ops.map(o => ({ ...o, enabled: true }))),
        gensRef: ref([]), genCountRef: ref(0), lastBestRef: ref(null),
        maxLayersRef: ref(6), deltaNmRef: ref(0.5), dMinRef: ref(1.0),
        dlsIterRef: ref(30), targetMFRef: ref(1e-4),
        selectedCatsRef: ref([]), excludedMatsRef: ref(new Set()),
        updateDesignRef: ref(noop), checkpointRef: ref(noop),
        setPhase: (p) => { if (p === 'idle' && ctx.runningRef.current === false && ctx._started) resolveDone(); },
        setStatusMsg: noop, setMf: noop, setMfBest: noop, setOmf: noop, setOmfBest: noop,
        setLayerCount: noop, setCanReset: noop, setGeneration: noop,
        setGenerations: noop, setTopDesigns: noop,
        reconcileBaseWithEdits: noop,
        getPoolMaterials: () => POOL,
        setCachedOptState: noop,
        t: tStub, stopOpt: noop,
        makeWorkerPool: () => makeFakePool(counter),
        _started: false,
    };
    return { ctx, done };
}

async function runOnce() {
    const counter = { n: 0 };
    const { ctx, done } = makeRun(counter);
    ctx._started = true;
    runNeedleWorkerPool(ctx);
    if (ctx.runningRef.current) {
        await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000))]);
    }
    return {
        gens: ctx.gensRef.current.map(g => ({ genNum: g.genNum, layerCount: g.layerCount, mf: g.mf })),
        jobsRun: counter.n,
    };
}

const A = await runOnce();
const B = await runOnce();
console.log = _log;

console.log(`=== Needle worker-pool engine · WASM ${tmmWasmActive() ? 'ON' : 'off'} ===`);
console.log(`  jobs dispatched via fake pool: ${A.jobsRun}`);
console.log(`  generations: ${A.gens.length}`);
for (const g of A.gens) console.log(`  gen ${g.genNum}: ${g.layerCount} layers, MF=${g.mf.toFixed(6)}`);

ok('worker path actually ran (dispatched pool jobs, no fallback)', A.jobsRun > 0);
ok('grew the stack (≥1 accepted generation)', A.gens.length >= 1);
ok('every generation has ≥2 layers (grew past the seed)', A.gens.every(g => g.layerCount >= 2));
ok('merit finite', A.gens.every(g => Number.isFinite(g.mf)));
// Accept rule guarantees each recorded generation strictly improves the best.
let mono = true;
for (let i = 1; i < A.gens.length; i++) if (!(A.gens[i].mf < A.gens[i - 1].mf - 1e-9)) mono = false;
ok('merit improves monotonically across accepted generations', mono);
ok('reached a usable BBAR (final MF < 0.05)', A.gens.length && A.gens[A.gens.length - 1].mf < 0.05);

// Determinism: the fake pool runs jobs in-order synchronously and the math has
// no RNG affecting merit, so two runs from the same seed produce an identical
// generation sequence.
const same = A.gens.length === B.gens.length &&
    A.gens.every((g, i) => g.layerCount === B.gens[i].layerCount && Math.abs(g.mf - B.gens[i].mf) < 1e-12);
ok('deterministic run-to-run (identical generation sequence)', same);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
