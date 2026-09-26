/**
 * Gradual Evolution: what the history shows, and forced steps that were undone.
 *
 * A needle of a neighbour's material merges into that neighbour, and the step
 * then only changes the thicknesses of the existing layers (Sullivan &
 * Dobrowolski, Appl. Opt. 35, 5484 (1996), p. 5485). GE still takes such a
 * step when it lowers the working merit, but it is not a Needle row: it folds
 * into the Needle or Refine row just before it when this Run recorded that row
 * on the current wavelength grid, becomes a Refine row when it gives the best
 * design so far, and otherwise leaves no row. A forced step whose refining
 * brings the stack back where it started is not taken again from there.
 * "This Run" is the engine run since the last Run press or resume.
 *
 *   1. The synthesis worker's candidate job reports needleKept false for a gap
 *      needle of its neighbour's material, true for a gap needle unlike both
 *      neighbours and for a needle inside a layer, and counts the stack it
 *      started from with same-material neighbours merged.
 *   2. The worker's forced step leaves out the insertions it is told to, and
 *      reports none left when every insertion is left out.
 *   3. Runner, against a scripted worker: a merged step that is a new best
 *      after the Start row is a Refine row; a merged step after a Needle row
 *      folds into it; after a forced step a merged step that is not a new best
 *      leaves no row and the GE row keeps the forced step's merit; the next
 *      forced step, back on the same structure, is told to leave the undone
 *      one out; a new Run's first merged step is a Refine row of that Run.
 *   4. Broadband AR 400-700 nm from TiO2 30 / SiO2 50 nm on BK7, 15 nm floor,
 *      Sequential QP, seed refined first, run with the real synthesis jobs
 *      (worker path, in process) and on the main thread: every Needle row adds
 *      a layer, no two GE rows show the same layer count and merit, and the
 *      design the run ends on is a row of the history.
 *
 * Run: node tests/ge_history_rows.mjs
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
const { default: EN } = await import('../src/constants/locales/en.js');

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
const POOL_LITE = POOL.map(p => ({ id: p.id, name: p.name }));
const tgt = (type, a, b, v) => O.makeOperand({ type, lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: v, targetEnd: v, weight: 1 });
const BBAR = () => [tgt('TGT', 420, 680, 1)];
const _log = console.log;
let logged = [];
const quiet = () => { logged = []; console.log = (...a) => { logged.push(a.join(' ')); }; };
const loud = () => { console.log = _log; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ref = v => ({ current: v });
const noop = () => {};
const runJob = (job) => { let out; dispatchSynthesisJob(job, rm, m => { if (m.type !== 'tick') out = m; }); return out; };

// ── 1. needleKept from the candidate job ─────────────────────────────────────
{
    const candidate = (design, cand) => runJob({
        type: 'candidate', pipeline: 'ge', operands: BBAR(), design, dMin: 15, dlsIter: 10,
        jobId: 'k', side: 'front', engine: 'cg', cand: { dMF: -1e-3, side: 'front', _cid: 0, ...cand },
    });
    const two = media([['TiO2', 60], ['SiO2', 90]]);
    const merged = candidate(two, { pos: 0, materialId: 'TiO2' });
    ok('a gap needle of its neighbour\'s material merges: needleKept false, no layer added',
        merged.needleKept === false && merged.frontLayers.length === 2, `${merged.needleKept}, ${merged.frontLayers.length} layers`);
    const gap = candidate(two, { pos: 0, materialId: 'SiO2' });
    ok('a gap needle unlike both neighbours stays: needleKept true',
        gap.needleKept === true && gap.frontLayers.length === 3, `${gap.needleKept}, ${gap.frontLayers.length} layers`);
    const intra = candidate(two, { pos: 1.5, materialId: 'TiO2', intra: true, layerK: 1, frac: 0.5 });
    ok('a needle inside a layer stays: needleKept true',
        intra.needleKept === true && intra.frontLayers.length === 4, `${intra.needleKept}, ${intra.frontLayers.length} layers`);
    // Two SiO2 layers side by side merge in the refine whatever the needle does.
    const pair = candidate(media([['TiO2', 60], ['SiO2', 50], ['SiO2', 40]]), { pos: 0, materialId: 'SiO2' });
    ok('a stack with same-material neighbours is counted merged: a needle that stays is kept',
        pair.needleKept === true && pair.frontLayers.length === 3, `${pair.needleKept}, ${pair.frontLayers.length} layers`);
}

// ── 2. The forced step leaves out the insertions it is told to ───────────────
{
    const design = media([['TiO2', 60], ['SiO2', 90]]);
    const step = exclude => runJob({ type: 'geStep', operands: BBAR(), design, pool: POOL_LITE, dMin: 15, side: 'front', exclude });
    const first = step([]);
    const pick = { side: first.side, pos: first.pos, materialId: first.materialId };
    const second = step([pick]);
    ok('forced step: an insertion left out is not taken',
        !second.empty && !(second.pos === pick.pos && second.materialId === pick.materialId), JSON.stringify([pick, second.pos, second.materialId]));
    const all = [0, 2].flatMap(pos => ['TiO2', 'SiO2'].map(materialId => ({ side: 'front', pos, materialId })));
    ok('forced step: with every insertion left out there is none', step(all).empty === true);
}

// ── 3. The runner's rows, against a scripted worker ──────────────────────────
// Each job type takes its answers from `script[type]` in order, then falls back
// to: the seed kept at 0.30, no improving needle, nothing parked, a forced step
// at 0.32 whose layer merges into the last layer (15 nm thicker, same count),
// no layer freed, nothing consolidated.
const THICKEN_LAST = front => [...front.slice(0, -1), { ...front.at(-1), thickness: front.at(-1).thickness + 15 }];
const DEFAULTS = {
    seedDls: front => ({ mf: 0.30, omf: 0.30, frontLayers: front, backLayers: [], iters: 0 }),
    scan: () => ({ mf0: 0.3, candidates: [] }),
    dropParked: () => ({ removed: 0 }),
    geStep: front => ({ mf: 0.32, omf: 0.32, mfNew: 0.32, mf0: 0.3, frontLayers: THICKEN_LAST(front), backLayers: [], materialId: front.at(-1).material, pos: front.length, side: 'front', nLayers: front.length }),
    dropWeakest: () => ({ removed: 0 }),
    removePass: front => ({ removed: 0, mf: 0.3, frontLayers: front, backLayers: [] }),
};
const NONE = () => DEFAULTS.scan();
const ONE_NEEDLE = () => ({ mf0: 0.3, candidates: [{ dMF: -0.01, pos: 0, materialId: 'TiO2', side: 'front' }] });
const MERGED = mf => front => ({ mfNow: mf, omf: mf, needleKept: false, nLayers: front.length, backLayers: [],
    frontLayers: front.map(l => ({ ...l, thickness: l.thickness + 5 })) });
const KEPT = mf => (front, grow) => ({ mfNow: mf, omf: mf, needleKept: true, nLayers: front.length + 1, backLayers: [], frontLayers: grow('TiO2') });

function scriptedWorker(script, jobs) {
    return class {
        constructor() { this.onmessage = null; this.dead = false; }
        postMessage(job) {
            if (this.dead || !job || job.type === 'wasmInit') return;
            jobs.push(job);
            const front = job.design.frontLayers;
            const grow = mat => [...front, { id: `${mat}${front.length}`, material: mat, thickness: 20, locked: false }];
            const answer = (script[job.type] || []).shift() || DEFAULTS[job.type] || (() => ({}));
            const data = { type: 'result', ...answer(front, grow) };
            setTimeout(() => { if (!this.dead) this.onmessage?.({ data }); }, 0);
        }
        terminate() { this.dead = true; }
    };
}

// A narrow band for the scripted runs: the grid it is sampled on never grows
// with these stacks, so the runner does not re-score the scripted merits.
const NARROW = () => [O.makeOperand({ type: 'RAV', lambdaStart: 480, lambdaEnd: 520, aoi: 0, pol: 'avg', target: 0, weight: 1 })];

function geCtx(design, operands, settings) {
    const ctx = {
        runningRef: ref(false), timerRef: ref(null), workerRef: ref(null), dlsRef: ref(null),
        baseDesignRef: ref(null), savedDesignRef: ref(null), designRef: ref({ ...design, id: 'ge-rows' }),
        operandsRef: ref(operands.map(o => ({ ...o, enabled: true }))), cyclesRef: ref([]), genCountRef: ref(0), geStepsRef: ref(0),
        runsRef: ref([]), runOpenRef: ref(false), checkpointRef: ref(noop),
        updateDesignRef: ref(patch => { ctx.designRef.current = { ...ctx.designRef.current, ...patch }; }),
        maxLayersRef: ref(settings.maxLayers), maxGeCyclesRef: ref(settings.maxGeCycles), targetMFRef: ref(settings.targetMF),
        dlsIterRef: ref(settings.dlsIter), dMinRef: ref(settings.dMin),
        selectedCatsRef: ref([]), excludedMatsRef: ref([]),
        setPhase: noop, setStatusMsg: noop, setCanReset: noop, setMf: noop, setOmf: noop, setMfBest: noop, setOmfBest: noop,
        setCycles: noop, setGeneration: noop, setLayerCount: noop, setGeSteps: noop, reconcileBaseWithEdits: noop,
        stopOpt: () => { ctx.runningRef.current = false; },
        getPoolMaterials: () => POOL,
        t: EN,
    };
    return ctx;
}

async function runToEnd(run, ctx) {
    quiet();
    run(ctx);
    const t0 = Date.now();
    while (ctx.runningRef.current && Date.now() - t0 < 300000) await sleep(1);
    loud();
    ok('setup: the run finished', !ctx.runningRef.current);
}

const { runGeWorker } = await import('../src/components/windows/optimization/gradualEvolution/runners/workerPool.js');
{
    const jobs = [];
    const script = {
        scan: [ONE_NEEDLE, ONE_NEEDLE, ONE_NEEDLE, NONE, ONE_NEEDLE],
        candidate: [MERGED(0.28), KEPT(0.25), MERGED(0.24), MERGED(0.27)],
    };
    globalThis.Worker = scriptedWorker(script, jobs);
    const ctx = geCtx(media([['TiO2', 60], ['SiO2', 90]]), NARROW(), { maxLayers: 10, maxGeCycles: 2, targetMF: 1e-9, dlsIter: 10, dMin: 15 });
    await runToEnd(runGeWorker, ctx);
    ok('setup: the scripted run kept one wavelength grid', !logged.some(l => l.includes('Grid re-sampled')));
    const rows = ctx.cyclesRef.current;
    ok('runner: rows are Start, Refine, Needle, GE, GE', rows.map(r => r.type).join(',') === 'baseline,refine,needle,ge,ge', rows.map(r => r.type).join(','));
    const [start, refine, needle, ge] = rows;
    ok('runner: the Start row keeps the start design', start.mf === 0.30 && start.frontSnap.map(l => l.thickness).join('/') === '60/90');
    ok('runner: a merged step that is a new best after the Start row is a Refine row with the refined layers',
        refine.genNum === 2 && refine.mf === 0.28 && refine.frontSnap.map(l => l.thickness).join('/') === '65/95');
    ok('runner: a merged step after a Needle row folds into it', needle.genNum === 3 && needle.mf === 0.24 && needle.layerCount === 3,
        `${needle.genNum} ${needle.mf} ${needle.layerCount}`);
    ok('runner: the folded Needle row\'s dMF moves with its merit', Math.abs(needle.dMF - (0.24 - 0.28)) < 1e-12, String(needle.dMF));
    ok('runner: a merged step after a forced step that is no new best leaves the GE row as the step made it',
        ge.genNum === 4 && ge.mf === 0.32 && ge.layerCount === 3);
    const steps = jobs.filter(j => j.type === 'geStep');
    ok('runner: the first forced step leaves nothing out', steps[0]?.exclude?.length === 0);
    ok('runner: the forced step after an undone one, back on the same structure, leaves it out',
        steps[1]?.exclude?.length === 1 && steps[1].exclude[0].pos === 3 && steps[1].exclude[0].materialId === 'TiO2',
        JSON.stringify(steps[1]?.exclude));

    // A second Run after the first finished: its first merged step, a new best
    // for that Run, is a Refine row of that Run.
    Object.assign(script, { scan: [ONE_NEEDLE], candidate: [MERGED(0.26)] });
    await runToEnd(runGeWorker, ctx);
    const run2 = ctx.cyclesRef.current.filter(r => r.runNum === 2);
    ok('runner: in a new Run a merged first step is a Refine row of that Run', run2[0]?.type === 'refine' && run2[0]?.mf === 0.26,
        run2.map(r => `${r.type}:${r.mf}`).join(','));
    ok('runner: the first Run\'s rows are left as they were',
        ctx.cyclesRef.current.filter(r => r.runNum === 1).map(r => r.mf).join(',') === '0.3,0.28,0.24,0.32,0.32');
}

// ── 4. Broadband AR from TiO2 30 / SiO2 50, real synthesis jobs ──────────────
function needleRowsAddLayers(rows) {
    const bad = [];
    for (let i = 1; i < rows.length; i++) {
        if (rows[i].type === 'needle' && !(rows[i].layerCount > rows[i - 1].layerCount)) bad.push(rows[i].genNum);
    }
    return bad;
}
function repeatedGeRows(rows) {
    const ge = rows.filter(r => r.type === 'ge');
    const seen = new Map();
    const repeats = [];
    for (const r of ge) {
        const key = `${r.layerCount}|${r.mf.toPrecision(12)}`;
        if (seen.has(key)) repeats.push(`${seen.get(key)}=${r.genNum}`);
        else seen.set(key, r.genNum);
    }
    return repeats;
}
const sameStack = (a, b) => !!a && a.length === b.length && a.every((l, i) => l.material === b[i].material && Math.abs(l.thickness - b[i].thickness) < 1e-9);
const ARC = () => [tgt('RGT', 400, 700, 0)];
const SETTINGS = { maxLayers: 50, maxGeCycles: 16, targetMF: 5e-4, dlsIter: 30, dMin: 15 };
localStorage.setItem('tfstudio-synth-inner-engine-ge', 'sqp');
localStorage.setItem('tfstudio-synth-seed-mode', 'refine');
{
    // The Web Worker's own handler, run in process.
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
    const ctx = geCtx(media([['TiO2', 30], ['SiO2', 50]]), ARC(), SETTINGS);
    await runToEnd(runGeWorker, ctx);
    const rows = ctx.cyclesRef.current;
    ok('worker path: every Needle row adds a layer', needleRowsAddLayers(rows).length === 0, `generations ${needleRowsAddLayers(rows).join(', ')} do not`);
    ok('worker path: no two GE rows show the same layer count and merit', repeatedGeRows(rows).length === 0, repeatedGeRows(rows).join(', '));
    ok('worker path: the run took forced steps and needles', rows.some(r => r.type === 'ge') && rows.some(r => r.type === 'needle'));
    ok('worker path: the design the run ends on is a row of the history',
        rows.some(r => sameStack(r.frontSnap, ctx.designRef.current.frontLayers)));
}
{
    const { runGeMainThread } = await import('../src/components/windows/optimization/gradualEvolution/runners/mainThread.js');
    const ctx = geCtx(media([['TiO2', 30], ['SiO2', 50]]), ARC(), SETTINGS);
    await runToEnd(runGeMainThread, ctx);
    const rows = ctx.cyclesRef.current;
    ok('main thread: every Needle row adds a layer', needleRowsAddLayers(rows).length === 0, `generations ${needleRowsAddLayers(rows).join(', ')} do not`);
    ok('main thread: no two GE rows show the same layer count and merit', repeatedGeRows(rows).length === 0, repeatedGeRows(rows).join(', '));
    ok('main thread: the run took forced steps and needles', rows.some(r => r.type === 'ge') && rows.some(r => r.type === 'needle'));
    ok('main thread: the design the run ends on is a row of the history',
        rows.some(r => sameStack(r.layers, ctx.designRef.current.frontLayers)));
}

console.log(`=== GE history rows · WASM ${tmmWasmActive() ? 'ON' : 'off'} ===`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
