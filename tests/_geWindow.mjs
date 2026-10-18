/**
 * A fake Gradual Evolution window for tests: the ctx useGradualEvolution.js
 * hands a run, its Stop, a recorder for what the window shows, and the global
 * `Worker` the run's WorkerPool is built from.
 *
 * The worker runs each job in a microtask of its own, in the order the pool
 * posts them, with the real synthesis-worker handlers (dispatchSynthesisJob),
 * or with scripted answers when the window's spec says `worker: 'scripted'`.
 *
 * Import it after shimBrowserGlobals() (_uiShim.mjs): the window modules it
 * loads expect the browser globals.
 */
import { dispatchSynthesisJob } from '../src/utils/workers/synthesisWorker.js';
import { makeResolveMat } from '../src/utils/workers/resolveMat.js';
import EN from '../src/constants/locales/en.js';

// Window settings that live in local storage.
export const STORAGE = {
    threads: 'tfstudio-worker-threads',
    engine: 'tfstudio-synth-inner-engine-ge',
    smartSeed: 'tfstudio-synth-smart-seed-ge',
    seedMode: 'tfstudio-synth-seed-mode',
    candMode: 'tfstudio-synth-cand-batches',
    sensitivity: 'tfstudio-needle-sensitivity',
    consolidate: 'tfstudio-synth-consolidate',
};

export const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });

// A seed's in-flight design, as a worker's live preview sends it.
export const PREVIEW = [layer('P1', 'TiO2', 60), layer('P2', 'SiO2', 90)];

// The window whose run the workers serve (useWindow).
let current = null;
export const useWindow = win => { current = win; };

// Scripted answers, keyed by job type, derived from the job's design so a run
// takes a fixed path: an improving needle on an odd layer count, a forced step
// below the layer limit, a swap and a consolidation that each free a layer.
const mk = (n, material) => ({ id: `${material}_${n}`, material, thickness: 10 + n, locked: false });
function jobStacks(job) {
    const front = (job.design && job.design.frontLayers) || [];
    const back  = (job.design && job.design.backLayers)  || [];
    const onBack = job.side === 'back';
    return { front, back, arr: onBack ? back : front,
        withSide: layers => (onBack ? { nf: front, nb: layers } : { nf: layers, nb: back }) };
}
const SCRIPTED_ANSWERS = {
    seedDls: ({ front, back }) => ({ mf: 0.5, frontLayers: front, backLayers: back, omf: 0.5, iters: 0 }),
    scan: ({ arr }, job) => ({ candidates: arr.length % 2 === 1 ? [{ dMF: -0.1, pos: 0, materialId: 'TiO2', side: job.side }] : [] }),
    candidate: ({ arr, withSide }) => {
        const { nf, nb } = withSide([...arr, mk(arr.length, 'TiO2')]);
        const total = nf.length + nb.length;
        return { mfNow: 0.5 - 0.02 * total, frontLayers: nf, backLayers: nb, nLayers: total, omf: 0.5 - 0.02 * total, needleKept: true };
    },
    geStep: ({ arr, withSide }, job) => {
        if (job.maxLayers > 0 && arr.length >= job.maxLayers) return { empty: true };
        const { nf, nb } = withSide([...arr, mk(arr.length, 'SiO2')]);
        const total = nf.length + nb.length;
        const mf = 0.5 - 0.01 * total;
        return { empty: false, mf, omf: mf, mfNew: mf, mf0: 0.5, frontLayers: nf, backLayers: nb, materialId: 'SiO2', pos: arr.length, side: job.side, nLayers: total };
    },
    dropWeakest: ({ arr, withSide }, job) => {
        const kept = arr.slice(0, -1);
        const structure = kept.map(l => l.material).join('|');
        if ((job.skip || []).includes(structure)) return { removed: 0 };
        const { nf, nb } = withSide(kept);
        return { removed: 1, i: arr.length - 1, structure, mf: 0.48, omf: 0.48, baseMf: 0.42, side: job.side, frontLayers: nf, backLayers: nb, nLayers: nf.length + nb.length };
    },
    removePass: ({ front, back }) => {
        const dropFront = front.length >= back.length && front.length > 0;
        const nf = dropFront ? front.slice(0, -1) : front;
        const nb = dropFront ? back : back.slice(0, -1);
        return { removed: 1, mf: 0.2, frontLayers: nf, backLayers: nb, nLayers: nf.length + nb.length, baseLayers: front.length + back.length, baseMf: 0.25, omf: 0.2 };
    },
};

// The real handlers, or the scripted answer, for one job.
function answerJob(win, job, post) {
    if (win.spec.worker === 'scripted') {
        const answer = SCRIPTED_ANSWERS[job.type];
        post({ type: 'result', ...(answer ? answer(jobStacks(job), job) : {}) });
        return;
    }
    try { dispatchSynthesisJob(job, makeResolveMat(job.materials || {}, 'fakeWindow'), post); }
    catch (e) { post({ type: 'error', message: String(e && e.message || e) }); }
}

// What the nth job of a press does instead of its work: `stopAtJob` presses
// Stop as it starts, `failAtJob` fails it, and `previewThenFailAtJob` sends one
// live preview first. Returns true when the job is taken care of.
function scriptedJob(win, n, post) {
    const press = win.press;
    if (n === press.stopAtJob) { win.ctx.stopOpt(''); return true; }
    if (n === press.previewThenFailAtJob) post({ type: 'tick', mf: 0.5, omf: 0.5, frontLayers: PREVIEW, backLayers: [], layers: PREVIEW });
    if (n === press.failAtJob || n === press.previewThenFailAtJob) { post({ type: 'error', message: 'the pool failed' }); return true; }
    return false;
}

// The worker a WorkerPool builds. `press.poolThrows` makes building it throw.
class FakeWorker {
    constructor() {
        if (current.press.poolThrows) throw new Error('no workers');
        this.win = current;
        this.win.workers++;
        this.onmessage = null; this.onerror = null; this.onmessageerror = null;
        this.dead = false;
    }
    postMessage(job) {
        if (this.dead || !job || job.type === 'wasmInit') return;
        const win = this.win;
        const n = ++win.jobCount;
        win.jobs[job.type] = (win.jobs[job.type] || 0) + 1;
        const post = m => { if (!this.dead && this.onmessage) this.onmessage({ data: m }); };
        Promise.resolve().then(() => {
            if (this.dead || scriptedJob(win, n, post)) return;
            answerJob(win, job, post);
        });
    }
    terminate() { if (!this.dead) { this.dead = true; this.win.terminated++; } }
}
globalThis.Worker = FakeWorker;

/**
 * A window on `spec.design` (as design `id`) with `spec.ops`, `spec.pool` and
 * the field values maxLayers, maxGeCycles, targetMF, dlsIter, dMin and
 * deepSearch. `win.press` sets what the workers do during the next Run press;
 * `win.shown`, `win.statuses`, `win.phases` and `win.applied` record what the
 * window shows.
 */
export function makeWindow(spec, id) {
    const ref = current => ({ current });
    const win = {
        spec, press: {}, jobs: {}, jobCount: 0, workers: 0, terminated: 0,
        statuses: [], phases: [], shown: {}, applied: null, checkpoints: 0, edits: 0, designUpdates: 0,
    };
    // Consecutive repeats are recorded once.
    const push = list => v => { const l = list(); if (l[l.length - 1] !== v) l.push(v); };
    const show = key => v => { win.shown[key] = v; };
    const ctx = {
        runningRef: ref(false), timerRef: ref(null), workerRef: ref(null), dlsRef: ref(null),
        baseDesignRef: ref(null), savedDesignRef: ref(null), baseRevRef: ref(0),
        designRef: ref({ ...spec.design, id }),
        operandsRef: ref(spec.ops.map(op => ({ enabled: true, ...op }))),
        cyclesRef: ref([]), genCountRef: ref(0), geStepsRef: ref(0),
        runsRef: ref([]), runOpenRef: ref(false),
        updateDesignRef: ref((patch, opts) => {
            win.applied = { ...(win.applied || {}), ...patch };
            ctx.designRef.current = { ...ctx.designRef.current, ...patch };
            win.designUpdates++;
            win.edits += opts?.transient ? 0 : 1;
        }),
        checkpointRef: ref(() => { win.checkpoints++; }),
        maxLayersRef: ref(spec.maxLayers), maxGeCyclesRef: ref(spec.maxGeCycles),
        targetMFRef: ref(spec.targetMF), dlsIterRef: ref(spec.dlsIter), dMinRef: ref(spec.dMin),
        deepSearchRef: ref(!!spec.deepSearch),
        selectedCatsRef: ref([]), excludedMatsRef: ref(new Set()),
        setPhase: push(() => win.phases), setStatusMsg: push(() => win.statuses), setCanReset: show('canReset'),
        setMf: show('mf'), setOmf: show('omf'), setMfBest: show('mfBest'), setOmfBest: show('omfBest'),
        setCycles: v => { win.shown.rows = v.length; }, setGeneration: show('generation'),
        setLayerCount: show('layerCount'), setGeSteps: show('geSteps'),
        reconcileBaseWithEdits: () => {},
        getPoolMaterials: () => spec.pool,
        t: EN,
    };
    // useGradualEvolution.js stopOpt.
    ctx.stopOpt = (msg = '') => {
        const wasRunning = ctx.runningRef.current;
        ctx.runningRef.current = false;
        clearTimeout(ctx.timerRef.current);
        if (ctx.workerRef.current) {
            try { ctx.workerRef.current.terminate(); } catch (_) {}
            ctx.workerRef.current = null;
        }
        ctx.setPhase('idle');
        if (msg || wasRunning) ctx.setStatusMsg(msg);
    };
    win.ctx = ctx;
    return win;
}

const tick = () => new Promise(r => setTimeout(r, 0));

/** Wait until the window's run has ended, and a moment more. */
export async function settle(win) {
    for (let i = 0; i < 200000 && win.ctx.runningRef.current; i++) await tick();
    for (let i = 0; i < 50; i++) await tick();
}

/**
 * Runs `body` with the window settings `storage` (keys of STORAGE; threads 3
 * unless given) in local storage and the run's console output silenced.
 */
export async function withWindowSettings(storage, body) {
    for (const [key, value] of Object.entries({ threads: '3', ...storage })) localStorage.setItem(STORAGE[key], value);
    const quiet = console.log, quietErr = console.error;
    console.log = () => {}; console.error = () => {};
    try { return await body(); } finally {
        console.log = quiet; console.error = quietErr;
        for (const key of Object.values(STORAGE)) localStorage.removeItem(key);
    }
}
