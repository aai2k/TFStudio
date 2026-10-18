// Starts a Needle Automatic run for the Needle window and shows it. The
// window's fields become the run's settings; what the run reports lands on the
// readout, the live design, the generation history, Top Designs and the status
// line. Run blocks (synthesisShared/runBlocks.js) are the window's: a Run press
// opens one unless a Stop left one open, and Reset undoes one.
//
// A plain function of the `ctx` bag useNeedleVariation.js builds
// (buildEngineCtx): its refs, state setters, cache helpers, worker pool factory
// and the locale table `t`.

import { runNeedle } from '../../../../utils/needle/runNeedle.js';
import {
    getSynthesisInnerEngine, getSynthesisCandMode, getNeedleSensMode, getSynthesisSmartSeed, getThreadCount,
} from '../../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../../tmmcore.js';
import { activeSide, computePareto, minOmfOf } from '../synthesisShared/synthesisMath.js';
import { activeBaseline, activeRunNum, openRunBlock } from '../synthesisShared/runBlocks.js';

// Live preview: a worker's in-flight design is shown at most this often, in ms.
const LIVE_EVERY_MS = 90;

const deep = x => JSON.parse(JSON.stringify(x));

const ACTIVITY_TEXT = {
    scanning:           (tn) => tn.status.scanning,
    refiningCandidates: (tn, a) => tn.status.refiningCandidates(a.count),
    smartSeeding:       (tn, a) => tn.smartSeeding(a.count),
    rescueTrying:       (tn, a) => tn.rescueTrying(a.count),
    rescueApplied:      (tn, a) => tn.rescueApplied(a.factor, Math.round(a.totalNm)),
};

// The status line a run that ended without an answer leaves.
const FAILURE_TEXT = {
    noOperands:      (tn) => tn.noOperands,
    noMaterials:     (tn) => tn.noMaterials,
    presampleFailed: (tn) => tn.status.presampleFailed,
    workerFailed:    (tn) => tn.status.workerFailed,
    workerError:     (tn, result) => result.message,
};

// The status line a run that ended on its own leaves.
const END_TEXT = {
    maxLayers:     (tn, result, settings) => tn.status.maxLayers(settings.maxLayers),
    needleOptimal: (tn) => tn.status.noImprove,
    target:        (tn, result) => tn.status.targetMet(result.stopMF),
};

function wasmInit() {
    const wasmBytes = getTmmWasmBytesForWorker();
    return wasmBytes ? { type: 'wasmInit', wasmBytes } : null;
}

// The generations a press carries on: those of the run block a Stop left open,
// numbered on from it. A press that opens a new block starts at generation 1.
// ΔMF is measured from the best of every run, and time runs on from the last.
function historyOf(ctx) {
    const gens = ctx.gensRef.current;
    const newBlock = !ctx.runOpenRef.current;
    const runNum = activeRunNum(ctx.runsRef.current);
    return {
        genNum: newBlock ? 0 : ctx.genCountRef.current,
        bestMF: gens.length ? Math.min(...gens.map(g => g.mf)) : Infinity,
        elapsedMs: gens.length ? (gens[gens.length - 1].tMs || 0) : 0,
        rows: newBlock ? [] : gens.filter(g => g.runNum === runNum),
    };
}

function settingsOf(ctx) {
    return {
        pool: ctx.getPoolMaterials(ctx.selectedCatsRef.current, ctx.excludedMatsRef.current),
        maxLayers: ctx.maxLayersRef.current,
        targetMF: ctx.targetMFRef.current,
        deltaNm: ctx.deltaNmRef.current,
        dMin: ctx.dMinRef.current,
        refineIter: ctx.dlsIterRef.current,
        innerEngine: getSynthesisInnerEngine('needle'),
        candidateSearch: getSynthesisCandMode(),
        sensitivity: getNeedleSensMode(),
        smartSeed: getSynthesisSmartSeed('needle'),
        threads: getThreadCount(),
        history: historyOf(ctx),
    };
}

// Push the generations and run blocks into the per-design cache, so they
// survive a dock, a tab switch or a reopen.
function cacheRun(ctx) {
    ctx.setCachedOptState(ctx.designRef.current?.id, {
        generations: ctx.gensRef.current,
        runs:        ctx.runsRef.current,
        savedDesign: ctx.savedDesignRef.current,
        baseDesign:  ctx.baseDesignRef.current,
    });
}

// Open a run block for this press, unless one is still open from a Stop:
// pausing to look at something and carrying on stays one run. The block
// records the design the press started from, which is what Reset restores,
// and takes one undo checkpoint for the whole synthesis run.
function openBlock(ctx, curDes) {
    if (ctx.runOpenRef.current) return;
    ctx.checkpointRef.current && ctx.checkpointRef.current();
    ctx.runsRef.current = openRunBlock(ctx.runsRef.current, ctx.designRef.current);
    ctx.savedDesignRef.current = activeBaseline(ctx.runsRef.current);
    ctx.baseDesignRef.current  = curDes;
    // Generations are numbered within their run, so a new block starts at 1.
    ctx.genCountRef.current = 0;
    ctx.runOpenRef.current     = true;
    ctx.setCanReset(true);
}

// Show both sides of `layers` as the design being worked on.
function showDesign(ctx, layers) {
    const patch = {};
    if (layers.frontLayers) patch.frontLayers = deep(layers.frontLayers);
    if (layers.backLayers)  patch.backLayers  = deep(layers.backLayers);
    ctx.updateDesignRef.current(patch, { transient: true });
    return patch;
}

// A worker's in-flight design, at most every LIVE_EVERY_MS.
function showLive(ctx, live, clock) {
    const now = Date.now();
    if (now - clock.last < LIVE_EVERY_MS) return;
    clock.last = now;
    if (live.mf != null) ctx.setMf(live.mf);
    if (live.omf != null) ctx.setOmf(live.omf);
    if (!live.frontLayers && !live.backLayers) return;
    showDesign(ctx, live);
    if (live.layers) ctx.setLayerCount(live.layers.length);
}

function showProgress(ctx, patch, clock) {
    const tn = ctx.t.needle;
    if ('phase' in patch) ctx.setPhase(patch.phase);
    if ('activity' in patch) ctx.setStatusMsg(patch.activity ? ACTIVITY_TEXT[patch.activity.id](tn, patch.activity) : '');
    if (patch.design) showDesign(ctx, patch.design);
    if ('mf' in patch) ctx.setMf(patch.mf);
    if ('mfBest' in patch) ctx.setMfBest(patch.mfBest);
    if ('layerCount' in patch) ctx.setLayerCount(patch.layerCount);
    if (patch.live) showLive(ctx, patch.live, clock);
}

// A row the run reports joins the history and Top Designs.
function addRow(ctx, row) {
    const gen = { id: Math.random().toString(36).slice(2), ...row, runNum: activeRunNum(ctx.runsRef.current) };
    ctx.gensRef.current     = [...ctx.gensRef.current, gen];
    ctx.genCountRef.current = row.genNum;
    ctx.setGenerations(ctx.gensRef.current.slice());
    ctx.setTopDesigns(computePareto(ctx.gensRef.current));
    ctx.setGeneration(row.genNum);
}

// An accepted generation: its design becomes the one worked on, and the
// history, Top Designs, the readout and the cache follow. The closing row of a
// final winner only joins the history; the run's end shows its design
// (showWinner).
function recordRow(ctx, row) {
    if (row.final) { addRow(ctx, row); return; }
    const patch = showDesign(ctx, { frontLayers: row.frontSnap, backLayers: row.backSnap });
    ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
    addRow(ctx, row);
    ctx.setLayerCount(row.layerCount);
    ctx.setMfBest(Math.min(...ctx.gensRef.current.map(g => g.mf)));
    ctx.setOmf(row.omf ?? null);
    ctx.setOmfBest(minOmfOf(ctx.gensRef.current));
    cacheRun(ctx);
}

// The design the run ended on, on screen and in the readout. The layer count
// is the active side's, or both sides' for both_independent.
function showWinner(ctx, result, curDes) {
    const patch = showDesign(ctx, result);
    ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
    ctx.setMf(result.mf);
    ctx.setOmf(result.omf ?? null);
    ctx.setMfBest(Math.min(...ctx.gensRef.current.map(g => g.mf)));
    ctx.setOmfBest(minOmfOf(ctx.gensRef.current));
    const front = result.frontLayers?.length || 0, back = result.backLayers?.length || 0;
    if ((curDes.surfaceMode || 'front_only') === 'both_independent') ctx.setLayerCount(front + back);
    else ctx.setLayerCount(activeSide(curDes) === 'back' ? back : front);
}

// The run is over. One that ended on its own closes its run block, so the next
// Run press opens a new one; a Stop leaves the block open (stopOpt). A run that
// failed after it started stops the window with the reason.
function endRun(ctx, result, run) {
    if (result.stopReason === 'stopped') return;
    const tn = ctx.t.needle;
    if (!result.completed) {
        const text = FAILURE_TEXT[result.stopReason](tn, result);
        if (run.started) ctx.stopOpt(text); else ctx.setStatusMsg(text);
        return;
    }
    if (result.frontLayers || result.backLayers) showWinner(ctx, result, run.curDes);
    cacheRun(ctx);
    ctx.runningRef.current = false;
    ctx.runOpenRef.current = false;
    ctx.setPhase('idle');
    ctx.setStatusMsg(END_TEXT[result.stopReason](tn, result, run.settings));
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
    const run = { curDes, settings: null, started: false };
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
        onGeneration: row => { if (isCurrent()) recordRow(ctx, row); },
    };
    const release = () => {
        if (!isCurrent()) return;
        ctx.activeRunRef.current = null;
        ctx.abortRef.current = null;
    };
    let promise;
    try {
        run.settings = settingsOf(ctx);
        promise = runNeedle(curDes, ctx.operandsRef.current || [], run.settings, hooks);
    } catch (err) {
        promise = Promise.reject(err);
    }
    return promise
        .then(result => { if (isCurrent()) endRun(ctx, result, run); })
        .catch(err => {
            console.error('[Needle] the run failed:', err);
            if (!isCurrent()) return;
            const text = String(err && err.message || err);
            if (run.started) ctx.stopOpt(text); else ctx.setStatusMsg(text);
        })
        .finally(release);
}
