/**
 * Synthesis window state around a finished run.
 *
 *   1. Gradual Evolution: a Run press after a run that ended on max GE steps,
 *      or after Reset, has its own GE-step budget. Before, the count stayed at
 *      the cap and the next Run stopped at once with "Max GE steps reached".
 *   2. Needle and GE, on a remount: the window restores the edit revision its
 *      cached base design belongs to, not the design's current one, so an edit
 *      made while the window was closed sends the next Run to the edited design.
 *      Before, Needle continued from the cached 61-layer stack after every layer
 *      had been deleted in the Design Editor and stopped at once with "Max layers
 *      reached". The cache writes carry that revision.
 *
 * Run: node tests/synthesis_run_state.mjs
 */
import { shimBrowserGlobals, useImmediateTimers } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
useImmediateTimers();
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 1 }, configurable: true, writable: true });
await initWasmForTest();

const O = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { performReset: geReset, restoreOrClearForDesign } = await import('../src/components/windows/optimization/gradualEvolution/geStateHelpers.js');
const geSession = await import('../src/components/windows/optimization/gradualEvolution/sessionState.js');
const { syncOnDesignSwitch } = await import('../src/components/windows/optimization/needleVariation/needleLifecycle.js');
const { performReset: needleReset } = await import('../src/components/windows/optimization/needleVariation/needleActions.js');
const needleSession = await import('../src/components/windows/optimization/needleVariation/sessionState.js');
const { default: EN } = await import('../src/constants/locales/en.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const _log = console.log;
const quiet = () => { console.log = () => {}; };
const loud = () => { console.log = _log; };

const ref = current => ({ current });
const noop = () => {};
const layers = specs => specs.map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false }));
const media = (front, id) => ({
    id, incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', frontLayers: front, backLayers: [],
});
const POOL = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
const ops = [O.makeOperand({ type: 'RAV', lambdaStart: 480, lambdaEnd: 620, aoi: 0, pol: 'avg', target: 0, weight: 1 })];

// The rule every synthesis window applies before a Run (M12): a design
// revision that differs from the window's baseline drops the cached base and
// closes the open block, so the Run starts from the design on screen.
const reconcile = (ctx, rev) => {
    if (rev === ctx.baseRevRef.current) return;
    ctx.baseDesignRef.current = null;
    ctx.runOpenRef.current = false;
    ctx.baseRevRef.current = rev;
};

// ── 1. GE-step budget ────────────────────────────────────────────────────────

// Drive runGeWorker against a mock synthesis worker in which no needle ever
// improves, so every cycle is a forced GE step.
async function runGeAfterFinishedRun({ geSteps, maxGeCycles, designId }) {
    class MockWorker {
        constructor() { this.onmessage = null; this.dead = false; }
        postMessage(job) {
            if (this.dead || !job || job.type === 'wasmInit') return;
            const front = job.design.frontLayers;
            const answers = {
                seedDls: { mf: 0.30, omf: 0.30, frontLayers: front, backLayers: [], iters: 0 },
                scan: { mf0: 0.3, candidates: [] },
                geStep: { mf: 0.32, omf: 0.32, mfNew: 0.32, mf0: 0.3, frontLayers: [...front, { id: `g${front.length}`, material: 'SiO2', thickness: 20, locked: false }],
                    backLayers: [], materialId: 'SiO2', pos: front.length, side: 'front', nLayers: front.length + 1 },
                dropParked: { removed: 0 },
                removePass: { removed: 0, mf: 0.3, frontLayers: front, backLayers: [] },
            };
            const data = { type: 'result', ...(answers[job.type] || {}) };
            setTimeout(() => { if (!this.dead) this.onmessage?.({ data }); }, 0);
        }
        terminate() { this.dead = true; }
    }
    globalThis.Worker = MockWorker;
    const { runGeWorker } = await import('../src/components/windows/optimization/gradualEvolution/runners/workerPool.js');
    const shown = [];
    const ctx = {
        runningRef: ref(false), timerRef: ref(null), workerRef: ref(null), dlsRef: ref(null),
        baseDesignRef: ref(null), savedDesignRef: ref(null), baseRevRef: ref(3),
        designRef: ref(media(layers([['TiO2', 60], ['SiO2', 90]]), designId)),
        operandsRef: ref(ops), cyclesRef: ref([]), genCountRef: ref(0), geStepsRef: ref(geSteps),
        runsRef: ref([]), runOpenRef: ref(false), updateDesignRef: ref(noop), checkpointRef: ref(noop),
        maxLayersRef: ref(30), maxGeCyclesRef: ref(maxGeCycles), targetMFRef: ref(1e-9), dlsIterRef: ref(10), dMinRef: ref(15),
        selectedCatsRef: ref([]), excludedMatsRef: ref([]),
        setPhase: noop, setStatusMsg: noop, setCanReset: noop, setMf: noop, setOmf: noop, setMfBest: noop, setOmfBest: noop,
        setCycles: noop, setGeneration: noop, setLayerCount: noop, setGeSteps: v => shown.push(v), reconcileBaseWithEdits: noop,
        stopOpt: () => { ctx.runningRef.current = false; },
        getPoolMaterials: () => POOL,
        t: EN,
    };
    quiet();
    runGeWorker(ctx);
    const t0 = Date.now();
    while (ctx.runningRef.current && Date.now() - t0 < 30000) await new Promise(r => setTimeout(r, 1));
    loud();
    return { steps: ctx.cyclesRef.current.filter(c => c.type === 'ge').length, shown, ctx };
}

{
    const r = await runGeAfterFinishedRun({ geSteps: 16, maxGeCycles: 16, designId: 'ge-budget' });
    // The mock merit never improves, so the run ends as stuck after a few steps.
    ok('GE: Run after a run that used all 16 GE steps takes GE steps of its own', r.steps > 0, `${r.steps} steps`);
    ok('GE: the new run shows its GE-step count from 0', r.shown[0] === 0, JSON.stringify(r.shown.slice(0, 3)));
    const cached = geSession.getCached('ge-budget');
    ok('GE: the runner\'s cache carries the edit revision of its base design', cached?.baseRev === r.ctx.baseRevRef.current,
        JSON.stringify(cached?.baseRev));
}
{
    // Reset after a finished run: the count goes back to 0 with the run it undoes.
    const shown = [];
    const ctx = {
        dlsRef: ref(null), savedDesignRef: ref(null), baseDesignRef: ref(null), baseRevRef: ref(5),
        updateDesign: noop, designRef: ref(media(layers([['SiO2', 100]]), 'ge-reset')),
        cyclesRef: ref([{ runNum: 1, genNum: 1, mf: 0.1, type: 'ge' }]), genCountRef: ref(1), geStepsRef: ref(16),
        runsRef: ref([{ runNum: 1, baseline: { frontLayers: layers([['SiO2', 100]]), backLayers: [] } }]), runOpenRef: ref(false),
        setCycles: noop, setMf: noop, setMfBest: noop, setOmf: noop, setOmfBest: noop, setGeneration: noop,
        setGeSteps: v => shown.push(v), setLayerCount: noop, setCanReset: noop, setStatusMsg: noop,
        t: { gradualEvolution: { runSeparator: n => `Run ${n}` } },
    };
    geReset(undefined, ctx);
    ok('GE: Reset sets the GE-step count back to 0', ctx.geStepsRef.current === 0 && shown.at(-1) === 0,
        `${ctx.geStepsRef.current}, shown ${JSON.stringify(shown)}`);
}

// ── 2. Remount after an edit made while the window was closed ────────────────

const cachedStack = layers(Array.from({ length: 61 }, (_, i) => [i % 2 ? 'SiO2' : 'TiO2', 50]));
const run1 = { runNum: 1, baseline: { frontLayers: layers([['TiO2', 7000]]), backLayers: [] } };

function needleCtx(designRevision) {
    return {
        ctx: {
            lastDesignId: ref(null), runningRef: ref(false), timerRef: ref(null), workerRef: ref(null),
            gensRef: ref([]), genCountRef: ref(0), lastBestRef: ref(null), savedDesignRef: ref(null),
            baseDesignRef: ref(null), baseRevRef: ref(0), runsRef: ref([]), runOpenRef: ref(false),
            setPhase: noop, setStatusMsg: noop, setGenerations: noop, setTopDesigns: noop, setMf: noop, setMfBest: noop,
            setOmf: noop, setOmfBest: noop, setGeneration: noop, setLayerCount: noop, setCanReset: noop,
        },
        rev: () => designRevision,
    };
}

for (const [label, revNow, kept] of [['edited while closed', 7, false], ['not edited', 4, true]]) {
    // A finished Needle run cached its 61-layer base at revision 4.
    needleSession.setCachedOptState('needle-remount', {
        generations: [{ runNum: 1, genNum: 33, mf: 0.02, layerCount: 61 }], runs: [run1],
        savedDesign: run1.baseline, baseDesign: media(cachedStack, 'needle-remount'), baseRev: 4,
    });
    const { ctx, rev } = needleCtx(revNow);
    syncOnDesignSwitch(ctx, media([], 'needle-remount'), rev);
    reconcile(ctx, rev());
    ok(`Needle remount, ${label}: the next Run ${kept ? 'continues from the cached stack' : 'starts from the design on screen'}`,
        kept ? ctx.baseDesignRef.current?.frontLayers.length === 61 : ctx.baseDesignRef.current === null,
        `base ${ctx.baseDesignRef.current ? ctx.baseDesignRef.current.frontLayers.length + ' layers' : 'dropped'}`);
}
{
    // A cache written before the revision was kept matches nothing.
    needleSession.setCachedOptState('needle-old', { generations: [], runs: [run1], savedDesign: run1.baseline,
        baseDesign: media(cachedStack, 'needle-old') });
    const { ctx, rev } = needleCtx(0);
    syncOnDesignSwitch(ctx, media([], 'needle-old'), rev);
    reconcile(ctx, rev());
    ok('Needle remount: a cache with no revision does not bring back its base', ctx.baseDesignRef.current === null);
}
{
    // Needle's Reset caches with the revision.
    const { ctx } = needleCtx(0);
    Object.assign(ctx, {
        stopOpt: noop, dlsRef: ref(null), designRef: ref(media(cachedStack, 'needle-cache')), baseRevRef: ref(9),
        runsRef: ref([run1]), gensRef: ref([{ runNum: 1, genNum: 1, mf: 0.1, side: 'front' }]),
        t: EN,
    });
    needleReset(ctx, noop, 'front');
    ok('Needle: the cache written on a side reset carries the edit revision',
        needleSession.getCachedOptState('needle-cache')?.baseRev === 9);
}

for (const [label, revNow, kept] of [['edited while closed', 7, false], ['not edited', 4, true]]) {
    geSession.setCached('ge-remount', {
        cycles: [{ runNum: 1, genNum: 12, mf: 0.03, layerCount: 10 }], geSteps: 16, runs: [run1],
        savedDesign: run1.baseline, baseDesign: media(cachedStack, 'ge-remount'), baseRev: 4,
    });
    const ctx = {
        lastDesignId: ref(null), runningRef: ref(false), timerRef: ref(null), workerRef: ref(null),
        cyclesRef: ref([]), genCountRef: ref(0), geStepsRef: ref(0), savedDesignRef: ref(null), baseDesignRef: ref(null),
        baseRevRef: ref(0), runsRef: ref([]), runOpenRef: ref(false), getDesignRevision: () => revNow,
        setPhase: noop, setStatusMsg: noop, setCycles: noop, setMf: noop, setMfBest: noop, setOmf: noop, setOmfBest: noop,
        setGeneration: noop, setGeSteps: noop, setLayerCount: noop, setCanReset: noop,
    };
    restoreOrClearForDesign(media([], 'ge-remount'), ctx);
    reconcile(ctx, revNow);
    ok(`GE remount, ${label}: the next Run ${kept ? 'continues from the cached stack' : 'starts from the design on screen'}`,
        kept ? ctx.baseDesignRef.current?.frontLayers.length === 61 : ctx.baseDesignRef.current === null);
}

console.log('=== Synthesis window state around a finished run ===');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
