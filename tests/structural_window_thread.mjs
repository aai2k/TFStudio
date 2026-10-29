/**
 * A Structural run keeps its heavy work on its optimizer workers: each worker
 * refines a proposal, tidies it and scores it on every row the run keeps, and
 * the workers scan for needles and place them.
 *
 *   1. A run on worker threads reads no material, once its workers are built,
 *      at the wavelengths its rows sample: the thread that drives the run
 *      neither scores the refined proposals nor scans for needles.
 *   2. The merit and optical merit a worker scores for a refined proposal are
 *      the ones the run's own thread computes for the same tidied design, bit
 *      for bit: on the front face, a symmetric pair, two independent faces and
 *      the back face, with band, extremum, stress, group delay and thickness
 *      floor rows.
 *   3. Stop while a worker scans for needles, or places one, ends the run
 *      stopped with its workers ended.
 *
 * Run: node tests/structural_window_thread.mjs
 */
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';
import { NodeModuleWorker } from './_moduleWorker.mjs';

shimBrowserGlobals();
await initWasmForTest();
globalThis.Worker = NodeModuleWorker;

const { OPTIMIZER_WORKER_URL } = await import('../src/workerUrls.js');
const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { getMaterialById } = await import('../src/utils/materials/catalogManager.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { makeOperand, mirrorLayers } = await import('../src/utils/physics/optimizer.js');
const { tidyLayers } = await import('../src/utils/synthesis/structuralOptimizer.js');
const { runStructural } = await import('../src/utils/structural/runStructural.js');
const { planRun } = await import('../src/utils/structural/settings.js');
const { prepare } = await import('../src/utils/structural/setup.js');
const { makeRun } = await import('../src/utils/structural/runState.js');
const { designFor, refineJob, trueEval } = await import('../src/utils/structural/refine.js');
const { handleOptimizerMessage } = await import('../src/utils/workers/optimizerJob.js');
const { InThreadOptimizerWorker } = await import('../src/utils/workers/inThreadOptimizerWorker.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

const quiet = { log: console.log, warn: console.warn, error: console.error };
const logged = [];
const silence = () => {
    console.log = (...args) => logged.push(args.join(' '));
    console.warn = () => {}; console.error = () => {};
};
const loud = () => Object.assign(console, quiet);

const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
const BBAR = caseById('bbar');

// ── 1. Nothing read on the run's thread at the rows' wavelengths ────────────
// Every main-thread object of the design's and the pool's materials counts the
// wavelengths it is read at while `counting` is on.
// unwatchAll() puts the materials back as they were.
const reads = [];
let counting = false;
const watched = new Map();
function watch(mat) {
    if (!mat || watched.has(mat)) return;
    const getNK = mat.getNK;
    watched.set(mat, getNK);
    mat.getNK = function (lambda) {
        if (counting) reads.push(lambda);
        return getNK.call(this, lambda);
    };
}
const unwatchAll = () => { for (const [mat, getNK] of watched) mat.getNK = getNK; };
for (const id of ['TiO2', 'SiO2', 'BK7', 'Air']) { watch(getMaterial(id)); watch(getMaterialById(id)); }

{
    // One range target with a dense grid of its own, so the design never
    // outgrows it and the run never re-samples. The grid check at the top of
    // each iteration reads the group index at the band's short end alone
    // (fringeSampling.js), at λ and λ(1 ± 10⁻³).
    const op = { ...BBAR.ops[0], id: 'op0', enabled: true, rampPoints: 400 };
    const shortEnd = Math.min(op.lambdaStart, op.lambdaEnd);
    const h = shortEnd * 1e-3;
    const gridCheck = new Set([shortEnd, shortEnd + h, shortEnd - h]);
    const pool = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
    pool.forEach(material => watch(material.mat));
    const jobs = { scans: 0, needles: 0, scoredRefines: 0 };
    const makeWorker = () => {
        const worker = new Worker(OPTIMIZER_WORKER_URL, { type: 'module' });
        const post = worker.postMessage.bind(worker);
        worker.postMessage = job => {
            if (job?.type === 'structuralNeedleScan') jobs.scans++;
            if (job?.type === 'structuralNeedle') jobs.needles++;
            if (job?.type === 'start' && job.structuralScore) jobs.scoredRefines++;
            post(job);
        };
        return worker;
    };
    const design = {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
        frontLayers: [layer('L0', 'TiO2', 30), layer('L1', 'SiO2', 50)],
    };
    silence();
    let result;
    try {
        result = await runStructural(design, [op], {
            pool, maxIter: 4, refineIter: 10, threads: 2, seed: 7, dMin: 1, smartSeed: false,
        }, { makeWorker, onStart: () => { counting = true; } });
    } finally { counting = false; unwatchAll(); loud(); }
    const atRows = reads.filter(lambda => !gridCheck.has(lambda));
    console.log(`=== Structural run on worker threads ===\n  end: ${result.stopReason} after ${result.iters}; `
        + `${jobs.scans} scans, ${jobs.needles} needles, ${jobs.scoredRefines} scored refines; ${atRows.length} reads at the rows' wavelengths`);
    ok('the run completes its iterations', result.completed && result.stopReason === 'maxIter', `${result.stopReason}`);
    ok('its workers scan for needles, place them and score the refines',
        jobs.scans > 0 && jobs.needles > 0 && jobs.scoredRefines > 0, JSON.stringify(jobs));
    ok('the run keeps one grid throughout', !logged.some(line => line.includes('Grid re-sampled')));
    ok('its own thread reads no material at the wavelengths its rows sample', atRows.length === 0,
        `${atRows.length} reads, first at ${atRows.slice(0, 5).join(', ')} nm`);
}

// ── 2. The worker's score is the run thread's score ─────────────────────────
// Films whose stress the STR row reads, embedded in the design as a file
// carries them, on four surface modes.
const MATERIALS = {
    'user_s:H': {
        id: 'H', name: 'High index (stressed)', formulaNum: -1,
        tabData: [[400, 2.45, 0], [550, 2.37, 0], [700, 2.30, 0]],
        mechanical: { youngsModulusGPa: 200, poissonsRatio: 0.25, intrinsicStressMPa: -300 },
    },
    'user_s:L': {
        id: 'L', name: 'Low index (stressed)', formulaNum: -1,
        tabData: [[400, 1.48, 0], [550, 1.465, 0], [700, 1.45, 0]],
        mechanical: { youngsModulusGPa: 70, poissonsRatio: 0.17, intrinsicStressMPa: 150 },
    },
};
const ROWS = [
    makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }),
    makeOperand({ type: 'TMX', lambdaStart: 450, lambdaEnd: 650, target: 0.9, weight: 1 }),
    makeOperand({ type: 'STR', target: 0, weight: 1 }),
    makeOperand({ type: 'GD', lambdaStart: 550, aoi: 0, pol: 's', target: 5, weight: 1 }),
    makeOperand({ type: 'MNT', target: 20, weight: 1 }),
].map((op, i) => ({ ...op, id: `row${i}`, enabled: true }));

// Two layers of one material side by side on each face, which the refine keeps
// apart and tidying merges.
function faceDesign(surfaceMode) {
    const front = [layer('F1', 'user_s:H', 100), layer('F2', 'user_s:L', 60), layer('F3', 'user_s:L', 40), layer('F4', 'user_s:H', 80)];
    const back = [layer('B1', 'user_s:L', 90), layer('B2', 'user_s:H', 30), layer('B3', 'user_s:H', 30)];
    return {
        incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air', substrate: { material: 'builtin:BK7', thickness: 1 },
        surfaceMode, mfEvalMode: 'total', materials: MATERIALS,
        frontLayers: surfaceMode === 'back_only' ? [] : front,
        backLayers: surfaceMode === 'front_only' ? [] : (surfaceMode === 'symmetric' ? mirrorLayers(front) : back),
    };
}

// What the run's thread made of a refine's answer: the side it works on
// tidied, a symmetric back the mirror of the tidied front, and the merit on
// every row it keeps. NaN where a row cannot be evaluated, so a score that only
// fell back to the refine's own merit cannot match.
function threadScore(S, done) {
    const tidied = tidyLayers((S.layerKey === 'frontLayers' ? done.bestFrontLayers : done.bestBackLayers) || [], S.cfg.dMin);
    const frontLayers = S.layerKey === 'frontLayers' ? tidied : structuredClone(done.bestFrontLayers);
    const backLayers = S.layerKey === 'backLayers'
        ? tidied
        : (S.surfaceMode === 'symmetric' ? mirrorLayers(tidied) : structuredClone(done.bestBackLayers));
    return { ...trueEval(S, frontLayers, backLayers, NaN, NaN), frontLayers, backLayers };
}

for (const surfaceMode of ['front_only', 'symmetric', 'both_independent', 'back_only']) {
    const design = faceDesign(surfaceMode);
    const lookup = designMaterialLookup(design);
    const pool = ['user_s:H', 'user_s:L'].map(id => ({ id, name: id, mat: lookup(id) }));
    silence();
    const plan = planRun({ pool, threads: 1, seed: 1, dMin: 1, refineIter: 3, innerEngine: 'dls' });
    const S = makeRun(design, plan, prepare(design, ROWS, plan), null, {});
    loud();
    const job = structuredClone(refineJob(S, designFor(S, design[S.layerKey], design[S.otherKey])));
    let done = null, error = null;
    await handleOptimizerMessage(job, message => {
        if (message.type === 'done') done = message;
        if (message.type === 'error') error = message.message;
    });
    const scored = done?.scored;
    const expected = done ? threadScore(S, done) : null;
    const same = !!scored && JSON.stringify([scored.frontLayers, scored.backLayers]) === JSON.stringify([expected.frontLayers, expected.backLayers])
        && Object.is(scored.mf, expected.mf) && Object.is(scored.omf, expected.omf);
    ok(`${surfaceMode}: the worker scores the tidied design as the run's thread does`, same,
        scored ? `worker ${scored.mf} / ${scored.omf}, thread ${expected.mf} / ${expected.omf}` : `no score: ${error}`);
    const refinedCount = (S.layerKey === 'frontLayers' ? done?.bestFrontLayers : done?.bestBackLayers)?.length;
    ok(`${surfaceMode}: the design scored is the refined one tidied`, scored && scored[S.layerKey].length === refinedCount - 1,
        scored ? `${scored[S.layerKey].length} layers from ${refinedCount}` : 'no score');
}

// ── 3. Stop while a needle job is under way ─────────────────────────────────
for (const held of ['structuralNeedleScan', 'structuralNeedle']) {
    const stop = new AbortController();
    const counter = { built: 0, ended: 0 };
    let heldJobs = 0;
    const makeWorker = () => {
        const worker = new InThreadOptimizerWorker();
        counter.built++;
        const post = worker.postMessage.bind(worker);
        worker.postMessage = job => {
            if (job?.type !== held) { post(job); return; }
            heldJobs++;
            setTimeout(() => stop.abort(), 0);
        };
        const end = worker.terminate.bind(worker);
        worker.terminate = () => { counter.ended++; end(); };
        return worker;
    };
    const pool = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
    const design = {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
        frontLayers: [layer('L0', 'TiO2', 30), layer('L1', 'SiO2', 50)],
    };
    silence();
    let timer;
    const hang = new Promise(resolve => { timer = setTimeout(() => resolve({ stopReason: 'hung' }), 20000); });
    let result;
    try {
        result = await Promise.race([runStructural(design, [{ ...BBAR.ops[0], id: 'op0', enabled: true }], {
            pool, maxIter: 4, refineIter: 5, threads: 2, seed: 7, smartSeed: false,
        }, { makeWorker, signal: stop.signal }), hang]);
    } finally { clearTimeout(timer); loud(); }
    ok(`Stop during a ${held} job ends the run stopped`, heldJobs > 0 && result.stopReason === 'stopped',
        `${heldJobs} held, ${result.stopReason}`);
    ok(`and ends each of its workers`, counter.ended === counter.built && counter.built > 0, `${counter.ended} of ${counter.built}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
