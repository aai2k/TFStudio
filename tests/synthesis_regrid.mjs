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
 *      tables hold every wavelength its operands sample. The run stalls and
 *      takes the thin-start rescue; the jobs after it carry fewer samples than
 *      the rescue's ladder.
 *   3. The run's reported best merit is the merit of its final design on the
 *      grid the run ended on.
 *   4. The thin-start rescue scores every rung on the grid the thickest one
 *      needs, and when a thinner rung wins, the run goes on with the grid that
 *      rung needs, with the adopted and the stalled design re-scored on it.
 *   5. When the thickest rung wins, the run keeps its grid.
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
                    type: job.type, operands: job.operands || [], samples: samplesOf(job.operands || []),
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

// The run stalls at a few layers and takes the thin-start rescue: its ladder is
// scored on the grid for a copy 16 times thicker, and the run then goes on with
// the grid its own design needs.
const rescueAt = jobLog.map(j => j.type).lastIndexOf('seedDls');
const ladderSamples = rescueAt >= 0 ? jobLog[rescueAt].samples : 0;
const afterRescue = jobLog.slice(rescueAt + 1);
ok(rescueAt >= 0 && afterRescue.length > 0, `the run took the rescue and went on (${afterRescue.length} jobs after it)`);
ok(afterRescue.every(j => j.samples < ladderSamples),
    `the jobs after the rescue carry fewer samples than its ladder (${Math.max(...afterRescue.map(j => j.samples))} vs ${ladderSamples})`);

// The last cycle re-samples for the final design before it stops at the layer
// limit, so the run's grid is the last jobs' grid grown for that design.
const finalDesign = { ...seed(), ...ctx.baseDesignRef.current };
const lastOps = jobLog.at(-1).operands;
const finalOps = regridForDesign(lastOps, finalDesign, resolveMat) || lastOps;
const rescored = meritOf(finalOps, finalDesign, resolveMat);
ok(Math.abs(bestShown - rescored) <= 1e-9 * Math.max(rescored, 1e-12),
    `the reported best merit ${bestShown} is the final design's merit on the run's last grid (${rescored})`);

// ── 4-5. The thin-start rescue's grid ────────────────────────────────────────
// The rescue refines copies of the stalled design 2, 4, 8 and 16 times thicker,
// all scored on the grid the ×16 copy needs, then goes on from the best rung.
// A fake pool refines nothing and hands back the rung it is told to prefer.
{
    const { wpThinStartRescue } = await import('../src/components/windows/optimization/needleVariation/runners/workerPoolRescue.js');
    const { wpDesignHelpers } = await import('../src/components/windows/optimization/needleVariation/runners/workerPoolSetup.js');
    const { presampleSynthesisMaterials } = await import('../src/components/windows/optimization/synthesisShared/runGrid.js');

    // Five alternating layers, 500 nm of film: thick enough that the ×16 copy
    // needs far more samples over 450-650 nm than the ×2 copy does.
    const stalled = () => ({ ...seed(), frontLayers: Array.from({ length: 5 }, (_, i) => ({
        id: 'r' + i, material: i % 2 ? 'SiO2' : 'TiO2', thickness: 100, locked: false })) });
    const scaled = f => ({ ...stalled(), frontLayers: stalled().frontLayers.map(l => ({ ...l, thickness: l.thickness * f })) });
    const launch = withDesignSampleCounts(ops, stalled(), resolveMat);

    async function rescueWith(winner) {
        const ladderJobs = [];
        const pool = {
            map: async (jobs) => jobs.map((job) => {
                ladderJobs.push(job);
                const factor = job.design.frontLayers[0].thickness / 100;
                return { mf: factor === winner ? 0.1 : 0.2, omf: null,
                    frontLayers: job.design.frontLayers, backLayers: job.design.backLayers };
            }),
        };
        const curDes = stalled();
        const run = {
            ctx: {
                runningRef: ref(true), workerRef: ref(pool), updateDesignRef: ref(noop),
                setPhase: noop, setStatusMsg: noop, setMf: noop, setOmf: noop, setLayerCount: noop,
                t: { needle: { rescueTrying: () => '', rescueApplied: () => '' } },
            },
            curDes, operands: launch, pool: POOL, materials: presampleSynthesisMaterials(curDes, launch, POOL),
            workerPool: pool, ...wpDesignHelpers(curDes, []),
            dMin: 1, dlsIter: 8, scanSides: ['front'], innerEngine: 'cg', lastTick: 0,
            best: { mf: meritOf(launch, curDes, resolveMat), omf: null, frontLayers: curDes.frontLayers, backLayers: [] },
            rescued: false, preRescueBest: null, prevBestMF: Infinity,
        };
        console.log = () => {};
        const continued = await wpThinStartRescue(run);
        console.log = _log;
        return { run, continued, ladderJobs };
    }

    const ladderGrid = regridForDesign(launch, scaled(16), resolveMat);
    const keptGrid = regridForDesign(launch, scaled(2), resolveMat) || launch;
    ok(samplesOf(ladderGrid) > samplesOf(keptGrid),
        `the ×16 copy needs more samples than the ×2 copy (${samplesOf(ladderGrid)} vs ${samplesOf(keptGrid)})`);

    // 4. The ×2 rung wins: the ladder was scored on the ×16 grid, and the run
    // goes on with the grid the ×2 design needs.
    const two = await rescueWith(2);
    ok(two.continued && two.run.best.frontLayers[0].thickness === 200, 'the run continues from the ×2 rung');
    ok(two.ladderJobs.length === 4 && two.ladderJobs.every(j => samplesOf(j.operands) === samplesOf(ladderGrid)),
        'every rung was scored on the ×16 grid');
    ok(samplesOf(two.run.operands) === samplesOf(keptGrid),
        `the run goes on with the ×2 design's grid (${samplesOf(two.run.operands)} samples, not ${samplesOf(ladderGrid)})`);
    ok(requiredLambdas(two.run.operands).every(l => two.run.materials.TiO2.lambdas.includes(l)),
        'the material tables were sampled on that grid');
    const onKept = d => meritOf(two.run.operands, { ...seed(), frontLayers: d.frontLayers, backLayers: d.backLayers }, resolveMat);
    ok(two.run.best.mf === onKept(two.run.best) && two.run.prevBestMF === two.run.best.mf,
        'the adopted design and the ΔMF baseline are scored on it');
    ok(two.run.preRescueBest.mf === onKept(two.run.preRescueBest),
        'so is the design the run stalled on, which finalize compares against');

    // 5. The ×16 rung wins: the run keeps the ×16 grid.
    const sixteen = await rescueWith(16);
    ok(samplesOf(sixteen.run.operands) === samplesOf(ladderGrid), 'with the ×16 rung the run keeps the ×16 grid');
}

if (fails === 0) console.log('\nAll synthesis regrid tests passed.');
else { console.error(`\n${fails} test(s) failed.`); process.exit(1); }
