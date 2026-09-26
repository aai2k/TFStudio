/**
 * Synthesis at the thickness floor dMin.
 *
 *   1. A refine that starts with a layer below dMin works on the design it can
 *      return: every engine starts from the start projected into the box and
 *      reports the merit of a design with no layer below the floor. Before, an
 *      engine whose every projected trial scored worse than the out-of-box
 *      start handed that start back unrefined, with its merit.
 *   2. The needle scans do not offer an intra-layer split that leaves a half of
 *      the host thinner than dMin, and the synthesis worker's scan job passes
 *      the floor through.
 *   3. A synthesis candidate reports the merit of the design it returns.
 *   4. Gradual Evolution compares every needle with the full merit of the
 *      working design after a forced step, not with the optical merit the
 *      forced step was ranked on (a TT row off target makes the two differ).
 *   5. Automatic synthesis scans SYNTHESIS_INTRA_SAMPLES positions per layer
 *      and sends the floor with every scan job.
 *   6. Needle tries the candidate a generation accepts without the layers its
 *      refine parked on the floor, once per generation, and keeps whichever
 *      merit is lower.
 *
 * Run: node tests/synthesis_thickness_floor.mjs
 */
import { shimBrowserGlobals, useImmediateTimers } from './_uiShim.mjs';
import { initWasmForTest, tmmWasmActive } from './_wasmInit.mjs';

shimBrowserGlobals();
useImmediateTimers();
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 1 }, configurable: true, writable: true });
await initWasmForTest();

const O = await import('../src/utils/physics/optimizer.js');
const { makeEngine } = await import('../src/utils/optimizers/index.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { dispatchSynthesisJob } = await import('../src/utils/workers/synthesisWorker.js');
const { SYNTHESIS_INTRA_SAMPLES } = await import('../src/utils/synthesis/synthesisConfig.js');
const { needleManualSession } = await import('../src/components/windows/optimization/needleManual/sessionState.js');

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
const fullMF = (ops, d) => O.calcMF(ops, O.evaluateOperands(ops, O.buildEvalContext(d, rm)));
const relClose = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-300);
const run = (job) => { let out; dispatchSynthesisJob(job, rm, m => { if (m.type !== 'tick') out = m; }); return out; };
const POOL = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: rm(id) }));
const _log = console.log;
const quiet = () => { console.log = () => {}; };
const loud = () => { console.log = _log; };

// ── 1. Out-of-box start ──────────────────────────────────────────────────────
// MgF2 / TiO2 / SiO2 on BK7, RAV 500-600 nm = 0. Refined with a 0.01 nm floor
// the TiO2 settles near 9.8 nm; that optimum is then refined under dMin 15.
{
    const rav = [O.makeOperand({ type: 'RAV', lambdaStart: 500, lambdaEnd: 600, aoi: 0, pol: 'avg', target: 0, weight: 1 })];
    const mk = t => media([['MgF2', t[0]], ['TiO2', t[1]], ['SiO2', t[2]]]);
    const e0 = makeEngine('sqp', rav, mk([129, 15, 219]), rm, { dMin: 0.01 });
    for (let i = 0; i < 400 && !e0.isConverged(); i++) e0.step();
    const start = e0.thicknesses.slice();
    ok('setup: the unconstrained optimum has its TiO2 below 15 nm', start[1] < 15, `TiO2 ${start[1].toFixed(3)} nm`);
    for (const eng of ['dls', 'cg', 'newton', 'newton-cg', 'sqp']) {
        const e = makeEngine(eng, rav, mk(start), rm, { dMin: 15 });
        ok(`${eng}: starts inside the box`, e.thicknesses.every(d => d >= 15));
        ok(`${eng}: starting merit is the merit of the projected start`,
            relClose(e.mf, fullMF(rav, e.applyToDesign(mk(start)))));
        for (let i = 0; i < 400 && !e.isConverged(); i++) e.step();
        const out = e.applyToDesign(mk(start));
        ok(`${eng}: returns no layer below the floor`, out.frontLayers.every(l => l.thickness >= 15),
            out.frontLayers.map(l => l.thickness.toFixed(3)).join('/'));
        ok(`${eng}: reports the merit of the design it returns`, relClose(e.mf, fullMF(rav, out)));
    }
}

// ── 2. Intra splits below the floor ─────────────────────────────────────────
// SiO2 100 nm seed, BBAR 420-680 nm, floor 40 nm: only splits between 40 % and
// 60 % of the host leave both halves at 40 nm or more.
{
    const bbar = [O.makeOperand({ type: 'TGT', lambdaStart: 420, lambdaEnd: 680, aoi: 0, pol: 'avg', target: 1, targetEnd: 1, weight: 1 })];
    const seed = media([['SiO2', 100]]);
    const halvesFit = c => c.frac * 100 >= 40 - 1e-9 && (1 - c.frac) * 100 >= 40 - 1e-9;
    const args = { operands: bbar, design: seed, resolveMat: rm, candidateMats: POOL, deltaNm: 0.5, side: 'front', nIntra: 16 };
    const unfloored = O.scanNeedlesPFunction(args).candidates.filter(c => c.intra);
    ok('setup: without a floor the scan offers splits leaving a half under 40 nm', unfloored.some(c => !halvesFit(c)));
    for (const [name, scan] of [['analytic', O.scanNeedlesAnalytic], ['finite-difference', O.scanNeedlesFD]]) {
        const intra = scan({ ...args, dMin: 40 }).candidates.filter(c => c.intra);
        ok(`${name} scan: every intra split leaves both halves at the floor or above`, intra.every(halvesFit),
            intra.filter(c => !halvesFit(c)).map(c => c.frac.toFixed(3)).join(', '));
        ok(`${name} scan: the splits that fit are still offered`, intra.length > 0);
    }
    const job = run({ type: 'scan', operands: bbar, design: seed, poolSlice: POOL.map(p => ({ id: p.id, name: p.name })),
        deltaNm: 0.5, side: 'front', dMin: 40, nIntra: 16 });
    const jobIntra = job.candidates.filter(c => c.intra);
    ok('worker scan job: honours the floor', jobIntra.length > 0 && jobIntra.every(halvesFit));
}

// ── 3. Reported merit of a synthesis candidate ──────────────────────────────
// Broadband AR 400-700 nm from TiO2 30 / SiO2 50, floor 15 nm. A SiO2 needle
// split into the TiO2 at 40 % leaves a 12 nm TiO2 half. The candidate's merit
// must be the merit of the design the worker hands back.
{
    const rgt = [O.makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 })];
    const design = media([['TiO2', 30], ['SiO2', 50]]);
    const cand = { materialId: 'SiO2', intra: true, layerK: 0, frac: 0.4, pos: 0.4, dMF: -1e-3, side: 'front', _cid: 0 };
    for (const pipeline of ['needle', 'ge']) {
        const r = run({ type: 'candidate', pipeline, operands: rgt, design, cand: { ...cand }, dMin: 15, dlsIter: 60, jobId: 'c', side: 'front', engine: 'cg' });
        const out = { ...design, frontLayers: r.frontLayers, backLayers: r.backLayers };
        const reported = pipeline === 'ge' ? r.mfNow : r.mfAfter;
        ok(`${pipeline} candidate: no layer below the floor`, r.frontLayers.every(l => l.thickness >= 15));
        ok(`${pipeline} candidate: reported merit is the merit of the returned design`, relClose(reported, fullMF(rgt, out)),
            `reported ${reported.toExponential(4)}, design ${fullMF(rgt, out).toExponential(4)}`);
    }
}

// ── 4. Gradual Evolution keeps one merit ────────────────────────────────────
const tt = O.makeOperand({ type: 'TT', target: 1000, weight: 1 });
const geOps = [O.makeOperand({ type: 'RAV', lambdaStart: 480, lambdaEnd: 520, aoi: 0, pol: 'avg', target: 0, weight: 1 }), tt];
const geSeed = () => media([['TiO2', 60], ['SiO2', 90]]);

// Drive runGeWorker (seed 0.30) against a mock synthesis worker. `answer(job,
// front, grow)` gives the result fields for a job, or null for the defaults:
// seedDls keeps the seed, scans find nothing, a forced step adds a layer,
// dropParked finds nothing parked, consolidation removes nothing.
const GE_MOCK_DEFAULTS = {
    seedDls: front => ({ mf: 0.30, omf: 0.20, frontLayers: front, backLayers: [], iters: 0 }),
    scan: () => ({ mf0: 0.2, candidates: [] }),
    geStep: (front, grow) => ({ mf: 0.32, omf: 0.22, mfNew: 0.22, mf0: 0.2, frontLayers: grow('SiO2'), backLayers: [], materialId: 'SiO2', pos: front.length, side: 'front', nLayers: front.length + 1 }),
    dropParked: () => ({ removed: 0 }),
    removePass: front => ({ removed: 0, mf: 0.3, frontLayers: front, backLayers: [] }),
};
async function runGeMock(answer, maxGeCycles = 1) {
    const jobs = [];
    class MockWorker {
        constructor() { this.onmessage = null; this.dead = false; }
        postMessage(job) {
            if (this.dead || !job || job.type === 'wasmInit') return;
            jobs.push(job);
            const front = job.design.frontLayers;
            const grow = mat => [...front, { id: `${mat}${front.length}`, material: mat, thickness: 20, locked: false }];
            const fallback = GE_MOCK_DEFAULTS[job.type] || (() => ({}));
            const data = { type: 'result', ...(answer(job, front, grow) || fallback(front, grow)) };
            setTimeout(() => { if (!this.dead) this.onmessage?.({ data }); }, 0);
        }
        terminate() { this.dead = true; }
    }
    globalThis.Worker = MockWorker;
    const { runGeWorker } = await import('../src/components/windows/optimization/gradualEvolution/runners/workerPool.js');
    const ref = v => ({ current: v });
    const noop = () => {};
    const seed = geSeed();
    const ctx = {
        runningRef: ref(false), timerRef: ref(null), workerRef: ref(null), dlsRef: ref(null),
        baseDesignRef: ref(null), savedDesignRef: ref(null), designRef: ref({ ...seed, id: 'ge-runner' }),
        operandsRef: ref(geOps), cyclesRef: ref([]), genCountRef: ref(0), geStepsRef: ref(0),
        runsRef: ref([]), runOpenRef: ref(false), updateDesignRef: ref(noop), checkpointRef: ref(noop),
        maxLayersRef: ref(10), maxGeCyclesRef: ref(maxGeCycles), targetMFRef: ref(1e-9), dlsIterRef: ref(10), dMinRef: ref(15),
        selectedCatsRef: ref([]), excludedMatsRef: ref([]),
        setPhase: noop, setStatusMsg: noop, setCanReset: noop, setMf: noop, setOmf: noop, setMfBest: noop, setOmfBest: noop,
        setCycles: noop, setGeneration: noop, setLayerCount: noop, setGeSteps: noop, reconcileBaseWithEdits: noop,
        stopOpt: () => { ctx.runningRef.current = false; },
        getPoolMaterials: () => POOL,
        t: { gradualEvolution: { noOperands: 'no operands', smartSeeding: n => `seeding ${n}` } },
    };
    quiet();
    runGeWorker(ctx);
    const t0 = Date.now();
    while (ctx.runningRef.current && Date.now() - t0 < 30000) await new Promise(r => setTimeout(r, 1));
    loud();
    return { types: ctx.cyclesRef.current.map(c => c.type), jobs };
}

{
    // The worker's forced step reports the full merit of the design it returns.
    const r = run({ type: 'geStep', operands: geOps, design: geSeed(), pool: POOL.map(p => ({ id: p.id, name: p.name })), dMin: 15, side: 'front' });
    const out = { ...geSeed(), frontLayers: r.frontLayers, backLayers: r.backLayers };
    ok('GE step (worker): mf is the full merit of the returned design', relClose(r.mf, fullMF(geOps, out)));
    ok('GE step (worker): omf is its optical merit',
        relClose(r.omf, O.calcMF(geOps, O.evaluateOperands(geOps, O.buildEvalContext(out, rm)), { skipConstraints: true })));
    ok('GE step (worker): the TT row puts the full merit above the optical one', r.mf > r.omf * 1.5);
}
// The main-thread forced step stores the full merit of the stepped design as
// the working merit, whatever the inner engine. With an MNT row above dMin and
// a pool material unlike either seed layer, the forced layer stays a separate
// 15 nm layer below MNT, which an SQP engine lifts to MNT when it is built.
const mnt40 = O.makeConstraintOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: O.DEFAULT_CONSTRAINT_LAST_LAYER, target: 40, weight: 1 });
const MGF2_POOL = [{ id: 'MgF2', name: 'MgF2', mat: rm('MgF2') }];
for (const [innerEngine, stepOps, pool] of [['cg', geOps, POOL], ['sqp', [...geOps, mnt40], MGF2_POOL]]) {
    const { forcedStep } = await import('../src/components/windows/optimization/gradualEvolution/runners/mainThreadGeStep.js');
    const ref = v => ({ current: v });
    const noop = () => {};
    const seed = geSeed();
    const ctx = {
        baseDesignRef: ref(seed), savedDesignRef: ref(null), designRef: ref({ ...seed, id: 'ge-merit' }), updateDesignRef: ref(noop),
        geStepsRef: ref(0), maxGeCyclesRef: ref(5), maxLayersRef: ref(20), dMinRef: ref(15),
        dlsIterRef: ref(30), targetMFRef: ref(1e-9),
        selectedCatsRef: ref([]), excludedMatsRef: ref([]), getPoolMaterials: () => pool,
        cyclesRef: ref([]), genCountRef: ref(0), runsRef: ref([]), timerRef: ref(null), dlsRef: ref(null), runningRef: ref(true),
        setGeSteps: noop, setCycles: noop, setGeneration: noop, setLayerCount: noop, setMfBest: noop,
        setOmf: noop, setOmfBest: noop, setPhase: noop, setStatusMsg: noop,
    };
    const S = {
        side: 'front', LK: 'frontLayers', operands: stepOps, innerEngine, runT0: 0,
        work: { mf: 1, front: seed.frontLayers }, best: { mf: 1, front: seed.frontLayers },
        curMF: { v: null }, tick: noop, pool,
    };
    quiet();
    forcedStep(ctx, S);
    loud();
    const stepped = { ...seed, frontLayers: S.work.front };
    if (pool === MGF2_POOL) {
        ok('setup: the forced MgF2 layer stays a separate layer below MNT',
            stepped.frontLayers.some(l => l.material === 'MgF2' && l.thickness < 40));
    }
    ok(`GE step (main thread, ${innerEngine}): work.mf is the full merit of the stepped design`, relClose(S.work.mf, fullMF(stepOps, stepped)),
        `work.mf ${S.work.mf}, full ${fullMF(stepOps, stepped)}`);
}
{
    // Runner: after a forced step whose full merit sits above its optical
    // merit, a needle whose full merit lies between the two lowers the working
    // merit and must be accepted.
    let scans = 0;
    const { types, jobs } = await runGeMock((job, front, grow) => {
        switch (job.type) {
            case 'scan': scans++; return { mf0: 0.2, candidates: scans === 2 ? [{ dMF: -0.01, pos: 0, materialId: 'TiO2', side: 'front' }] : [] };
            case 'geStep': return { mf: 0.40, omf: 0.25, mfNew: 0.25, mf0: 0.2, frontLayers: grow('SiO2'), backLayers: [], materialId: 'SiO2', pos: front.length, side: 'front', nLayers: front.length + 1 };
            case 'candidate': return { mfNow: 0.35, omf: 0.24, frontLayers: grow('TiO2'), backLayers: [], nLayers: front.length + 1, needleKept: true };
            default: return null;
        }
    });
    ok('GE runner: the needle after the forced step is accepted', types.join(',').includes('ge,needle'), types.join(','));
    const scanJobs = jobs.filter(j => j.type === 'scan');
    ok('GE runner: scan jobs carry the floor and the intra sample count',
        scanJobs.length > 0 && scanJobs.every(j => j.dMin === 15 && j.nIntra === SYNTHESIS_INTRA_SAMPLES));
}

// ── 4b. Parked layers when Gradual Evolution stalls ─────────────────────────
{
    // Broadband AR 400-700 nm, floor 15 nm: a TiO2 layer on top that the
    // merit wants gone is held on the floor. The worker's dropParked job
    // takes it out and refines what is left.
    const rgt = [O.makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 })];
    const design = media([['TiO2', 15], ['SiO2', 57.4], ['TiO2', 15]]);
    const r = run({ type: 'dropParked', operands: rgt, design, dMin: 15, dlsIter: 30, jobId: 'd', side: 'front', engine: 'cg' });
    const out = { ...design, frontLayers: r.frontLayers || [], backLayers: r.backLayers || [] };
    ok('dropParked: takes the parked layers out', r.removed >= 1 && out.frontLayers.length < 3, JSON.stringify(r.removed));
    ok('dropParked: reports the merit of the design it returns', r.removed >= 1 && relClose(r.mf, fullMF(rgt, out)));
    ok('dropParked: the stack without them is better here', r.removed >= 1 && r.mf < fullMF(rgt, design));
}
{
    // Runner: when needle optimization stalls, a design without its parked
    // layers that beats the best so far is taken before any forced step; one
    // that does not is left, and the forced step runs.
    const kept = await runGeMock((job, front) => (job.type === 'dropParked' && front.length === 2
        ? { removed: 1, mf: 0.25, omf: 0.2, frontLayers: front.slice(1), backLayers: [], nLayers: 1, side: 'front' } : null));
    ok('GE runner: a better design without the parked layers is taken as a clean step', kept.types.join(',') === 'baseline,clean,ge', kept.types.join(','));
    const left = await runGeMock((job, front) => (job.type === 'dropParked'
        ? { removed: 1, mf: 0.31, omf: 0.2, frontLayers: front.slice(1), backLayers: [], nLayers: front.length - 1, side: 'front' } : null));
    ok('GE runner: a worse one is left and the forced step runs', left.types.join(',') === 'baseline,ge', left.types.join(','));
}

// ── 5. Intra sampling density ───────────────────────────────────────────────
ok('automatic synthesis samples as many positions per layer as the Needle window profile',
    SYNTHESIS_INTRA_SAMPLES === needleManualSession.peek(null).nIntra,
    `${SYNTHESIS_INTRA_SAMPLES} vs ${needleManualSession.peek(null).nIntra}`);
{
    // Near copies of one insertion do not crowd the candidate queue: along a
    // layer only the minima of the needle function are kept.
    const c = (frac, dMF) => ({ intra: true, side: 'front', layerK: 0, materialId: 'TiO2', frac, dMF });
    const kept = typeof O.intraMinima === 'function'
        ? O.intraMinima([c(0.2, -1), c(0.4, -3), c(0.6, -2), c(0.8, -4), { pos: 1, materialId: 'TiO2', dMF: -5 }])
        : [];
    ok('intra candidates are reduced to the minima along the layer; gaps pass through',
        kept.map(k => k.intra ? k.frac : `g${k.pos}`).sort().join(',') === '0.4,0.8,g1');
}

// ── 6. Parked layers in a Needle generation ─────────────────────────────────
// MgF2 / TiO2 / SiO2 on BK7, RAV 500-600 nm = 0, floor 15 nm. The candidate job
// refines once; the dropParked job then takes the parked layers out and
// refines what is left, and the runner keeps it when its merit is no higher.
{
    const rav = [O.makeOperand({ type: 'RAV', lambdaStart: 500, lambdaEnd: 600, aoi: 0, pol: 'avg', target: 0, weight: 1 })];
    const parkedIn = (d) => {
        const e = makeEngine('dls', rav, d, rm, { dMin: 15 });
        const g = e.gradMF(e.thicknesses);
        return e.thicknesses.filter((t, i) => t <= 15 && g[i] > 0).length;
    };
    const candidate = (design, cand, engine) => {
        const r = run({ type: 'candidate', pipeline: 'needle', operands: rav, design, dMin: 15, dlsIter: 60, jobId: 'p', side: 'front', engine,
            cand: { ...cand, dMF: -1, side: 'front', _cid: 0 } });
        return { ...design, frontLayers: r.frontLayers, mfAfter: r.mfAfter };
    };
    const withoutParked = (design, engine) => {
        const r = run({ type: 'dropParked', operands: rav, design, dMin: 15, dlsIter: 30, jobId: 'd', side: 'front', engine });
        return { ...r, design: { ...design, frontLayers: r.frontLayers || [] } };
    };
    const describe = d => d.frontLayers.map(l => `${l.material} ${l.thickness.toFixed(2)}`).join(' / ');
    // A TiO2 needle on top of the refined three-layer stack only hurts.
    const useless = candidate(media([['MgF2', 73.838], ['TiO2', 99.660], ['SiO2', 183.640]]), { pos: 0, materialId: 'TiO2' }, 'dls');
    ok('needle candidate: refines once and leaves the parked layers for the runner', parkedIn(useless) >= 1, describe(useless));
    ok('needle candidate: reports the merit of the design it returns', relClose(useless.mfAfter, fullMF(rav, useless)));
    const trimmed = withoutParked(useless, 'dls');
    ok('dropParked: takes out the parked layers the merit does not need', trimmed.removed === parkedIn(useless) && parkedIn(trimmed.design) === 0,
        describe(trimmed.design));
    ok('dropParked: the stack without it is no worse, so the runner takes it', trimmed.mf <= useless.mfAfter,
        `${trimmed.mf} vs ${useless.mfAfter}`);
    ok('dropParked: reports the merit of the design it returns', relClose(trimmed.mf, fullMF(rav, trimmed.design)));
    // The three-layer optimum under the floor has its TiO2 parked at 15 nm;
    // without it the MgF2 / SiO2 pair is a much worse AR.
    const needed = candidate(media([['MgF2', 129], ['SiO2', 219]]), { pos: 1, materialId: 'TiO2' }, 'cg');
    const tio2 = needed.frontLayers.find(l => l.material === 'TiO2');
    ok('setup: the TiO2 needle ends on the floor', needed.frontLayers.length === 3 && tio2 && tio2.thickness === 15, describe(needed));
    ok('setup: that layer is on the floor with the merit pushing it down', parkedIn(needed) === 1);
    ok('setup: the old thickness rule would keep it', O.cleanupLayers(needed.frontLayers, 15).length === 3);
    const without = withoutParked(needed, 'cg');
    ok('dropParked: without the layer the merit needs, the stack is worse, so the runner keeps it',
        without.removed === 1 && without.mf > needed.mfAfter, `${without.mf} vs ${needed.mfAfter}`);
}
{
    // Runner: one dropParked job per accepted generation, on the accepted
    // candidate's design, none for a batch that does not beat the best.
    const rav = [O.makeOperand({ type: 'RAV', lambdaStart: 500, lambdaEnd: 600, aoi: 0, pol: 'avg', target: 0, weight: 1 })];
    const seed = media([['TiO2', 60], ['SiO2', 90]]);
    const { runNeedleWorkerPool } = await import('../src/components/windows/optimization/needleVariation/runners/workerPool.js');
    async function runNeedleMock(answer) {
        const jobs = [];
        let scans = 0;
        const pool = {
            map: (batch, onProgress) => Promise.all(batch.map(job => new Promise(resolve => setTimeout(() => {
                jobs.push(job);
                const front = job.design.frontLayers;
                const grow = mat => [...front, { id: `${mat}${front.length}`, material: mat, thickness: 20, locked: false }];
                if (job.type === 'scan') {
                    scans++;
                    resolve({ type: 'result', mf0: 0.3, candidates: scans === 1 ? [{ dMF: -0.01, pos: 0, materialId: 'TiO2', side: 'front' }] : [] });
                    return;
                }
                if (job.type === 'seedDls') { resolve({ type: 'result', mf: 0.9, omf: 0.9, frontLayers: front, backLayers: [] }); return; }
                resolve({ type: 'result', ...answer(job, front, grow) });
            }, 0)))),
            terminate() {},
        };
        const ref = v => ({ current: v });
        const noop = () => {};
        const ctx = {
            runningRef: ref(false), timerRef: ref(null), workerRef: ref(null), dlsRef: ref(null),
            baseDesignRef: ref(null), savedDesignRef: ref(null), designRef: ref({ ...seed, id: 'needle-parked' }),
            operandsRef: ref(rav), gensRef: ref([]), genCountRef: ref(0), lastBestRef: ref(null),
            runsRef: ref([]), runOpenRef: ref(false), updateDesignRef: ref(noop), checkpointRef: ref(noop),
            maxLayersRef: ref(10), deltaNmRef: ref(0.5), dMinRef: ref(15), dlsIterRef: ref(10), targetMFRef: ref(1e-9),
            selectedCatsRef: ref([]), excludedMatsRef: ref(new Set()),
            setPhase: noop, setStatusMsg: noop, setMf: noop, setMfBest: noop, setOmf: noop, setOmfBest: noop,
            setLayerCount: noop, setCanReset: noop, setGeneration: noop, setGenerations: noop, setTopDesigns: noop,
            reconcileBaseWithEdits: noop, setCachedOptState: noop, stopOpt: () => { ctx.runningRef.current = false; },
            getPoolMaterials: () => POOL, makeWorkerPool: () => pool,
            t: { needle: { noOperands: 'no operands', smartSeeding: n => `seeding ${n}`, rescueTrying: n => `rescue ${n}`, rescueApplied: f => `rescue x${f}` } },
        };
        quiet();
        runNeedleWorkerPool(ctx);
        const t0 = Date.now();
        while (ctx.runningRef.current && Date.now() - t0 < 30000) await new Promise(r => setTimeout(r, 1));
        loud();
        return { first: ctx.gensRef.current[0], parkedJobs: jobs.filter(j => j.type === 'dropParked') };
    }
    const accepted = (mfAfter) => (job, front, grow) => (job.type === 'candidate'
        ? { mfAfter, omf: mfAfter, frontLayers: grow('TiO2'), backLayers: [], layerCount: front.length + 1 } : {});
    const better = await runNeedleMock((job, front, grow) => (job.type === 'dropParked'
        ? { removed: 1, mf: 0.15, omf: 0.15, frontLayers: front.slice(1), backLayers: [], nLayers: front.length - 1, side: 'front' }
        : accepted(0.2)(job, front, grow)));
    ok('Needle runner: one dropParked job for the accepted generation, with half the iterations',
        better.parkedJobs.length === 1 && better.parkedJobs[0].dlsIter === 5, `${better.parkedJobs.length} jobs`);
    ok('Needle runner: the dropParked job gets the accepted candidate\'s design',
        better.parkedJobs[0]?.design.frontLayers.length === seed.frontLayers.length + 1);
    ok('Needle runner: a better stack without the parked layers is what the generation records',
        better.first?.mf === 0.15 && better.first?.layerCount === seed.frontLayers.length, JSON.stringify(better.first?.mf));
    const worse = await runNeedleMock((job, front, grow) => (job.type === 'dropParked'
        ? { removed: 1, mf: 0.25, omf: 0.25, frontLayers: front.slice(1), backLayers: [], nLayers: front.length - 1, side: 'front' }
        : accepted(0.2)(job, front, grow)));
    ok('Needle runner: a worse one is left and the candidate is recorded',
        worse.first?.mf === 0.2 && worse.first?.layerCount === seed.frontLayers.length + 1, JSON.stringify(worse.first?.mf));
    const rejected = await runNeedleMock(accepted(0.35));
    ok('Needle runner: no dropParked job when no candidate beats the best', rejected.parkedJobs.length === 0 && rejected.first?.mf !== 0.35,
        `${rejected.parkedJobs.length} jobs`);
}

console.log(`=== Synthesis at the thickness floor · WASM ${tmmWasmActive() ? 'ON' : 'off'} ===`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
