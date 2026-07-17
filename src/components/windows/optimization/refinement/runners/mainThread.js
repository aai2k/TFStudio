// Main-thread refinement fallback. Used only if the Web Worker fails to
// construct or errors before producing any progress (e.g. a future Electron that
// blocks module workers from file://). Functionally identical to the worker
// path, but it blocks the UI thread — so it is the fallback, not the default.
//
// Like every runner in this folder it is a plain function of an explicit `ctx`
// bag assembled by the Refinement component (refs, state setters, cache helpers,
// and the locale table `t`) rather than a closure over component scope. The
// multi-start restart loop lives in mainThreadMultiStart.js; this file keeps the
// dispatch and the (simpler) single-start loop.

import { DLSOptimizer } from '../../../../../utils/physics/optimizer.js';
import { resolveMat, densifyForRun } from '../refinementUtils.js';
import { msRunOne } from './mainThreadMultiStart.js';

// Steps run per animation tick before touching React state / live preview. The
// DLS step itself is cheap; the per-iteration cost is the panel re-render +
// global-design update (which replots the whole spectrum). Batching amortizes
// that ~UI_BATCH×. Pure UI throttle — the optimizer math is untouched.
const UI_BATCH = 25;

// Whether the surface mode exposes optimization variables for multi-start.
function multiEligible(surfMode, hasFront, hasBack) {
    if (surfMode === 'back_only') return hasBack;
    if (surfMode === 'both_independent') return hasFront || hasBack;
    return hasFront;
}

function startMultiStart(ctx, curDes, ops, maxIter, surfMode) {
    const N   = Math.max(1, Math.floor(ctx.nRestartsRef.current));
    const pct = Math.max(0, ctx.perturbPctRef.current) / 100;

    // One undo checkpoint for the whole run, then save the Reset baseline.
    ctx.checkpointRef.current && ctx.checkpointRef.current();
    ctx.commitBaseline({ frontLayers: curDes.frontLayers, backLayers: curDes.backLayers });
    const baselineFront = JSON.parse(JSON.stringify(curDes.frontLayers || []));
    const baselineBack  = JSON.parse(JSON.stringify(curDes.backLayers  || []));

    // Baseline MF + optimization vector: the unperturbed start seeds the global
    // best (M7) so a perturbed restart is adopted only if it actually beats it.
    let mfInit = null, baselineThicks = null, baselineOmf = null;
    try {
        const baseOpt = new DLSOptimizer(ops, curDes, resolveMat);
        mfInit = baseOpt.mf;
        baselineThicks = [...baseOpt.thicknesses];
        baselineOmf = baseOpt.mfOpticalAt(baseOpt.thicknesses);
        ctx.setMfInitial(mfInit);
        ctx.setOmfInitial(baselineOmf);
    } catch (err) {
        console.error('[Multi-start] Initial eval failed:', err);
        return;
    }

    ctx.bumpRunCount();
    ctx.runningRef.current = true;
    ctx.setRunning(true);
    ctx.setCanReset(true);
    ctx.setMfHistory([]);
    ctx.setMfBest(null);
    ctx.setOmfBest(null);
    ctx.setRestartIdx(0);

    const M = {
        curDes, ops, maxIter, N, pct, surfMode, baselineFront, baselineBack,
        runLabel: ctx.t.refinement.history.run(ctx.histRunCount.current),
        globalBestMF: mfInit ?? Infinity,
        globalBestOMF: baselineOmf,
        globalBestThicks: baselineThicks,
        restart: 0, totalIter: 0,
    };
    msRunOne(ctx, M);
}

// ── Single-start loop ─────────────────────────────────────────────────────────
function ssTick(ctx, maxIter) {
    if (!ctx.runningRef.current) return;
    const opt = ctx.optimizerRef.current;
    if (!opt) return;

    let done = false;
    for (let b = 0; b < UI_BATCH; b++) {
        opt.step();
        if (opt.isConverged() || opt.iter >= maxIter) { done = true; break; }
    }

    ctx.setIter(opt.iter);
    ctx.setMf(opt.mf);
    ctx.setOmf(opt.mfOpticalAt(opt.thicknesses));
    ctx.setOmfBest(opt.mfOpticalAt(opt.thickBest));
    // opt.mfBest is monotone non-increasing; show it directly.
    ctx.setMfBest(opt.mfBest);
    ctx.setMfHistory(prev => [...prev, { iter: opt.iter, mf: opt.mf }]);

    const updated = opt.applyToDesign(ctx.designRef.current);
    ctx.updateDesignRef.current({
        frontLayers: updated.frontLayers,
        backLayers:  updated.backLayers,
    }, { transient: true });

    if (done) {
        console.log(`[DLS] Converged: iter=${opt.iter} MF=${opt.mf.toFixed(6)} lamD=${opt.lamD.toExponential(2)}`);
        ctx.runningRef.current = false;
        ctx.setRunning(false);
        return;
    }
    ctx.timerRef.current = setTimeout(() => ssTick(ctx, maxIter), 0);
}

function startSingleStart(ctx, curDes, ops, maxIter) {
    // Create optimizer if not already running a session.
    if (!ctx.optimizerRef.current) {
        ctx.checkpointRef.current && ctx.checkpointRef.current();
        ctx.commitBaseline({ frontLayers: curDes.frontLayers, backLayers: curDes.backLayers });
        try {
            const opt = new DLSOptimizer(ops, curDes, resolveMat);
            ctx.optimizerRef.current = opt;
            ctx.setMfInitial(opt.mf);
            ctx.setMfBest(opt.mfBest);
            ctx.setOmfInitial(opt.mfOpticalAt(opt.thicknesses));
            ctx.setOmfBest(opt.mfOpticalAt(opt.thickBest));
            ctx.bumpRunCount();
        } catch (err) {
            console.error('[DLS] Failed to create optimizer:', err);
            return;
        }
    }

    ctx.runningRef.current = true;
    ctx.setRunning(true);
    ctx.setCanReset(true);
    ctx.timerRef.current = setTimeout(() => ssTick(ctx, maxIter), 0);
}

export function runOptMainThread(ctx) {
    const { runningRef, designRef, operandsRef, maxIterRef, multiStartRef } = ctx;
    if (runningRef.current) return;

    const curDes = designRef.current;
    const ops    = densifyForRun(operandsRef.current.filter(op => op.enabled), curDes);
    if (!curDes || ops.length === 0) return;

    const maxIter  = maxIterRef.current || 500;
    const surfMode = curDes.surfaceMode || 'front_only';
    const eligible = multiEligible(surfMode, (curDes.frontLayers || []).length > 0, (curDes.backLayers || []).length > 0);

    if (multiStartRef.current && eligible) startMultiStart(ctx, curDes, ops, maxIter, surfMode);
    else startSingleStart(ctx, curDes, ops, maxIter);
}
