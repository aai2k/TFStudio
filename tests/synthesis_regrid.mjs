/**
 * A synthesis run re-samples its band operands as the design grows.
 *
 * The launch grid is set for the starting design (densifyForRun). Needles and
 * thicker restarts add optical thickness, so the fringes get finer than that
 * grid; the runners re-sample for the design they are about to work on
 * (synthesisShared/runGrid.js).
 *
 * Checks:
 *   1. regridForDesign returns more samples for a grown design, and nothing for
 *      the same or a thinner one.
 *   2. A Needle worker-pool run from a single 100 nm layer towards a reflector,
 *      driven in-process through the real worker job handlers: the jobs sent after the design grew
 *      carry more band samples than the launch grid, and every job's material
 *      tables hold every wavelength its operands sample.
 *   3. The run's reported best merit is the merit of its final design on the
 *      grid the run ended on.
 *
 * Run: node tests/synthesis_regrid.mjs
 */
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const {
    makeOperand, operandSampleLambdas, requiredLambdas, withDesignSampleCounts,
} = await import('../src/utils/physics/optimizer.js');
const { regridForDesign, meritOf } = await import('../src/components/windows/optimization/synthesisShared/runGrid.js');
const { runNeedleWorkerPool } = await import('../src/components/windows/optimization/needleVariation/runners/workerPool.js');
const { dispatchSynthesisJob } = await import('../src/utils/workers/synthesisWorker.js');
const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else console.log('ok:', msg); };
const resolveMat = id => getMaterial(id);
const samplesOf = operands => operands.reduce((n, op) => n + operandSampleLambdas(op).length, 0);

// A reflector over 450-650 nm: needles have to build a thick stack to reach it.
const ops = [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 })];
const seed = () => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [{ id: 'S', material: 'SiO2', thickness: 100, locked: false }],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});

// ── 1. The helper ─────────────────────────────────────────────────────────────
{
    const launch = withDesignSampleCounts(ops, seed(), resolveMat);
    const grown = { ...seed(), frontLayers: Array.from({ length: 30 }, (_, i) => ({
        id: 'g' + i, material: i % 2 ? 'SiO2' : 'TiO2', thickness: 120, locked: false })) };
    const regridded = regridForDesign(launch, grown, resolveMat);
    ok(regridded && samplesOf(regridded) > samplesOf(launch),
        `a 30-layer design gets more samples than the 1-layer launch grid (${samplesOf(launch)} → ${regridded && samplesOf(regridded)})`);
    ok(regridForDesign(launch, seed(), resolveMat) === null, 'the launch design itself needs no new grid');
    ok(regridForDesign(regridded, seed(), resolveMat) === null, 'a thinner design never shrinks the grid');
}

// ── 2-3. A Needle worker-pool run ─────────────────────────────────────────────
const POOL = [
    { id: 'TiO2', name: 'TiO2', mat: getMaterial('TiO2') },
    { id: 'SiO2', name: 'SiO2', mat: getMaterial('SiO2') },
];
const jobLog = [];
function makeFakePool() {
    return {
        map(jobs, onProgress) {
            return Promise.all(jobs.map((job, i) => new Promise((resolve, reject) => {
                const lambdas = requiredLambdas(job.operands || []);
                const table = job.materials?.TiO2?.lambdas || [];
                const have = new Set(table);
                jobLog.push({
                    operands: job.operands || [], samples: samplesOf(job.operands || []),
                    covered: lambdas.every(l => have.has(l)),
                });
                const post = (m) => {
                    if (m.type === 'tick') { onProgress && onProgress(i, m); return; }
                    if (m.type === 'error') { reject(new Error(m.message)); return; }
                    resolve(m);
                };
                try { dispatchSynthesisJob(job, makeResolveMat(job.materials || {}, 'fakePool'), post); }
                catch (e) { reject(e); }
            })));
        },
        run(job, onProgress) { return this.map([job], onProgress ? (_, m) => onProgress(m) : undefined).then(r => r[0]); },
        terminate() {},
    };
}

const _log = console.log; console.log = () => {};
const ref = (v) => ({ current: v });
const noop = () => {};
let resolveDone;
const done = new Promise((r) => { resolveDone = r; });
let bestShown = null;
const ctx = {
    runningRef: ref(false), timerRef: ref(null), workerRef: ref(null), dlsRef: ref(null),
    baseDesignRef: ref(null), savedDesignRef: ref(null), designRef: ref(seed()),
    operandsRef: ref(ops),
    gensRef: ref([]), genCountRef: ref(0), lastBestRef: ref(null),
    runsRef: ref([]), runOpenRef: ref(false),
    maxLayersRef: ref(6), deltaNmRef: ref(0.5), dMinRef: ref(1.0),
    dlsIterRef: ref(8), targetMFRef: ref(1e-6),
    selectedCatsRef: ref([]), excludedMatsRef: ref(new Set()),
    updateDesignRef: ref(noop), checkpointRef: ref(noop),
    setPhase: (p) => { if (p === 'idle' && ctx.runningRef.current === false) resolveDone(); },
    setStatusMsg: noop, setMf: (v) => { bestShown = v; }, setMfBest: noop, setOmf: noop, setOmfBest: noop,
    setLayerCount: noop, setCanReset: noop, setGeneration: noop,
    setGenerations: noop, setTopDesigns: noop,
    reconcileBaseWithEdits: noop,
    getPoolMaterials: () => POOL,
    setCachedOptState: noop,
    t: { needle: {
        noOperands: 'no operands',
        smartSeeding: (n) => `smart-seeding ${n}`,
        rescueTrying: (n) => `rescue: ${n} thicker starts`,
        rescueApplied: (f, tot) => `rescue x${f} (${tot} nm)`,
    } },
    stopOpt: noop,
    makeWorkerPool: () => makeFakePool(),
};
runNeedleWorkerPool(ctx);
if (ctx.runningRef.current) {
    await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 120000).unref())]);
}
console.log = _log;

const launchSamples = jobLog[0]?.samples ?? 0;
const maxSamples = Math.max(...jobLog.map(j => j.samples));
ok(jobLog.length > 0, `the run dispatched ${jobLog.length} pool jobs`);
ok(maxSamples > launchSamples, `later jobs carry more band samples than the launch grid (${launchSamples} → ${maxSamples})`);
ok(jobLog.every(j => j.covered), 'every job\'s material tables hold every wavelength its operands sample');

const finalDesign = { ...seed(), ...ctx.baseDesignRef.current };
const lastOps = jobLog.at(-1).operands;
ok(regridForDesign(lastOps, finalDesign, resolveMat) === null,
    `the last jobs ran on a grid fine enough for the final design (${samplesOf(lastOps)} samples)`);
const rescored = meritOf(lastOps, finalDesign, resolveMat);
ok(Math.abs(bestShown - rescored) <= 1e-9 * Math.max(rescored, 1e-12),
    `the reported best merit ${bestShown} is the final design's merit on the run's last grid (${rescored})`);

if (fails === 0) console.log('\nAll synthesis regrid tests passed.');
else { console.error(`\n${fails} test(s) failed.`); process.exit(1); }
