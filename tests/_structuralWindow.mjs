/**
 * A fake Structural Optimizer window for tests: the ctx useStructuralOptimizer.js
 * hands a run, its Stop, a recorder for what the window shows, and the global
 * `Worker` the run's refines go to.
 *
 * The scripted worker answers each refine from the run's phase, which it reads
 * off the status line: the baseline refine scores 0.8, smart-seed refines 0.55
 * and lower, a reheat 0.1, and the proposals of an iteration the merits listed
 * in the window's `normalMf`. A window whose spec says `worker: 'real'` refines
 * on the calling thread with the real optimizer job (InThreadOptimizerWorker).
 *
 * Import it after shimBrowserGlobals() (_uiShim.mjs).
 */
import { InThreadOptimizerWorker } from '../src/utils/workers/inThreadOptimizerWorker.js';
import { getCatalogs } from '../src/utils/materials/catalogManager.js';
import { getCached, setCached } from '../src/components/windows/optimization/structuralOptimizer/sessionState.js';
import { reconcileStructuralBaseWithEdits } from '../src/components/windows/optimization/structuralOptimizer/useStructuralOptimizer.js';
import { teardownRun } from '../src/components/windows/optimization/synthesisShared/teardownRun.js';

const copy = value => JSON.parse(JSON.stringify(value));

// Status lines as short tokens, so the scripted worker can read the phase off
// them and a snapshot reads plainly.
export const TS = {
    noOperands: 'no-operands', noMaterials: 'no-materials',
    statusPresampleFailed: 'presample-failed', statusWorkerFailed: 'worker-failed',
    statusBaseline: 'baseline', statusNoMut: 'no-mutation',
    statusDone: 'done', statusMaxIter: 'max-iterations', statusCap: 'layer-cap',
    statusTimeUp: 'time-up', statusStopped: 'stopped',
    smartSeeding: count => `smart:${count}`,
    statusRefining: count => `refining:${count}`,
    statusReheat: count => `reheat:${count}`,
    statusConverged: mf => `converged:${mf.toFixed(3)}`,
    statusStalled: patience => `stalled:${patience}`,
};

// The window whose run the workers serve.
let current = null;
export const useWindow = win => { current = win; };

// The phase a status line starts.
const PHASES = [['smart:', 'smart'], ['refining:', 'normal'], ['reheat:', 'reheat'], ['baseline', 'baseline']];

// What the window records of the run's first refine.
const jobSummary = job => ({
    method: job.method, maxIter: job.opts?.maxIter, ...job.engineOpts, ops: job.operands.length, wasm: !!job.wasmBytes,
});

// What the scripted worker answers for the nth job of a press: `stopAtJob`
// presses Stop as it starts, `failAtJob` fails it, `malformedAtJob` answers
// with no layers, `holdAtJob` never answers, as a refine that hangs. Returns
// true when the job is taken care of.
function scriptedJob(win, worker, n) {
    const press = win.press;
    if (n === press.stopAtJob) { win.ctx.stopOpt(); return true; }
    if (n === press.failAtJob) { worker.post({ type: 'error', message: 'scripted refine failure' }); return true; }
    if (n === press.malformedAtJob) { worker.post({ type: 'done', mfBest: 0.2, omfBest: 0.2 }); return true; }
    return n === press.holdAtJob;
}

function scriptedMerit(win) {
    const phase = win.phase;
    const call = (win.phaseCalls[phase] || 0) + 1;
    win.phaseCalls[phase] = call;
    if (phase === 'smart') return 0.55 - Math.min(call, 4) * 0.05;
    if (phase === 'reheat') return 0.1;
    if (phase === 'baseline') return 0.8;
    const list = win.spec.normalMf;
    return list[Math.min(call - 1, list.length - 1)];
}

// The optimizer worker the run builds. `press.workersThrow` makes building it
// throw; a smart-seed phase fails its first refine, as one seed job can.
class ScriptedWorker {
    constructor() {
        if (current.press.workersThrow) throw new Error('no workers');
        this.win = current;
        this.win.workers++;
        this.onmessage = null; this.onerror = null; this.dead = false;
    }
    postMessage(job) {
        if (this.dead || !job || job.type !== 'start') return;
        const win = this.win;
        const n = ++win.jobCount;
        if (n === 1) win.firstJob = jobSummary(job);
        setTimeout(() => this.run(job, n), 0);
    }
    post(data) { if (!this.dead && this.onmessage) this.onmessage({ data }); }
    run(job, n) {
        const win = this.win;
        if (this.dead || scriptedJob(win, this, n)) return;
        if (win.phase === 'smart' && !win.failedSeed) {
            win.failedSeed = true;
            this.post({ type: 'error', message: 'scripted seed failure' });
            return;
        }
        const mf = scriptedMerit(win);
        this.post({ type: 'progress', mf: mf + 0.01, omf: mf + 0.02 });
        this.post({
            type: 'done', mfBest: mf, omfBest: mf + 0.001,
            bestFrontLayers: copy(job.design.frontLayers || []), bestBackLayers: copy(job.design.backLayers || []),
        });
    }
    terminate() { if (!this.dead) { this.dead = true; this.win.terminated++; } }
}
globalThis.Worker = ScriptedWorker;

// The real optimizer job on the calling thread, counted as the scripted worker
// counts.
class CountedWorker extends InThreadOptimizerWorker {
    constructor(win) {
        super();
        this.win = win;
        win.workers++;
    }
    postMessage(job) {
        if (job?.type === 'start' && ++this.win.jobCount === 1) this.win.firstJob = jobSummary(job);
        super.postMessage(job);
    }
    terminate() {
        if (!this.terminated) this.win.terminated++;
        super.terminate();
    }
}

/**
 * A worker whose refines wait until it is terminated, as they do while a real
 * worker computes. `tick(mf)` sends a live merit for the refine it holds, also
 * after it was terminated, as a message already on its way still arrives.
 */
export function makeWaitingWorker() {
    return {
        onmessage: null, onerror: null, dead: false,
        postMessage() {},
        terminate() { this.dead = true; },
        tick(mf) { this.onmessage?.({ data: { type: 'progress', mf, omf: mf } }); },
    };
}

// The built-in materials other than `poolIds`, which the window's material
// pool then leaves out.
export function excludedBesides(poolIds) {
    const ids = Object.keys(getCatalogs().find(catalog => catalog.id === 'builtin')?.materials || {});
    return new Set(ids.filter(id => !poolIds.includes(id)));
}

/**
 * A window on `spec.design` (as design `id`) with `spec.ops`, the settings
 * `spec.cfg` and the pool `spec.poolIds` (every built-in material when absent).
 * `win.press` sets what the workers do during the next Run press; `win.statuses`
 * and `win.shown` record what the window shows, `win.edits` the design writes
 * that are not run previews. `win.edit()` edits the design as the user would,
 * which bumps its revision.
 */
export function makeWindow(spec, id) {
    const ref = value => ({ current: value });
    const win = {
        spec, press: {}, phase: 'baseline', phaseCalls: {}, failedSeed: false,
        jobCount: 0, workers: 0, terminated: 0, firstJob: null, revision: 0,
        statuses: [], shown: {}, applied: 0, edits: 0, checkpoints: 0, reconciles: 0,
    };
    const designRef = ref({ ...copy(spec.design), id });
    const show = key => value => { win.shown[key] = value; };
    const ctx = {
        cfgRef: ref({ ...spec.cfg, kinds: new Set(spec.cfg.kinds) }),
        runningRef: ref(false), activeRunRef: ref(null), abortRef: ref(null), designRef,
        operandsRef: ref(copy(spec.ops)), savedDesignRef: ref(null), baseDesignRef: ref(null), baseRevRef: ref(0),
        gensRef: ref([]), genCountRef: ref(0), trendRef: ref([]), runsRef: ref([]), runOpenRef: ref(false),
        updateDesignRef: ref((patch, opts) => {
            designRef.current = { ...designRef.current, ...copy(patch) };
            win.applied++;
            win.edits += opts?.transient ? 0 : 1;
        }),
        checkpointRef: ref(() => { win.checkpoints++; }),
        selectedCatsRef: ref(new Set(['builtin'])),
        excludedMatsRef: ref(spec.poolIds ? excludedBesides(spec.poolIds) : new Set()),
        makeWorker: spec.worker === 'real' ? () => new CountedWorker(win) : undefined,
        ts: TS,
        setRunning: show('running'), setIter: show('iter'), setTemp: show('temp'), setAccRate: show('accRate'),
        setMf: show('mf'), setMfBest: show('mfBest'), setOmf: show('omf'), setOmfBest: show('omfBest'),
        setLayerCount: show('layerCount'), setReheats: show('reheats'), setSeed: show('seed'),
        setCanReset: show('canReset'),
        setGenerations: rows => { win.shown.rows = rows.length; },
        setTopDesigns: top => { win.shown.top = top.length; },
        setTrend: trend => { win.shown.trend = trend.length; },
        setStatusMsg: value => {
            if (win.statuses[win.statuses.length - 1] !== value) win.statuses.push(value);
            const phase = PHASES.find(([prefix]) => String(value).startsWith(prefix));
            if (phase) win.phase = phase[1];
        },
    };
    // useStructuralOptimizer.js reconcileBaseWithEdits, saveCache and stopOpt.
    ctx.reconcileBaseWithEdits = () => {
        win.reconciles++;
        reconcileStructuralBaseWithEdits(ctx, () => win.revision);
    };
    ctx.saveCache = () => setCached(id, {
        generations: ctx.gensRef.current, runs: ctx.runsRef.current,
        savedDesign: ctx.savedDesignRef.current, baseDesign: ctx.baseDesignRef.current,
        baseRev: ctx.baseRevRef.current, trend: ctx.trendRef.current,
    });
    ctx.stopOpt = message => {
        const wasRunning = ctx.runningRef.current;
        teardownRun(ctx);
        ctx.setRunning(false);
        ctx.setTemp(null);
        ctx.setStatusMsg(message != null ? message : (wasRunning ? TS.statusStopped : ''));
    };
    win.ctx = ctx;
    win.cached = () => getCached(id);
    win.edit = () => {
        const front = ctx.designRef.current.frontLayers;
        ctx.designRef.current = { ...ctx.designRef.current, frontLayers: front.map(l => ({ ...l, thickness: l.thickness + 5 })) };
        win.revision++;
    };
    return win;
}

/**
 * Runs `body` with the window settings `storage` (threads 1 unless given) in
 * local storage and the run's console output silenced.
 */
export async function withWindowSettings(storage, body) {
    const KEYS = { threads: 'tfstudio-worker-threads', smartSeed: 'tfstudio-synth-smart-seed-structural', engine: 'tfstudio-synth-inner-engine-structural' };
    for (const [key, value] of Object.entries({ threads: '1', smartSeed: '0', ...storage })) localStorage.setItem(KEYS[key], value);
    const quiet = console.log, quietErr = console.error, quietWarn = console.warn;
    console.log = () => {}; console.error = () => {}; console.warn = () => {};
    try { return await body(); } finally {
        console.log = quiet; console.error = quietErr; console.warn = quietWarn;
        for (const key of Object.values(KEYS)) localStorage.removeItem(key);
    }
}
