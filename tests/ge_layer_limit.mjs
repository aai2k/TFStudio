/**
 * Gradual Evolution at its layer limit: Max layers limits what GE builds, it
 * does not end the run.
 *
 *   1. removeWeakestLayer takes out the layer whose removal costs least, tries
 *      each resulting structure (material sequence, neighbours merged) once,
 *      and leaves out the structures it is told to.
 *   2. fitsLayerLimit: a needle inside a layer needs two free layers, a gap
 *      needle one, and a gap needle that merges into a neighbour none.
 *   3. The synthesis worker's forced step with a layer limit offers only
 *      insertions that fit; its dropWeakest job returns the design without
 *      one layer, with the merit of that design and the structure it left.
 *   4. Runner, against a scripted worker: at the limit a needle that does not
 *      fit is not refined, the run frees a layer (a dropWeakest job and a Clean
 *      row) instead of finishing, and it ends on its GE-step budget.
 *   5. Broadband AR 400-700 nm from TiO2 30 / SiO2 50 nm on BK7, 15 nm floor,
 *      Sequential QP, seed refined first, at most 7 layers, run with the real
 *      synthesis jobs (worker path, in process) and on the main thread: the run
 *      keeps searching after it first reaches 7 layers, ends better than it was
 *      then, and never holds more than 7 layers.
 *
 * Run: node tests/ge_layer_limit.mjs
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
const { fitsLayerLimit } = await import('../src/components/windows/optimization/gradualEvolution/runners/undoneSteps.js');

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
const structureOf = layers => layers.map(l => l.material).join('|');
const POOL = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: rm(id) }));
const ARC = () => [O.makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 })];
const fullMF = (ops, d) => O.calcMF(ops, O.evaluateOperands(ops, O.buildEvalContext(d, rm)));
const relClose = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-300);
const runJob = (job) => { let out; dispatchSynthesisJob(job, rm, m => { if (m.type !== 'tick') out = m; }); return out; };
const _log = console.log;
let logged = [];
const quiet = () => { logged = []; console.log = (...a) => { logged.push(a.join(' ')); }; };
const loud = () => { console.log = _log; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ref = v => ({ current: v });
const noop = () => {};

// ── 1. removeWeakestLayer ────────────────────────────────────────────────────
{
    // T S T S T: taking out layer 1, 2 or 3 leaves T S T once the neighbours
    // merge; layer 0 leaves S T S T and layer 4 leaves T S T S.
    const design = media([['TiO2', 50], ['SiO2', 80], ['TiO2', 50], ['SiO2', 80], ['TiO2', 50]]);
    const merit = { 'SiO2|TiO2|SiO2|TiO2': 0.5, 'TiO2|SiO2|TiO2': 0.3, 'TiO2|SiO2|TiO2|SiO2': 0.4, 'TiO2|SiO2|TiO2|SiO2|TiO2': 0.2 };
    let calls = 0;
    const refineFn = d => { calls++; return { design: d, mf: merit[structureOf(d.frontLayers)], omf: 0 }; };
    const best = O.removeWeakestLayer({ design, dMin: 15, refineFn });
    ok('removeWeakestLayer: takes out the layer whose removal costs least', best?.mf === 0.3 && best?.i === 1 && best?.structure === 'TiO2|SiO2|TiO2',
        JSON.stringify(best && { i: best.i, mf: best.mf, structure: best.structure }));
    ok('removeWeakestLayer: tries each resulting structure once (a baseline and three trials)', calls === 4, `${calls} refines`);
    ok('removeWeakestLayer: reports the merit it removed from', best?.baseMf === 0.2);
    const next = O.removeWeakestLayer({ design, dMin: 15, refineFn, skip: ['TiO2|SiO2|TiO2'] });
    ok('removeWeakestLayer: a structure it is told to leave out is not taken', next?.structure === 'TiO2|SiO2|TiO2|SiO2' && next?.i === 4,
        JSON.stringify(next && { i: next.i, structure: next.structure }));
    ok('removeWeakestLayer: nothing to take out when every structure is left out',
        O.removeWeakestLayer({ design, dMin: 15, refineFn, skip: Object.keys(merit) }) === null);
}

// ── 2. fitsLayerLimit ────────────────────────────────────────────────────────
{
    const layers = n => Array.from({ length: n }, (_, i) => ({ material: i % 2 ? 'SiO2' : 'TiO2', locked: false }));
    ok('fits: a needle inside a layer at 5 of 7', fitsLayerLimit({ intra: true, layerK: 0 }, layers(5), 7));
    ok('fits: no needle inside a layer at 6 of 7', !fitsLayerLimit({ intra: true, layerK: 0 }, layers(6), 7));
    // In T S T S T S, gap 6 lies past the last layer (S): a TiO2 needle there is new.
    ok('fits: a new gap layer at 6 of 7', fitsLayerLimit({ pos: 6, materialId: 'TiO2' }, layers(6), 7));
    ok('fits: no new gap layer at 7 of 7', !fitsLayerLimit({ pos: 7, materialId: 'SiO2' }, layers(7), 7));
    ok('fits: a gap needle that merges into a neighbour at 7 of 7', fitsLayerLimit({ pos: 7, materialId: 'TiO2' }, layers(7), 7));
}

// ── 3. The worker's forced step and dropWeakest job ──────────────────────────
{
    // TiO2 on top, SiO2 at the substrate: TiO2 at gap 0 and SiO2 at gap 2
    // merge into the outer layers; the other two insertions add a layer.
    const design = media([['TiO2', 60], ['SiO2', 90]]);
    const merges = [{ side: 'front', pos: 0, materialId: 'TiO2' }, { side: 'front', pos: 2, materialId: 'SiO2' }];
    const step = (maxLayers, exclude = []) => runJob({ type: 'geStep', operands: ARC(), design, pool: POOL.map(p => ({ id: p.id, name: p.name })),
        dMin: 15, side: 'front', maxLayers, exclude });
    const newLayer = step(0, merges);
    ok('setup: with no limit and the merges left out, the forced step adds a layer', newLayer.nLayers === 3, `${newLayer.nLayers} layers`);
    ok('forced step at the limit: an insertion that would add a layer is not offered', step(2, merges).empty === true);
    const limited = step(2);
    ok('forced step at the limit: an insertion that merges into an outer layer still is', !limited.empty && limited.nLayers === 2
        && limited.materialId === (limited.pos === 0 ? 'TiO2' : 'SiO2'), JSON.stringify({ pos: limited.pos, materialId: limited.materialId, n: limited.nLayers }));

    const five = media([['SiO2', 90], ['TiO2', 30], ['SiO2', 20], ['TiO2', 50], ['SiO2', 100]]);
    const r = runJob({ type: 'dropWeakest', operands: ARC(), design: five, dMin: 15, dlsIter: 20, jobId: 'w', side: 'front', engine: 'sqp', skip: [] });
    const out = { ...five, frontLayers: r.frontLayers, backLayers: r.backLayers };
    ok('dropWeakest job: one layer out, neighbours merged', r.removed === 1 && r.frontLayers.length < 5 && r.structure === structureOf(r.frontLayers),
        `${r.frontLayers.length} layers, ${r.structure}`);
    ok('dropWeakest job: reports the merit of the design it returns', relClose(r.mf, fullMF(ARC(), out)));
    const again = runJob({ type: 'dropWeakest', operands: ARC(), design: five, dMin: 15, dlsIter: 20, jobId: 'w', side: 'front', engine: 'sqp', skip: [r.structure] });
    ok('dropWeakest job: leaves out the structures it is told to', again.removed === 1 && again.structure !== r.structure);
}

// ── 4. The runner at the limit, against a scripted worker ────────────────────
function geCtx(design, operands, settings) {
    const ctx = {
        runningRef: ref(false), timerRef: ref(null), workerRef: ref(null), dlsRef: ref(null),
        baseDesignRef: ref(null), savedDesignRef: ref(null), designRef: ref({ ...design, id: 'ge-limit' }),
        operandsRef: ref(operands.map(o => ({ ...o, enabled: true }))), cyclesRef: ref([]), genCountRef: ref(0), geStepsRef: ref(0),
        runsRef: ref([]), runOpenRef: ref(false), checkpointRef: ref(noop),
        updateDesignRef: ref(patch => { ctx.designRef.current = { ...ctx.designRef.current, ...patch }; }),
        maxLayersRef: ref(settings.maxLayers), maxGeCyclesRef: ref(settings.maxGeCycles), targetMFRef: ref(settings.targetMF),
        dlsIterRef: ref(settings.dlsIter), dMinRef: ref(settings.dMin),
        selectedCatsRef: ref([]), excludedMatsRef: ref([]),
        setPhase: noop, setStatusMsg: v => { ctx.status = v; }, setCanReset: noop, setMf: noop, setOmf: noop, setMfBest: noop, setOmfBest: noop,
        setCycles: noop, setGeneration: noop, setLayerCount: noop, setGeSteps: noop, reconcileBaseWithEdits: noop,
        stopOpt: () => { ctx.runningRef.current = false; },
        getPoolMaterials: () => POOL,
        t: { gradualEvolution: { noOperands: 'no operands', smartSeeding: n => `seeding ${n}` } },
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
    // Seed of 2 layers, limit 3. The first needle stays (3 layers, at the
    // limit). The next scan offers only a needle inside a layer, which needs
    // two free layers. The run then frees a layer and goes on until its
    // GE-step budget of 3 is spent.
    const jobs = [];
    const NARROW = [O.makeOperand({ type: 'RAV', lambdaStart: 480, lambdaEnd: 520, aoi: 0, pol: 'avg', target: 0, weight: 1 })];
    let scans = 0;
    globalThis.Worker = class {
        constructor() { this.onmessage = null; this.dead = false; }
        postMessage(job) {
            if (this.dead || !job || job.type === 'wasmInit') return;
            jobs.push(job);
            const front = job.design.frontLayers;
            const answers = {
                seedDls: () => ({ mf: 0.30, omf: 0.30, frontLayers: front, backLayers: [], iters: 0 }),
                scan: () => {
                    scans++;
                    if (scans === 1) return { mf0: 0.3, candidates: [{ dMF: -0.01, pos: 2, materialId: 'TiO2', side: 'front' }] };
                    return { mf0: 0.3, candidates: [{ dMF: -0.01, pos: 0.5, materialId: 'SiO2', side: 'front', intra: true, layerK: 0, frac: 0.5 }] };
                },
                candidate: () => ({ mfNow: 0.25, omf: 0.25, needleKept: true, nLayers: front.length + 1, backLayers: [],
                    frontLayers: [...front, { id: `n${front.length}`, material: 'TiO2', thickness: 20, locked: false }] }),
                dropParked: () => ({ removed: 0 }),
                dropWeakest: () => ({ removed: 1, i: 1, structure: structureOf(front.filter((_, j) => j !== 1)), mf: 0.27, omf: 0.27, baseMf: 0.25, side: 'front',
                    frontLayers: front.filter((_, j) => j !== 1), backLayers: [], nLayers: front.length - 1 }),
                geStep: () => ({ mf: 0.33, omf: 0.33, mfNew: 0.33, mf0: 0.3, side: 'front', materialId: front.at(-1).material, pos: front.length, nLayers: front.length,
                    frontLayers: [...front.slice(0, -1), { ...front.at(-1), thickness: front.at(-1).thickness + 15 }], backLayers: [] }),
                removePass: () => ({ removed: 0, mf: 0.25, frontLayers: front, backLayers: [] }),
            };
            const data = { type: 'result', ...(answers[job.type] || (() => ({})))() };
            setTimeout(() => { if (!this.dead) this.onmessage?.({ data }); }, 0);
        }
        terminate() { this.dead = true; }
    };
    const ctx = geCtx(media([['TiO2', 60], ['SiO2', 90]]), NARROW, { maxLayers: 3, maxGeCycles: 3, targetMF: 1e-9, dlsIter: 10, dMin: 15 });
    await runToEnd(runGeWorker, ctx);
    const kinds = jobs.map(j => j.type);
    const candidates = jobs.filter(j => j.type === 'candidate');
    ok('runner at the limit: a needle that does not fit is not refined', candidates.length === 1 && !candidates[0].cand.intra, `${candidates.length} candidate jobs`);
    ok('runner at the limit: frees a layer instead of finishing', kinds.includes('dropWeakest') && ctx.cyclesRef.current.some(r => r.type === 'clean' && r.layerCount === 2),
        ctx.cyclesRef.current.map(r => `${r.type}:${r.layerCount}`).join(','));
    ok('runner at the limit: the first freeing leaves nothing out', jobs.find(j => j.type === 'dropWeakest')?.skip?.length === 0);
    ok('runner at the limit: ends on the GE-step budget, not on the layer limit', ctx.status === 'Max GE steps reached', ctx.status);
}

// ── 5. Broadband AR at most 7 layers, real synthesis jobs ────────────────────
localStorage.setItem('tfstudio-synth-inner-engine-ge', 'sqp');
localStorage.setItem('tfstudio-synth-seed-mode', 'refine');
const SETTINGS = { maxLayers: 7, maxGeCycles: 16, targetMF: 5e-4, dlsIter: 30, dMin: 15 };
function afterLimit(rows) {
    const first = rows.findIndex(r => r.layerCount >= 7);
    return { first, atLimit: first >= 0 ? rows[first].mf : null, later: rows.slice(first + 1) };
}
{
    const types = [];
    globalThis.Worker = class {
        constructor() { this.onmessage = null; this.dead = false; }
        postMessage(job) {
            if (this.dead || !job || job.type === 'wasmInit') return;
            types.push(job.type);
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
    const { first, atLimit, later } = afterLimit(rows);
    ok('worker path: the run reaches 7 layers', first >= 0);
    ok('worker path: it keeps searching after that', types.includes('dropWeakest') && later.length > 0 && ctx.status !== 'Max layers reached', ctx.status);
    ok('worker path: it ends better than it was at the limit', Math.min(...rows.map(r => r.mf)) < atLimit - 1e-9,
        `${Math.min(...rows.map(r => r.mf))} vs ${atLimit}`);
    ok('worker path: no row and no final design holds more than 7 layers',
        rows.every(r => r.layerCount <= 7) && ctx.designRef.current.frontLayers.length <= 7);
}
{
    const { runGeMainThread } = await import('../src/components/windows/optimization/gradualEvolution/runners/mainThread.js');
    const ctx = geCtx(media([['TiO2', 30], ['SiO2', 50]]), ARC(), SETTINGS);
    await runToEnd(runGeMainThread, ctx);
    const rows = ctx.cyclesRef.current;
    const { first, atLimit, later } = afterLimit(rows);
    ok('main thread: the run reaches 7 layers', first >= 0);
    ok('main thread: it keeps searching after that', later.length > 0 && logged.some(l => l.includes('Freed a layer')) && ctx.status !== 'Max layers reached', ctx.status);
    ok('main thread: it ends better than it was at the limit', Math.min(...rows.map(r => r.mf)) < atLimit - 1e-9,
        `${Math.min(...rows.map(r => r.mf))} vs ${atLimit}`);
    ok('main thread: no row and no final design holds more than 7 layers',
        rows.every(r => r.layerCount <= 7) && ctx.designRef.current.frontLayers.length <= 7);
}

console.log(`=== GE at its layer limit · WASM ${tmmWasmActive() ? 'ON' : 'off'} ===`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
