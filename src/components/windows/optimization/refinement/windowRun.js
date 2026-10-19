// Starts a refinement run for the Refinement window and shows it. The window's
// fields become the run's settings; what the run reports lands on the readout,
// the live design, Best, the Design History and the end-of-run badge.
//
// A plain function of the `ctx` bag useRefinement.js builds (buildRunCtx): its
// refs, state setters, cache helpers and the locale table `t`.

import { runRefinement } from '../../../../utils/refinement/runRefinement.js';
import { getThreadCount } from '../../../../utils/synthesis/synthesisConfig.js';
import { WorkerPool } from '../../../../utils/workers/workerPool.js';
import { getTmmWasmBytesForWorker } from '../../../../tmmcore.js';
import { OPTIMIZER_WORKER_URL, MFEVAL_WORKER_URL } from '../../../../workerUrls.js';

// Readout values a run reports, and the setter that shows each.
const PATCH_SETTERS = [
    ['mfInitial', 'setMfInitial'], ['omfInitial', 'setOmfInitial'],
    ['mf', 'setMf'], ['mfBest', 'setMfBest'], ['omf', 'setOmf'], ['omfBest', 'setOmfBest'],
    ['iter', 'setIter'], ['mfHistory', 'setMfHistory'], ['restartIdx', 'setRestartIdx'],
];

// Ends that leave no badge: a stop by the user, a worker failing part-way
// (the run keeps what it had shown), and a multi-start, whose last restart
// says nothing about the others.
const NO_BADGE = new Set(['stopped', 'workerError', 'restartsDone']);

const makeWorker = () => new Worker(OPTIMIZER_WORKER_URL, { type: 'module' });

function makeEvalPool(size) {
    const wasmBytes = getTmmWasmBytesForWorker();
    return new WorkerPool(MFEVAL_WORKER_URL, size, wasmBytes ? { type: 'wasmInit', wasmBytes } : null);
}

// Parallel DE runs only on a machine with more than two hardware threads.
function evalPoolFactory() {
    const threads = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    return threads > 2 ? makeEvalPool : undefined;
}

function settingsOf(ctx) {
    const method = ctx.methodRef.current;
    const single = method !== 'all' && (!Array.isArray(method) || method.length === 1);
    return {
        method,
        ...(single ? { maxIter: ctx.maxIterRef.current } : {}),
        nRestarts: ctx.nRestartsRef.current,
        perturbPct: ctx.perturbPctRef.current,
        seed: ctx.seedRef.current,
        threads: getThreadCount(),
    };
}

// The layer stacks a surface mode optimizes. A symmetric coating's back follows
// its front.
const OPTIMIZED_SIDES = { back_only: ['backLayers'], both_independent: ['frontLayers', 'backLayers'] };
const optimizedSides = surfaceMode => OPTIMIZED_SIDES[surfaceMode] || ['frontLayers'];

// What Best applies (useRefinement.js applyBest): the run's best, on the sides
// the run optimized, whatever the surface mode is when Best is pressed.
const bestRecord = (best, sides) => ({
    mfBest: best.mf, omf: best.omf, frontLayers: best.frontLayers, backLayers: best.backLayers, sides,
});

// The run has started: one undo checkpoint and Reset baseline per session, the
// seed it drew shown in the seed field, and the previous run's result cleared.
// The readout starts empty: the run's start values come from its workers a
// little later (utils/refinement), and until then the last run's would read as
// this one's.
function beginRun(ctx, design, seed) {
    if (!ctx.baselineRef.current) {
        ctx.checkpointRef.current && ctx.checkpointRef.current();
        ctx.commitBaseline({ frontLayers: design.frontLayers, backLayers: design.backLayers });
        ctx.baselineRef.current = true;
    }
    if (seed != null) ctx.setSeed(seed);
    ctx.runningRef.current = true;
    ctx.setRunning(true);
    ctx.setCanReset(true);
    ctx.setStopReason(null);
    ctx.lastBestRef.current = null;
    for (const setter of ['setMfInitial', 'setOmfInitial', 'setMf', 'setMfBest', 'setOmf', 'setOmfBest']) ctx[setter](null);
    ctx.setMfHistory([]);
    ctx.setIter(0);
}

// Best works from the run's best as soon as there is one.
function showProgress(ctx, patch, run) {
    for (const [key, setter] of PATCH_SETTERS) if (key in patch) ctx[setter](patch[key]);
    if (patch.design) {
        ctx.updateDesignRef.current(
            { frontLayers: patch.design.frontLayers, backLayers: patch.design.backLayers }, { transient: true });
    }
    if (patch.best) ctx.lastBestRef.current = bestRecord(patch.best, run.sides);
}

function recordRow(ctx, row) {
    const tr = ctx.t.refinement;
    const layers = row[row.layerSide] || [];
    ctx.addHistEntry({
        id: Math.random().toString(36).slice(2),
        label: row.restarts ? `${tr.history.run(ctx.histRunCount.current)} (×${row.restarts})` : tr.methods[row.method],
        iter: row.iter, mf: row.mf, omf: row.omf, layers, layerCount: layers.length,
        layerSide: row.layerSide,
        mfHistory: row.mfHistory,
        ...(row.seed != null ? { seed: row.seed } : {}),
    });
}

function badgeOf(result) {
    if (NO_BADGE.has(result.stopReason)) return null;
    if (result.stopReason === 'invalidOperand') return `invalidOperand:${result.message}`;
    return result.stopReason;
}

// The run is over. A completed run puts its best design on screen and arms Best
// with it; any run ends with its badge, unless the window has moved on to
// another design.
function endWindowRun(ctx, result, run) {
    ctx.runningRef.current = false;
    ctx.setRunning(false);
    ctx.setRestartIdx(0);
    if (!run.onDesign()) return;
    if (result.completed && result.frontLayers) {
        ctx.updateDesignRef.current({ frontLayers: result.frontLayers, backLayers: result.backLayers }, { transient: true });
        ctx.lastBestRef.current = bestRecord(result, run.sides);
    }
    ctx.setStopReason(badgeOf(result));
}

/**
 * Starts a run of the window's method on the design and operands on screen.
 * Returns a promise that settles once the run's end is shown. What a run
 * stopped by Stop or Best still reports while it unwinds is shown, so a method
 * cut short still offers its best to Best. A run the window has let go of
 * (ctx.activeRunRef no longer holds it, after Reset, Restore, an operand edit,
 * a design switch or closing the window) shows nothing more, and neither does
 * one whose design is no longer on screen.
 */
export function startWindowRun(ctx) {
    if (ctx.runningRef.current) return Promise.resolve();
    const design = ctx.designRef.current;
    const settings = settingsOf(ctx);
    const token = {};
    const controller = new AbortController();
    ctx.activeRunRef.current = token;
    ctx.abortRef.current = controller;
    const run = {
        sides: optimizedSides(design.surfaceMode),
        isCurrent: () => ctx.activeRunRef.current === token,
        onDesign: () => run.isCurrent() && ctx.designRef.current?.id === design.id,
    };
    const hooks = {
        signal: controller.signal,
        makeWorker,
        makeEvalPool: evalPoolFactory(),
        onStart: ({ seed }) => { if (run.onDesign()) beginRun(ctx, design, seed); },
        onMethodStart: () => { if (run.onDesign()) ctx.bumpRunCount(); },
        onProgress: (patch) => { if (run.onDesign()) showProgress(ctx, patch, run); },
        onRecord: (row) => { if (run.onDesign()) recordRow(ctx, row); },
    };
    return runRefinement(design, ctx.operandsRef.current || [], settings, hooks)
        .then(result => { if (run.isCurrent()) endWindowRun(ctx, result, run); })
        .catch(err => {
            console.error('[Refine] the run failed:', err);
            if (run.isCurrent()) endWindowRun(ctx, { completed: false, stopReason: 'stopped' }, run);
        });
}
