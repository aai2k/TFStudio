/**
 * A fake Needle Automatic window for tests: the refs and setters
 * useNeedleVariation.js builds, its Stop, a recorder for what the window shows,
 * and in-process worker pools that run the real synthesis-worker handlers
 * (dispatchSynthesisJob) one job after another.
 *
 * Import it after shimBrowserGlobals() (_uiShim.mjs): the window modules it
 * loads expect the browser globals.
 */
import { dispatchSynthesisJob } from '../src/utils/workers/synthesisWorker.js';
import { makeResolveMat } from '../src/utils/workers/resolveMat.js';
import { teardownRun } from '../src/components/windows/optimization/needleVariation/needleLifecycle.js';
import EN from '../src/constants/locales/en.js';

// Window settings that live in local storage.
export const STORAGE = {
    threads: 'tfstudio-worker-threads',
    engine: 'tfstudio-synth-inner-engine-needle',
    smartSeed: 'tfstudio-synth-smart-seed-needle',
    candMode: 'tfstudio-synth-cand-batches',
    sensitivity: 'tfstudio-needle-sensitivity',
};

export const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });

// A seed's in-flight design, as a worker's live preview sends it.
export const PREVIEW = [layer('P1', 'TiO2', 60), layer('P2', 'SiO2', 90)];

const tickOf = (mf, layers = PREVIEW) => ({ type: 'tick', mf, omf: mf, frontLayers: layers, backLayers: [], layers });

// Runs one job with the worker's handlers, ticks going to onProgress(i, m).
function runJob(job, i, onProgress) {
    return new Promise((resolve, reject) => {
        const post = (m) => {
            if (m.type === 'tick') { onProgress && onProgress(i, m); return; }
            if (m.type === 'error') { reject(new Error(m.message)); return; }
            resolve(m);
        };
        try { dispatchSynthesisJob(job, makeResolveMat(job.materials || {}, 'fakeWindow'), post); }
        catch (e) { reject(e); }
    });
}

// What the nth map call of a press does instead of running its jobs:
// `stopAtMap` presses Stop while it is in flight, as a real pool's terminate()
// would, `failAtMap` fails it, and `previewThenFailAtMap` sends one live
// preview first.
function scriptedMap(win, press, onProgress) {
    const n = win.maps;
    if (n === press.stopAtMap) { win.ctx.stopOpt(''); return Promise.reject(new Error('pool terminated')); }
    if (n === press.previewThenFailAtMap) onProgress(0, tickOf(0.5));
    if (n === press.failAtMap || n === press.previewThenFailAtMap) return Promise.reject(new Error('the pool failed'));
    return null;
}

// The in-process pool of one press; `press.poolThrows` makes building it throw.
function makePool(win, press) {
    if (press.poolThrows) throw new Error('no workers');
    return {
        map(jobs, onProgress) {
            win.maps++;
            const scripted = scriptedMap(win, press, onProgress);
            if (scripted) return scripted;
            for (const job of jobs) win.jobs[job.type] = (win.jobs[job.type] || 0) + 1;
            return Promise.all(jobs.map((job, i) => runJob(job, i, onProgress)));
        },
        terminate() { win.terminated++; },
    };
}

/**
 * A pool whose map waits until the pool is terminated, as a pool does while its
 * workers compute. `tick(mf)` sends a live preview through the progress
 * callback of its last map call.
 */
export function makeWaitingPool() {
    const waiting = [];
    let progress = null;
    return {
        map(jobs, onProgress) { progress = onProgress; return new Promise((_, reject) => waiting.push(reject)); },
        terminate() { for (const reject of waiting.splice(0)) reject(new Error('pool terminated')); },
        tick: mf => progress(0, tickOf(mf)),
    };
}

/**
 * A window on `spec.design` with `spec.ops`, `spec.pool` and the field values
 * maxLayers, deltaNm, dMin, dlsIter and targetMF. `win.press` sets what the
 * pool of the next Run press does; `win.shown`, `win.statuses`, `win.phases`
 * and `win.applied` record what the window shows.
 */
export function makeWindow(spec) {
    const ref = current => ({ current });
    const win = {
        maps: 0, jobs: {}, terminated: 0, checkpoints: 0, edits: 0, designUpdates: 0,
        statuses: [], phases: [], shown: {}, applied: null, press: {},
    };
    // Consecutive repeats are recorded once.
    const push = list => v => { const l = list(); if (l[l.length - 1] !== v) l.push(v); };
    const show = key => v => { win.shown[key] = v; };
    const ctx = {
        runningRef: ref(false), activeRunRef: ref(null), abortRef: ref(null),
        baseDesignRef: ref(null), savedDesignRef: ref(null), designRef: ref(spec.design),
        operandsRef: ref(spec.ops.map(op => ({ enabled: true, ...op }))),
        gensRef: ref([]), genCountRef: ref(0),
        runsRef: ref([]), runOpenRef: ref(false),
        maxLayersRef: ref(spec.maxLayers), deltaNmRef: ref(spec.deltaNm), dMinRef: ref(spec.dMin),
        dlsIterRef: ref(spec.dlsIter), targetMFRef: ref(spec.targetMF),
        selectedCatsRef: ref([]), excludedMatsRef: ref(new Set()),
        updateDesignRef: ref((patch, opts) => {
            win.applied = { ...(win.applied || {}), ...patch };
            win.designUpdates++;
            ctx.designRef.current = { ...ctx.designRef.current, ...patch };
            win.edits += opts?.transient ? 0 : 1;
        }),
        checkpointRef: ref(() => { win.checkpoints++; }),
        setPhase: push(() => win.phases),
        setStatusMsg: push(() => win.statuses),
        setMf: show('mf'), setMfBest: show('mfBest'), setOmf: show('omf'), setOmfBest: show('omfBest'),
        setLayerCount: show('layerCount'), setCanReset: show('canReset'), setGeneration: show('generation'),
        setGenerations: v => { win.shown.rows = v.length; },
        setTopDesigns: v => { win.shown.top = v.map(g => g.genNum); },
        reconcileBaseWithEdits: () => {},
        getPoolMaterials: () => spec.pool,
        setCachedOptState: (id, cached) => { win.cached = { id, rows: cached.generations.length, runs: cached.runs.length }; },
        t: EN,
        makeWorkerPool: () => makePool(win, win.press),
    };
    // useNeedleVariation.js stopOpt.
    ctx.stopOpt = (msg = '') => {
        const wasRunning = ctx.runningRef.current;
        teardownRun(ctx);
        ctx.setPhase('idle');
        if (msg || wasRunning) ctx.setStatusMsg(msg);
    };
    win.ctx = ctx;
    return win;
}

/** Wait until the window's run has ended, and a moment more. */
export async function settle(win) {
    for (let i = 0; i < 10000 && win.ctx.runningRef.current; i++) await new Promise(r => setTimeout(r, 1));
    await new Promise(r => setTimeout(r, 5));
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
