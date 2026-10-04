/**
 * Synthesis runs leave the peak-to-peak (PPEF) rows out; Refinement keeps them.
 *
 * A PPEF row's gradient sits on the two worst wavelengths of its curve block,
 * and a needle search on such a merit stalls. Every synthesis window runs on
 * the design's enabled rows less the PPEF rows and the math rows that read
 * them; the curve block and the TDBMN row stay, and each window keeps or drops
 * MNT by its own rule. The merit is the one the Gain flattening wizard writes
 * (DMFS, a level-free dB block, PPEF, TDBMN, MNT) with a Specification-style
 * OPLT ceiling on the PPEF row.
 *
 *   1. The rule itself: PPEF and the ceiling go, everything else stays, and a
 *      list without a PPEF row comes back as it was.
 *   2. Needle Automatic, worker and main-thread runs (MNT dropped).
 *   3. Needle Manual: the rows its scan, predicted merit and refine share
 *      (MNT kept; the scan drops it itself).
 *   4. Gradual Evolution, worker and main-thread runs (MNT kept).
 *   5. Structural: its refine rows (MNT dropped) and the rows it scores
 *      results on (MNT kept).
 *   6. Deep Synthesis (MNT dropped).
 *   7. A block with a fixed level, expanded into point rows for the run,
 *      keeps every point.
 *   8. Refinement's main-thread, DLS pool and method runs keep the PPEF row.
 *   9. Each synthesis window says so among its settings while the merit
 *      function has an enabled PPEF row, and says nothing without one.
 *
 * Run: node tests/synthesis_ppef_rows.mjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, useImmediateTimers, loadApp, makeLocale, makeTheme } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
useImmediateTimers();
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 2 }, configurable: true, writable: true });
await initWasmForTest();
await loadApp();

// Every message a worker is sent. A Refinement 'start' job is answered with a
// finished run on the stack it was sent; the synthesis jobs are left waiting,
// and the test stops their run.
const posted = [];
class MockWorker {
    constructor() { this.onmessage = null; this.onerror = null; this.dead = false; }
    postMessage(job) {
        if (this.dead || !job) return;
        posted.push(job);
        if (job.type !== 'start') return;
        const front = job.design.frontLayers || [];
        const back = job.design.backLayers || [];
        setTimeout(() => {
            if (this.dead || !this.onmessage) return;
            this.onmessage({ data: {
                type: 'done', iter: 1, mf: 0.1, mfBest: 0.1, omf: 0.1, omfBest: 0.1,
                frontLayers: front, backLayers: back, bestFrontLayers: front, bestBackLayers: back, reason: 'stalled',
            } });
        }, 0);
    }
    terminate() { this.dead = true; }
}
globalThis.Worker = MockWorker;

const O = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { default: EN } = await import('../src/constants/locales/en.js');
const { curveWizardRows } = await import('../src/components/windows/optimization/meritFunctionEditor/curveWizardModel.js');
const { buildWizardResult } = await import('../src/components/windows/optimization/meritFunctionEditor/meritOperandModel.js');
const { poolCatalogs, poolMatEntries } = await import('../src/components/windows/optimization/synthesisShared/catalogPool.js');
const SYN = await import('../src/components/windows/optimization/synthesisShared/synthesisMath.js');
const { wpPrepare } = await import('../src/components/windows/optimization/needleVariation/runners/workerPoolSetup.js');
const { runNeedleMainThread } = await import('../src/components/windows/optimization/needleVariation/runners/mainThread.js');
const NEEDLE_MANUAL = await import('../src/components/windows/optimization/needleManual/model.js');
const { runGeWorker } = await import('../src/components/windows/optimization/gradualEvolution/runners/workerPool.js');
const { runGeMainThread } = await import('../src/components/windows/optimization/gradualEvolution/runners/mainThread.js');
const { createRunState: structuralRunState } = await import('../src/components/windows/optimization/structuralOptimizer/runners/runState.js');
const { createRunState: deepRunState } = await import('../src/components/windows/optimization/deepSynthesis/runners/runState.js');
const { createRunContext } = await import('../src/components/windows/optimization/deepSynthesis/runners/lifecycle.js');
const { freshHistory } = await import('../src/components/windows/optimization/deepSynthesis/historyActions.js');
const { runOptMainThread } = await import('../src/components/windows/optimization/refinement/runners/mainThread.js');
const { runDlsEvent } = await import('../src/components/windows/optimization/refinement/runners/dlsPool.js');
const { runMethodsFlow } = await import('../src/components/windows/optimization/refinement/runners/methodsFlow.js');
const { LeftSidebar: NeedleSidebar } = await import('../src/components/windows/optimization/needleVariation/needlePanels.js');
const { LeftSidebar: GeSidebar } = await import('../src/components/windows/optimization/gradualEvolution/gePanels.js');
const { LeftSidebar: StructuralSidebar } = await import('../src/components/windows/optimization/structuralOptimizer/structuralPanels.js');
const { LeftSidebar: DeepSidebar } = await import('../src/components/windows/optimization/deepSynthesis/deepSynthesisPanels.js');
const { LeftSidebar: NeedleManualSidebar } = await import('../src/components/windows/optimization/needleManual/LeftSidebar.js');

let pass = 0, fail = 0;
const quiet = console.log;
async function check(name, body) {
    console.log = () => {};
    try {
        await body();
        pass++;
    } catch (err) {
        fail++;
        console.error(`FAIL: ${name}: ${err.message}`);
    } finally {
        console.log = quiet;
    }
}
const expect = (cond, message) => { if (!cond) throw new Error(message); };
const h = (type, props) => React.createElement(type, props);
const ref = current => ({ current });
const noop = () => {};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(cond, ms = 10000) {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > ms) throw new Error('timed out');
        await sleep(2);
    }
}

// ── The merit the Gain flattening wizard writes ──────────────────────────────
const lambdas = Array.from({ length: 21 }, (_, i) => 500 + 5 * i);
const baseDesign = {
    id: 'ppef-design', referenceWavelength: 550,
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [], measuredCurves: [], meritOperands: [],
    frontLayers: [80, 120, 70, 110, 75].map((thickness, i) => ({
        id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness, locked: false,
    })),
};
const gain = { name: 'edfa', x: lambdas, y: lambdas.map(lambda => 20 + 1.5 * Math.sin((lambda - 500) / 30)) };
const wizard = curveWizardRows({
    typeId: 'GAIN_FLATTENING', design: baseDesign, flatteningName: name => `${name} target`,
    params: { input: 'gain', gain, curveAoi: 0, curvePol: 'avg', insertionLossDb: 0.4, ppefDb: 0.1 },
});
const written = buildWizardResult({
    tw: { types: { GAIN_FLATTENING: { label: 'Gain flattening' } } },
    typeId: 'GAIN_FLATTENING', curveRows: wizard, minEnabled: true, maxEnabled: false, minThick: 10, maxThick: 500,
}).block;
const byType = type => written.find(op => op.type === type);
const BLOCK = byType('MCURVE'), PPEF = byType('PPEF'), LOSS = byType('TDBMN'), MNT = byType('MNT');
const CEILING = O.makeOperand({ type: 'OPLT', refId: PPEF.id, target: 0.3, weight: 1 });
const OPERANDS = [...written, CEILING];
const DESIGN = { ...baseDesign, measuredCurves: wizard.curves, meritOperands: OPERANDS };
const copy = value => JSON.parse(JSON.stringify(value));

// The same merit with the block's level fixed, so a run expands it into points.
const FIXED_BLOCK = { ...BLOCK, levelFree: false };
const FIXED_OPERANDS = OPERANDS.map(op => (op.id === BLOCK.id ? FIXED_BLOCK : op));

const POOL = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
const builtin = poolCatalogs(null).find(cat => cat.id === 'builtin');
const EXCLUDED = new Set(poolMatEntries(builtin).map(e => e.fullId).filter(id => id !== 'TiO2' && id !== 'SiO2'));

const ids = rows => new Set(rows.map(op => op.id));
const opsOf = engine => engine?.operands ?? engine?._ev?.operands;

// A synthesis run's rows: no PPEF row and no row reading it; the block, the
// TDBMN row, and MNT exactly when the window keeps it.
function synthesisRows(rows, { mnt }) {
    expect(Array.isArray(rows) && rows.length, 'the run has rows');
    const has = ids(rows);
    expect(!rows.some(op => op.type === 'PPEF'), `a PPEF row is in the run: ${rows.map(op => op.type).join(' ')}`);
    expect(!has.has(CEILING.id), 'the ceiling row on the PPEF row is in the run');
    expect(has.has(BLOCK.id), 'the curve block is missing');
    expect(has.has(LOSS.id), 'the TDBMN row is missing');
    expect(has.has(MNT.id) === mnt, mnt ? 'the MNT row is missing' : 'the MNT row is in the run');
}

// ── 1. The rule ──────────────────────────────────────────────────────────────
await check('withoutPPEF drops the PPEF row and the row reading it, nothing else', () => {
    const kept = SYN.withoutPPEF(OPERANDS);
    expect(kept.map(op => op.id).join() === written.filter(op => op.id !== PPEF.id).map(op => op.id).join(),
        `kept ${kept.map(op => op.type).join(' ')}`);
    const plain = [BLOCK, LOSS, MNT];
    expect(SYN.withoutPPEF(plain) === plain, 'a list without PPEF comes back as it was');
});

// The Specification writes the block at weight 0 and puts the requirement on
// the PPEF row (equal) or on a ceiling over it (≤); the block takes that weight,
// so the run still has the curve to fit.
await check('withoutPPEF gives a block at weight 0 the weight its requirement had', () => {
    const block = { ...BLOCK, weight: 0 };
    const weightOf = rows => rows.find(op => op.id === BLOCK.id).weight;
    const ceilingOnly = SYN.withoutPPEF([block, { ...PPEF, weight: 0 }, CEILING]);
    expect(weightOf(ceilingOnly) === 1, `≤: block weight ${weightOf(ceilingOnly)}`);
    const equal = SYN.withoutPPEF([block, { ...PPEF, weight: 1 }]);
    expect(weightOf(equal) === 1, `=: block weight ${weightOf(equal)}`);
    const wizardRows = SYN.withoutPPEF(written);
    expect(weightOf(wizardRows) === BLOCK.weight, 'a block already at the PPEF row\'s weight keeps its own');
    expect(block.weight === 0, 'the merit itself is not changed');
});

// ── 2. Needle Automatic ──────────────────────────────────────────────────────
function needleCtx(operands) {
    return {
        runningRef: ref(false), timerRef: ref(null), dlsRef: ref(null),
        baseDesignRef: ref(null), savedDesignRef: ref(null), designRef: ref(copy(DESIGN)),
        runsRef: ref([]), runOpenRef: ref(false), operandsRef: ref(copy(operands)),
        gensRef: ref([]), genCountRef: ref(0), lastBestRef: ref(null),
        maxLayersRef: ref(12), deltaNmRef: ref(0.5), dMinRef: ref(1), dlsIterRef: ref(5), targetMFRef: ref(1e-9),
        selectedCatsRef: ref([]), excludedMatsRef: ref(new Set()),
        updateDesignRef: ref(noop), checkpointRef: ref(noop),
        setPhase: noop, setStatusMsg: noop, setMf: noop, setMfBest: noop, setOmf: noop, setOmfBest: noop,
        setLayerCount: noop, setCanReset: noop, setGeneration: noop, setGenerations: noop, setTopDesigns: noop,
        setCachedOptState: noop, reconcileBaseWithEdits: noop,
        getPoolMaterials: () => POOL, t: EN,
    };
}

await check('Needle Automatic worker run', () => {
    const run = wpPrepare(needleCtx(OPERANDS));
    expect(run, 'the run did not start');
    synthesisRows(run.operands, { mnt: false });
});

await check('Needle Automatic main-thread run', async () => {
    const ctx = needleCtx(OPERANDS);
    // The refiner the run builds for its first candidate holds the run's rows.
    let engine = null;
    let held = null;
    ctx.dlsRef = {
        get current() { return held; },
        set current(value) {
            held = value;
            if (value && !engine) { engine = value; ctx.runningRef.current = false; }
        },
    };
    runNeedleMainThread(ctx);
    await until(() => engine || !ctx.runningRef.current);
    expect(engine, 'the run built no refiner');
    synthesisRows(opsOf(engine), { mnt: false });
});

// ── 3. Needle Manual ─────────────────────────────────────────────────────────
await check('Needle Manual rows', () => {
    expect(typeof NEEDLE_MANUAL.runOperands === 'function', 'the window has no shared row list');
    synthesisRows(NEEDLE_MANUAL.runOperands(copy(DESIGN), designMaterialLookup(DESIGN)), { mnt: true });
});

// ── 4. Gradual Evolution ─────────────────────────────────────────────────────
function geCtx() {
    const ctx = {
        runningRef: ref(false), timerRef: ref(null), workerRef: ref(null), dlsRef: ref(null),
        baseDesignRef: ref(null), savedDesignRef: ref(null), designRef: ref(copy(DESIGN)),
        operandsRef: ref(copy(OPERANDS)), cyclesRef: ref([]), genCountRef: ref(0), geStepsRef: ref(0),
        runsRef: ref([]), runOpenRef: ref(false), updateDesignRef: ref(noop), checkpointRef: ref(noop),
        maxLayersRef: ref(30), maxGeCyclesRef: ref(4), targetMFRef: ref(1e-9), dlsIterRef: ref(5), dMinRef: ref(1),
        selectedCatsRef: ref([]), excludedMatsRef: ref([]),
        setPhase: noop, setStatusMsg: noop, setCanReset: noop, setMf: noop, setOmf: noop, setMfBest: noop, setOmfBest: noop,
        setCycles: noop, setGeneration: noop, setLayerCount: noop, setGeSteps: noop, reconcileBaseWithEdits: noop,
        getPoolMaterials: () => POOL, setCachedOptState: noop, t: EN,
    };
    ctx.stopOpt = () => { ctx.runningRef.current = false; ctx.workerRef.current?.terminate(); };
    return ctx;
}

await check('Gradual Evolution worker run', async () => {
    posted.length = 0;
    const ctx = geCtx();
    runGeWorker(ctx);
    try {
        await until(() => posted.some(job => job.operands));
    } finally {
        ctx.stopOpt();
    }
    synthesisRows(posted.find(job => job.operands).operands, { mnt: true });
});

await check('Gradual Evolution main-thread run', () => {
    const ctx = geCtx();
    runGeMainThread(ctx);
    ctx.runningRef.current = false;
    clearTimeout(ctx.timerRef.current);
    synthesisRows(opsOf(ctx.dlsRef.current), { mnt: true });
});

// ── 5. Structural ────────────────────────────────────────────────────────────
await check('Structural run', () => {
    const ctx = {
        cfgRef: ref({
            maxIter: 3, targetMF: 0, T0: 0.08, jitterPct: 0.15, refineIter: 5, dMin: 1, addMaxNm: 120,
            maxLayers: 20, kinds: new Set(['perturb']), deepMode: 0, deepMaxMin: 0, seed: 1, threads: 1,
        }),
        runningRef: ref(false), workersRef: ref([]), runIdRef: ref(0), designRef: ref(copy(DESIGN)),
        operandsRef: ref(copy(OPERANDS)), savedDesignRef: ref(null), baseDesignRef: ref(null),
        runsRef: ref([]), runOpenRef: ref(false), gensRef: ref([]), genCountRef: ref(0), trendRef: ref([]),
        checkpointRef: ref(noop), selectedCatsRef: ref(new Set(['builtin'])), excludedMatsRef: ref(EXCLUDED),
        reconcileBaseWithEdits: noop, killWorkers: noop, makeWorker: () => new MockWorker(),
        setStatusMsg: noop, setCanReset: noop, setSeed: noop, ts: EN.structural,
    };
    const state = structuralRunState(ctx);
    expect(state, 'the run did not start');
    synthesisRows(state.operands, { mnt: false });
    synthesisRows(state.fullOps, { mnt: true });
});

// ── 6. Deep Synthesis ────────────────────────────────────────────────────────
await check('Deep Synthesis run', () => {
    const statuses = [];
    const ctx = createRunContext(patch => { if (patch.statusMsg) statuses.push(patch.statusMsg); });
    ctx.hist = freshHistory();
    ctx.td = { ...EN.deepSynthesis };
    ctx.cfgRef.current = { dMin: 1, maxLayers: 12, seed: 7, threads: 1 };
    ctx.designRef.current = copy(DESIGN);
    ctx.operandsRef.current = copy(OPERANDS);
    ctx.selectedCatsRef.current = new Set(['builtin']);
    ctx.excludedMatsRef.current = EXCLUDED;
    ctx.getDesignRevision = () => 0;
    const state = deepRunState(ctx);
    expect(state, `the run did not start: ${statuses.join('; ')}`);
    synthesisRows(state.ev.operands, { mnt: false });
});

// ── 7. A block expanded into point rows ──────────────────────────────────────
await check('a fixed-level block keeps every point row', () => {
    const run = wpPrepare(needleCtx(FIXED_OPERANDS));
    expect(run, 'the run did not start');
    const points = run.operands.filter(op => op.measuredCurveBlockId === BLOCK.id);
    expect(points.length === lambdas.length, `${points.length} of ${lambdas.length} point rows`);
    expect(!run.operands.some(op => op.type === 'PPEF' || op.id === CEILING.id), 'the PPEF row went into the run');
    expect(run.operands.some(op => op.id === LOSS.id), 'the TDBMN row is missing');
});

// ── 8. Refinement keeps the PPEF row ─────────────────────────────────────────
function refinementCtx() {
    const ctx = {
        runningRef: ref(false), designRef: ref(copy(DESIGN)), operandsRef: ref(copy(OPERANDS)),
        maxIterRef: ref(5), multiStartRef: ref(false), nRestartsRef: ref(1), perturbPctRef: ref(30),
        checkpointRef: ref(noop), optimizerRef: ref(null), timerRef: ref(null), baselineRef: ref(false),
        lastBestRef: ref(null), poolRef: ref([]), dePoolRef: ref(null), flowWorkersRef: ref(new Set()),
        runIdRef: ref(0), histRunCount: ref(0), seedRef: ref(1),
        commitBaseline: noop, bumpRunCount: noop, addHistEntry: noop, setSeed: noop,
        killWorker: () => {
            for (const w of ctx.poolRef.current) w.terminate?.();
            ctx.poolRef.current = [];
            for (const handle of ctx.flowWorkersRef.current) handle.settle?.();
            ctx.flowWorkersRef.current.clear();
        },
        updateDesignRef: ref(patch => { ctx.designRef.current = { ...ctx.designRef.current, ...patch }; }),
        setMf: noop, setMfBest: noop, setMfInitial: noop, setOmf: noop, setOmfBest: noop, setOmfInitial: noop,
        setIter: noop, setMfHistory: noop, setRunning: noop, setCanReset: noop, setRestartIdx: noop, setStopReason: noop,
        t: { refinement: { ...EN.refinement, history: { run: n => `Run ${n}` } } },
    };
    ctx.stopOpt = () => { ctx.runningRef.current = false; ctx.runIdRef.current += 1; ctx.killWorker(); };
    return ctx;
}
function refinementRows(rows) {
    expect(Array.isArray(rows) && rows.length, 'the run has rows');
    const has = ids(rows);
    expect(has.has(PPEF.id), 'the PPEF row is not in the run');
    expect(has.has(CEILING.id), 'the ceiling row is not in the run');
    expect(has.has(BLOCK.id) && has.has(LOSS.id) && has.has(MNT.id), 'a row is missing');
}

await check('Refinement main-thread run keeps PPEF', () => {
    const ctx = refinementCtx();
    runOptMainThread(ctx);
    ctx.runningRef.current = false;
    clearTimeout(ctx.timerRef.current);
    refinementRows(opsOf(ctx.optimizerRef.current));
});

for (const [name, start] of [
    ['DLS pool', ctx => runDlsEvent(ctx)],
    ['method', ctx => runMethodsFlow(ctx, ['cg'])],
]) {
    await check(`Refinement ${name} run keeps PPEF`, async () => {
        posted.length = 0;
        const ctx = refinementCtx();
        await start(ctx);
        await until(() => !ctx.runningRef.current);
        const job = posted.find(m => m.type === 'start');
        expect(job, 'no job was sent');
        refinementRows(job.operands);
    });
}

// ── 9. The note among each window's settings ─────────────────────────────────
{
    const t = makeLocale('en');
    const c = makeTheme();
    const pool = {
        catalogs: [], selectedCats: new Set(), excludedMats: new Set(),
        onToggleCat: noop, onSelectAllCats: noop, onClearCats: noop, onToggleMat: noop,
    };
    const sidebars = {
        'Needle Automatic': operands => h(NeedleSidebar, {
            ...pool, operands, maxLayers: 60, deltaNm: 0.5, dlsIter: 60, dMin: 1, targetMF: 5e-4, maxMNT: 0,
            onMaxLayers: noop, onDeltaNm: noop, onDlsIter: noop, onDMin: noop, onTargetMF: noop, running: false, c, t,
        }),
        'Needle Manual': operands => h(NeedleManualSidebar, {
            ...pool, operands, deltaNm: 0.5, dMin: 1, nIntra: 16, refineAfter: false, dlsIter: 60,
            onDeltaNm: noop, onDMin: noop, onNIntra: noop, onRefineAfter: noop, onDlsIter: noop,
            showSideRadio: false, requestedSide: 'front', onRequestedSide: noop, busy: false, c, t,
        }),
        'Gradual Evolution': operands => h(GeSidebar, {
            ...pool, operands, maxLayers: 60, maxGeCycles: 30, targetMF: 5e-4, dlsIter: 60, dMin: 1, maxMNT: 0,
            deepSearch: 0, onMaxLayers: noop, onMaxGeCycles: noop, onTargetMF: noop, onDlsIter: noop, onDMin: noop,
            onDeepSearch: noop, running: false, c, t,
        }),
        Structural: operands => h(StructuralSidebar, {
            ...pool, operands, kinds: new Set(['add']), onToggleKind: noop,
            maxIter: 80, targetMF: 5e-4, T0: 0.08, jitterPct: 0.15, refineIter: 60, dMin: 1, maxMNT: 0,
            addMaxNm: 500, maxLayers: 80, deepMode: 0, onDeepMode: noop, deepMaxMin: 0, onDeepMaxMin: noop,
            seed: null, onSeed: noop, onMaxIter: noop, onTargetMF: noop, onT0: noop, onJitter: noop,
            onRefineIter: noop, onDMin: noop, onAddMax: noop, onMaxLayers: noop, running: false, c, t,
        }),
        'Deep Synthesis': operands => h(DeepSidebar, {
            catalogs: [], operands, running: false, c, t,
            s: {
                dMin: 1, setDMin: noop, maxMNT: 0, maxLayers: 30, setMaxLayers: noop,
                pool: {
                    selectedCats: new Set(), excludedMats: new Set(), handleToggleCat: noop,
                    handleSelectAllCats: noop, handleClearCats: noop, handleToggleMat: noop,
                },
            },
        }),
    };
    const unescape = text => text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const note = html => {
        const text = html.match(/data-synthesis-ppef-note="true"[^>]*>([^<]*)</)?.[1];
        return text == null ? null : unescape(text);
    };
    const off = OPERANDS.map(op => (op.id === PPEF.id ? { ...op, enabled: false } : op));
    for (const [name, sidebar] of Object.entries(sidebars)) {
        await check(`${name} settings note`, () => {
            expect(note(renderToStaticMarkup(sidebar(OPERANDS))) === t.synthesisShell?.ppefNote,
                'no note with an enabled PPEF row');
            expect(note(renderToStaticMarkup(sidebar(off))) === null, 'a note with the PPEF row switched off');
            expect(note(renderToStaticMarkup(sidebar([BLOCK, LOSS]))) === null, 'a note without a PPEF row');
        });
    }
}

console.log('=== Synthesis runs and the PPEF row ===');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
