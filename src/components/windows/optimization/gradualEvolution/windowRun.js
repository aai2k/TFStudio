// Starts a Gradual Evolution run for the Gradual Evolution window and shows
// it. The window's fields become the run's settings; what the run reports
// lands on the readout, the live design, the history and the status line. Run
// blocks (synthesisShared/runBlocks.js) are the window's: a Run press opens one
// unless a Stop left one open, and Reset undoes one.
//
// A plain function of the `ctx` bag useGradualEvolution.js builds: its refs,
// state setters, worker pool factory and the locale table `t`.

import { runGradualEvolution } from '../../../../utils/gradualEvolution/runGradualEvolution.js';
import {
    getSynthesisInnerEngine, getSynthesisCandMode, getNeedleSensMode, getSynthesisSmartSeed,
    getSynthesisSeedMode, getSynthesisConsolidate, getSynthesisConsolidateTol, getThreadCount,
} from '../../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../../tmmcore.js';
import { minOmfOf } from '../synthesisShared/synthesisMath.js';
import { activeBaseline, activeRunNum, openRunBlock } from '../synthesisShared/runBlocks.js';
import { cacheRun } from './geStateHelpers.js';

// Live preview: a worker's in-flight design is shown at most this often, in ms.
const LIVE_EVERY_MS = 90;

const deep = x => JSON.parse(JSON.stringify(x));

const ACTIVITY_TEXT = {
    smartSeeding:       (tg, a) => tg.smartSeeding(a.count),
    seedKeptBulk:       (tg) => tg.status.seedKeptBulk,
    seedRefining:       (tg) => tg.status.seedRefining,
    scanning:           (tg, a) => (a.side ? tg.status.scanningSide(a.side) : tg.status.scanning),
    refiningCandidates: (tg, a) => tg.status.refiningCandidates(a.count, a.side),
    geScanning:         (tg) => tg.status.geScanning,
    freeing:            (tg) => tg.status.freeing,
    perturbing:         (tg) => tg.status.perturbing,
    consolidating:      (tg) => tg.status.consolidating,
};

// The status line a run that ended without an answer leaves.
const FAILURE_TEXT = {
    noOperands:      (tg) => tg.noOperands,
    noMaterials:     (tg) => tg.noMaterials,
    presampleFailed: (tg) => tg.status.presampleFailed,
    workerFailed:    (tg) => tg.status.workerFailed,
    workerError:     (tg, result) => result.message,
};

// The status line a run that ended on its own leaves.
const END_TEXT = {
    target:      (tg, result) => tg.status.targetMet(result.stopMF),
    maxGeCycles: (tg, result, settings) => tg.status.maxGeCycles(settings.maxGeCycles),
    stuck:       (tg) => tg.status.stuck,
};

function wasmInit() {
    const wasmBytes = getTmmWasmBytesForWorker();
    return wasmBytes ? { type: 'wasmInit', wasmBytes } : null;
}

// The history a press carries on: the run block a Stop left open, numbered on
// from it, with its GE-step count. A press that opens a new block starts at
// generation 1 with a budget of its own. ΔMF is measured from the best of
// every run, and time runs on from the last.
function historyOf(ctx) {
    const cycles = ctx.cyclesRef.current;
    const newBlock = !ctx.runOpenRef.current;
    return {
        genNum: newBlock ? 0 : ctx.genCountRef.current,
        geSteps: newBlock ? 0 : ctx.geStepsRef.current,
        bestMF: cycles.length ? Math.min(...cycles.map(c => c.mf)) : Infinity,
        elapsedMs: cycles.length ? (cycles[cycles.length - 1].tMs || 0) : 0,
        hasRows: cycles.length > 0,
    };
}

function settingsOf(ctx) {
    return {
        pool: ctx.getPoolMaterials(ctx.selectedCatsRef.current, ctx.excludedMatsRef.current),
        maxLayers: ctx.maxLayersRef.current,
        maxGeCycles: ctx.maxGeCyclesRef.current,
        targetMF: ctx.targetMFRef.current,
        refineIter: ctx.dlsIterRef.current,
        dMin: ctx.dMinRef.current,
        deepSearch: ctx.deepSearchRef.current,
        innerEngine: getSynthesisInnerEngine('ge'),
        candidateSearch: getSynthesisCandMode(),
        sensitivity: getNeedleSensMode(),
        smartSeed: getSynthesisSmartSeed('ge'),
        seedMode: getSynthesisSeedMode(),
        consolidate: getSynthesisConsolidate(),
        consolidateTol: getSynthesisConsolidateTol(),
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
    ctx.baseDesignRef.current  = curDes;
    // Generations are numbered within their run, so a new block starts at 1,
    // and the GE-step budget is the new run's own.
    ctx.genCountRef.current = 0;
    ctx.geStepsRef.current  = 0;
    ctx.setGeSteps(0);
    ctx.runOpenRef.current     = true;
    ctx.setCanReset(true);
}

// Show both sides of `layers`; with `asBase` they are also the design the next
// Run press goes on from.
function showDesign(ctx, layers, asBase) {
    const patch = {};
    if (layers.frontLayers) patch.frontLayers = deep(layers.frontLayers);
    if (layers.backLayers)  patch.backLayers  = deep(layers.backLayers);
    ctx.updateDesignRef.current(patch, { transient: true });
    if (asBase) ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
}

// A worker's in-flight design, at most every LIVE_EVERY_MS.
function showLive(ctx, live, clock) {
    const now = Date.now();
    if (now - clock.last < LIVE_EVERY_MS) return;
    clock.last = now;
    if (live.mf != null) ctx.setMf(live.mf);
    if (live.omf != null) ctx.setOmf(live.omf);
    if (!live.frontLayers && !live.backLayers) return;
    showDesign(ctx, live, false);
    if (live.layers) ctx.setLayerCount(live.layers.length);
}

// The readout values a report may carry, and the setter that shows each.
const READOUT = [
    ['mf', 'setMf'], ['mfBest', 'setMfBest'], ['omf', 'setOmf'], ['omfBest', 'setOmfBest'], ['layerCount', 'setLayerCount'],
];

function showProgress(ctx, patch, clock) {
    const tg = ctx.t.gradualEvolution;
    if ('phase' in patch) ctx.setPhase(patch.phase);
    if ('activity' in patch) ctx.setStatusMsg(patch.activity ? ACTIVITY_TEXT[patch.activity.id](tg, patch.activity) : '');
    if (patch.design) showDesign(ctx, patch.design, true);
    for (const [key, setter] of READOUT) if (key in patch) ctx[setter](patch[key]);
    if ('geSteps' in patch) { ctx.geStepsRef.current = patch.geSteps; ctx.setGeSteps(patch.geSteps); }
    if (patch.live) showLive(ctx, patch.live, clock);
}

// A history row the run reports, new or its last one refined further, with the
// readout that goes with it.
function recordRow(ctx, row, info) {
    const gen = { ...row, runNum: activeRunNum(ctx.runsRef.current) };
    const cycles = ctx.cyclesRef.current;
    if (info.replacesLast) {
        ctx.cyclesRef.current = [...cycles.slice(0, -1), gen];
    } else {
        ctx.cyclesRef.current = [...cycles, gen];
        ctx.genCountRef.current = row.genNum;
        ctx.setGeneration(row.genNum);
    }
    ctx.setCycles(ctx.cyclesRef.current.slice());
    ctx.setLayerCount(info.layerCount);
    ctx.setMfBest(info.mfBest);
    if (info.omf != null) ctx.setOmf(info.omf);
    ctx.setOmfBest(minOmfOf(ctx.cyclesRef.current));
    cacheRun(ctx);
}

// The run is over. One that ended on its own shows its best design and closes
// its run block, so the next Run press opens a new one; a Stop leaves the block
// open (stopOpt). A run that failed after it started stops the window with the
// reason.
function endRun(ctx, result, run) {
    if (result.stopReason === 'stopped') return;
    const tg = ctx.t.gradualEvolution;
    if (!result.completed) {
        const text = FAILURE_TEXT[result.stopReason](tg, result);
        if (run.started) ctx.stopOpt(text); else ctx.setStatusMsg(text);
        return;
    }
    showDesign(ctx, result, true);
    ctx.setMfBest(result.mf);
    ctx.setLayerCount(result.frontLayers.length + result.backLayers.length);
    cacheRun(ctx);
    ctx.runningRef.current = false;
    ctx.runOpenRef.current = false;
    ctx.setPhase('idle');
    ctx.setStatusMsg(END_TEXT[result.stopReason](tg, result, run.settings));
    ctx.setCanReset(true);
}

/**
 * Starts a run on the design on screen, or on the design a Stop left the run
 * at when nothing was edited since. Returns a promise that settles once the
 * run's end is shown. A run the window has let go of (ctx.activeRunRef no
 * longer holds it, after Stop, Reset, Best, Restore, a design switch or closing
 * the window) shows nothing more.
 */
export function startWindowRun(ctx) {
    if (ctx.runningRef.current) return Promise.resolve();
    ctx.reconcileBaseWithEdits();
    const curDes = ctx.baseDesignRef.current || ctx.designRef.current;
    const token = {};
    const controller = new AbortController();
    ctx.activeRunRef.current = token;
    ctx.abortRef.current = controller;
    const isCurrent = () => ctx.activeRunRef.current === token;
    const run = { settings: null, started: false };
    const clock = { last: 0 };
    const hooks = {
        signal: controller.signal,
        makeWorkerPool: size => ctx.makeWorkerPool(size, wasmInit()),
        onStart: () => {
            if (!isCurrent()) return;
            run.started = true;
            openBlock(ctx, curDes);
            ctx.runningRef.current = true;
        },
        onProgress: patch => { if (isCurrent()) showProgress(ctx, patch, clock); },
        onRow: (row, info) => { if (isCurrent()) recordRow(ctx, row, info); },
    };
    const release = () => {
        if (!isCurrent()) return;
        ctx.activeRunRef.current = null;
        ctx.abortRef.current = null;
    };
    let promise;
    try {
        run.settings = settingsOf(ctx);
        promise = runGradualEvolution(curDes, ctx.operandsRef.current || [], run.settings, hooks);
    } catch (err) {
        promise = Promise.reject(err);
    }
    return promise
        .then(result => { if (isCurrent()) endRun(ctx, result, run); })
        .catch(err => {
            console.error('[GE] the run failed:', err);
            if (!isCurrent()) return;
            const text = String(err && err.message || err);
            if (run.started) ctx.stopOpt(text); else ctx.setStatusMsg(text);
        })
        .finally(release);
}
