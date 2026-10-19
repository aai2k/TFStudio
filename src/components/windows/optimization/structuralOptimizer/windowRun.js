// Starts a Structural run for the Structural Optimizer window and shows it.
// The window's fields become the run's settings; what the run reports lands on
// the readout, the design, the history, Top Designs, the trend and the status
// line. Run blocks (synthesisShared/runBlocks.js) are the window's: a Run press
// opens one unless a Stop left one open, and Reset undoes one.
//
// A plain function of the `ctx` bag useStructuralOptimizer.js builds: its
// refs, state setters, cache and Stop, and the locale table `ts`.

import { runStructural } from '../../../../utils/structural/runStructural.js';
import {
    getSynthesisInnerEngine, getSynthesisSmartSeed, getThreadCount,
} from '../../../../utils/synthesis/synthesisConfig.js';
import { OPTIMIZER_WORKER_URL } from '../../../../workerUrls.js';
import { activeSide, computePareto, minOmfOf } from '../synthesisShared/synthesisMath.js';
import { getPoolMaterials } from '../synthesisShared/catalogPool.js';
import { activeBaseline, activeRunNum, openRunBlock } from '../synthesisShared/runBlocks.js';

// Live readout: a refine's in-flight merit is shown at most this often, in ms.
const LIVE_EVERY_MS = 100;

const ACTIVITY_TEXT = {
    baseline:     (ts) => ts.statusBaseline,
    smartSeeding: (ts, a) => ts.smartSeeding(a.count),
    refining:     (ts, a) => ts.statusRefining(a.count),
    reheat:       (ts, a) => ts.statusReheat(a.count),
};

// The status line a run that ended without an answer leaves.
const FAILURE_TEXT = {
    noOperands:      (ts) => ts.noOperands,
    noMaterials:     (ts) => ts.noMaterials,
    presampleFailed: (ts) => ts.statusPresampleFailed,
    workerFailed:    (ts) => ts.statusWorkerFailed,
    workerError:     (ts, result) => result.message,
};

// The status line a run that ended on its own leaves.
const END_TEXT = {
    maxIter:      (ts) => ts.statusMaxIter,
    iterationCap: (ts) => ts.statusDone,
    target:       (ts, result) => ts.statusConverged(result.stopMF),
    patience:     (ts, result) => ts.statusStalled(result.patience),
    budget:       (ts) => ts.statusTimeUp,
    layerCap:     (ts) => ts.statusCap,
    noMutation:   (ts) => ts.statusNoMut,
};

const newWorker = () => new Worker(OPTIMIZER_WORKER_URL, { type: 'module' });

// The history a press carries on: the run block a Stop left open, numbered on
// from it. A press that opens a new block starts at generation 1. Time and the
// trend run on from the last row and point.
function historyOf(ctx) {
    const gens = ctx.gensRef.current;
    const trend = ctx.trendRef.current;
    return {
        genNum: ctx.runOpenRef.current ? ctx.genCountRef.current : 0,
        hasRows: gens.length > 0,
        elapsedMs: gens.length ? (gens[gens.length - 1].tMs || 0) : 0,
        trendIter: trend.length ? trend[trend.length - 1].iter : 0,
    };
}

function settingsOf(ctx, curDes) {
    const cfg = ctx.cfgRef.current;
    return {
        pool: getPoolMaterials(ctx.selectedCatsRef.current, { excluded: ctx.excludedMatsRef.current, design: curDes }),
        maxIter: cfg.maxIter, targetMF: cfg.targetMF, T0: cfg.T0, jitterPct: cfg.jitterPct,
        refineIter: cfg.refineIter, dMin: cfg.dMin, addMaxNm: cfg.addMaxNm, maxLayers: cfg.maxLayers,
        kinds: [...cfg.kinds], deepSearch: !!cfg.deepMode, deepMaxMin: cfg.deepMaxMin, seed: cfg.seed ?? null,
        innerEngine: getSynthesisInnerEngine('structural'), smartSeed: getSynthesisSmartSeed('structural'),
        threads: getThreadCount(),
        history: historyOf(ctx),
    };
}

// Open a run block for this press unless one is still open from a Stop. The
// block records the design the press started from, which is what Reset
// restores (synthesisShared/runBlocks.js).
function openBlock(ctx, curDes) {
    if (ctx.runOpenRef.current) return;
    ctx.checkpointRef.current?.();
    ctx.runsRef.current = openRunBlock(ctx.runsRef.current, ctx.designRef.current);
    ctx.savedDesignRef.current = activeBaseline(ctx.runsRef.current);
    ctx.baseDesignRef.current = curDes;
    // Generations are numbered within their run, so a new block starts at 1.
    ctx.genCountRef.current = 0;
    ctx.runOpenRef.current = true;
    ctx.setCanReset(true);
}

// The values a report may carry, and the setter that shows each.
const SHOWN = [
    ['seed', 'setSeed'], ['iter', 'setIter'], ['temp', 'setTemp'], ['accRate', 'setAccRate'], ['reheats', 'setReheats'],
    ['mf', 'setMf'], ['mfBest', 'setMfBest'], ['omf', 'setOmf'], ['omfBest', 'setOmfBest'], ['layerCount', 'setLayerCount'],
];

// A refine's in-flight merit, at most every LIVE_EVERY_MS.
function showLive(ctx, live, clock) {
    const now = Date.now();
    if (now - clock.last < LIVE_EVERY_MS) return;
    clock.last = now;
    if (live.mf != null) ctx.setMf(live.mf);
    if (live.omf != null) ctx.setOmf(live.omf);
}

function showTrend(ctx, point, redraw) {
    ctx.trendRef.current = [...ctx.trendRef.current, { ...point, runNum: activeRunNum(ctx.runsRef.current) }];
    if (redraw) ctx.setTrend(ctx.trendRef.current.slice());
}

function showProgress(ctx, patch, clock) {
    if (patch.activity) ctx.setStatusMsg(ACTIVITY_TEXT[patch.activity.id](ctx.ts, patch.activity));
    if (patch.design) ctx.updateDesignRef.current(patch.design, { transient: true });
    for (const [key, setter] of SHOWN) if (key in patch) ctx[setter]?.(patch[key]);
    if (patch.trend) showTrend(ctx, patch.trend, patch.redraw);
    if (patch.live) showLive(ctx, patch.live, clock);
}

// A history row the run reports, with the readout that goes with it.
function recordRow(ctx, row) {
    ctx.gensRef.current = [...ctx.gensRef.current, { ...row, runNum: activeRunNum(ctx.runsRef.current) }];
    ctx.genCountRef.current = row.genNum;
    ctx.setGenerations(ctx.gensRef.current.slice());
    ctx.setTopDesigns(computePareto(ctx.gensRef.current));
    ctx.setMfBest(row.mf);
    ctx.setOmfBest(minOmfOf(ctx.gensRef.current));
    ctx.saveCache();
}

// The best design the run ended on becomes the design, and the design the
// next Run press goes on from.
function showBest(ctx, result, curDes) {
    if (!result.frontLayers && !result.backLayers) return;
    const patch = {};
    if (result.frontLayers) patch.frontLayers = result.frontLayers;
    if (result.backLayers) patch.backLayers = result.backLayers;
    ctx.updateDesignRef.current(patch, { transient: true });
    ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
    ctx.setMf(result.mf);
    ctx.setMfBest(result.mf);
    ctx.setLayerCount((result[activeSide(curDes) === 'back' ? 'backLayers' : 'frontLayers'] || []).length);
    if (result.omf != null) {
        ctx.setOmf(result.omf);
        ctx.setOmfBest(result.omf);
    }
}

// The run is over. One that ended on its own shows its best design and closes
// its run block, so the next Run press opens a new one; a Stop leaves the block
// open (stopOpt). A run that failed after it started stops the window with the
// reason.
function endRun(ctx, result, run, curDes) {
    if (result.stopReason === 'stopped') return;
    if (!result.completed) {
        const text = FAILURE_TEXT[result.stopReason](ctx.ts, result);
        if (run.started) ctx.stopOpt(text); else ctx.setStatusMsg(text);
        return;
    }
    showBest(ctx, result, curDes);
    ctx.saveCache();
    ctx.runningRef.current = false;
    ctx.runOpenRef.current = false;
    ctx.setRunning(false);
    ctx.setTemp(null);
    ctx.setCanReset(true);
    ctx.setStatusMsg(END_TEXT[result.stopReason](ctx.ts, result));
}

/**
 * Starts a run on the design on screen, or, after a Stop with nothing edited
 * since, on the design the open run block started from. Returns a promise that
 * settles once the run's end is shown. A run the window has let go of (ctx.activeRunRef no
 * longer holds it, after Stop, Reset, Best, Restore, a design switch or closing
 * the window) shows nothing more.
 */
export function startWindowRun(ctx) {
    if (ctx.runningRef.current) return Promise.resolve();
    ctx.reconcileBaseWithEdits();
    const curDes = ctx.baseDesignRef.current || ctx.designRef.current;
    if (!curDes) return Promise.resolve();
    const token = {};
    const controller = new AbortController();
    ctx.activeRunRef.current = token;
    ctx.abortRef.current = controller;
    const isCurrent = () => ctx.activeRunRef.current === token;
    const run = { started: false };
    const clock = { last: 0 };
    const hooks = {
        signal: controller.signal,
        makeWorker: ctx.makeWorker || newWorker,
        onStart: () => {
            if (!isCurrent()) return;
            run.started = true;
            openBlock(ctx, curDes);
            ctx.runningRef.current = true;
            ctx.setRunning(true);
            ctx.setIter(0);
            ctx.setReheats(0);
        },
        onProgress: patch => { if (isCurrent()) showProgress(ctx, patch, clock); },
        onRow: row => { if (isCurrent()) recordRow(ctx, row); },
    };
    const release = () => {
        if (!isCurrent()) return;
        ctx.activeRunRef.current = null;
        ctx.abortRef.current = null;
    };
    let promise;
    try {
        promise = runStructural(curDes, ctx.operandsRef.current || [], settingsOf(ctx, curDes), hooks);
    } catch (err) {
        promise = Promise.reject(err);
    }
    return promise
        .then(result => { if (isCurrent()) endRun(ctx, result, run, curDes); })
        .catch(err => {
            console.error('[Structural] the run failed:', err);
            if (!isCurrent()) return;
            const text = String(err && err.message || err);
            if (run.started) ctx.stopOpt(text); else ctx.setStatusMsg(text);
        })
        .finally(release);
}
