// Main-thread refinement fallback. Used only if the Web Worker fails to
// construct or errors before producing any progress (e.g. a future Electron that
// blocks module workers from file://). Functionally identical to the worker
// path, but it blocks the UI thread — so it is the fallback, not the default.
//
// Like every runner in this folder it is a plain function of an explicit `ctx`
// bag assembled by the Refinement component (refs, state setters, cache helpers,
// and the locale table `t`) rather than a closure over component scope. The two
// animation loops (multi-start and single-start) are module-scope steppers driven
// off a run-state object so no giant nested closure builds up.

import { DLSOptimizer, mirrorLayers } from '../../../../../utils/physics/optimizer.js';
import { resolveMat, densifyForRun } from '../refinementUtils.js';

const D_MIN = 1.0, D_MAX = 2000.0;
// Steps run per animation tick before touching React state / live preview. The
// DLS step itself is cheap; the per-iteration cost is the panel re-render +
// global-design update (which replots the whole spectrum). Batching amortizes
// that ~UI_BATCH×. Pure UI throttle — the optimizer math is untouched.
const UI_BATCH = 25;

// Unlocked-layer perturbation for a multi-start restart (locked layers kept).
function perturbLayers(layers, pct) {
    return layers.map(l => {
        if (l.locked) return { ...l };
        const base = l.thickness || 0;
        const factor = 1 + pct * (Math.random() * 2 - 1);
        let tt = base * factor;
        if (tt < D_MIN) tt = D_MIN;
        if (tt > D_MAX) tt = D_MAX;
        return { ...l, thickness: tt };
    });
}

// Whether the surface mode exposes optimization variables for multi-start.
function multiEligible(surfMode, hasFront, hasBack) {
    if (surfMode === 'back_only') return hasBack;
    if (surfMode === 'both_independent') return hasFront || hasBack;
    return hasFront;
}

// Map an optimization vector back to design.frontLayers / backLayers given the
// surfaceMode and baselines (M.surfMode / M.baselineFront / M.baselineBack).
function applyVecToDesign(M, d, vec) {
    const { surfMode, baselineFront, baselineBack } = M;
    if (surfMode === 'both_independent') {
        const nFront = baselineFront.length;
        const frontT = vec.slice(0, nFront);
        const backT  = vec.slice(nFront);
        return {
            ...d,
            frontLayers: baselineFront.map((l, i) => ({ ...l, thickness: frontT[i] ?? l.thickness })),
            backLayers:  baselineBack .map((l, i) => ({ ...l, thickness: backT [i] ?? l.thickness })),
        };
    }
    if (surfMode === 'symmetric') {
        const front = baselineFront.map((l, i) => ({ ...l, thickness: vec[i] ?? l.thickness }));
        return { ...d, frontLayers: front, backLayers: mirrorLayers(front) };
    }
    if (surfMode === 'back_only') {
        return { ...d, backLayers: baselineBack.map((l, i) => ({ ...l, thickness: vec[i] ?? l.thickness })) };
    }
    return { ...d, frontLayers: baselineFront.map((l, i) => ({ ...l, thickness: vec[i] ?? l.thickness })) };
}

// Perturbed design for the next restart, perturbing only the stack(s) the
// surface mode marks as optimization variables.
function perturbedDesignFor(M) {
    const { surfMode, baselineFront, baselineBack, pct, curDes } = M;
    if (surfMode === 'both_independent')
        return { ...curDes, frontLayers: perturbLayers(baselineFront, pct), backLayers: perturbLayers(baselineBack, pct) };
    if (surfMode === 'back_only')
        return { ...curDes, frontLayers: baselineFront, backLayers: perturbLayers(baselineBack, pct) };
    if (surfMode === 'symmetric') {
        const front = perturbLayers(baselineFront, pct);
        return { ...curDes, frontLayers: front, backLayers: mirrorLayers(front) };
    }
    return { ...curDes, frontLayers: perturbLayers(baselineFront, pct) };
}

// ── Multi-start loop (module-scope stepper over run-state M) ───────────────────
function msFinish(ctx, M) {
    ctx.runningRef.current = false;
    ctx.setRunning(false);
    ctx.setRestartIdx(0);
    if (M.globalBestThicks) {
        const finalDesign = applyVecToDesign(M, M.curDes, M.globalBestThicks);
        ctx.updateDesignRef.current({
            frontLayers: finalDesign.frontLayers,
            backLayers:  finalDesign.backLayers,
        }, { transient: true });
        const layerSide = M.surfMode === 'back_only' ? 'backLayers' : 'frontLayers';
        // Synthetic optimizer-like ref so Best/Reset still work.
        ctx.optimizerRef.current = {
            iter: M.totalIter,
            mf: M.globalBestMF, mfBest: M.globalBestMF,
            thickBest: M.globalBestThicks, layerSide,
            applyToDesign: (d) => applyVecToDesign(M, d, M.globalBestThicks),
            restoreBest: () => {},
        };
        const histLayers = M.surfMode === 'back_only' ? finalDesign.backLayers : finalDesign.frontLayers;
        ctx.addHistEntry({
            id: Math.random().toString(36).slice(2),
            label: M.runLabel + ` (×${M.N})`,
            iter:  M.totalIter,
            mf:    M.globalBestMF,
            omf:   M.globalBestOMF,
            layers: histLayers,
            layerCount: histLayers.length,
            layerSide,
        });
    }
    console.log(`[Multi-start] Done: ${M.N} restarts, best MF=${M.globalBestMF.toFixed(6)} (mode=${M.surfMode})`);
}

function msTickInner(ctx, M, opt) {
    if (!ctx.runningRef.current) return;
    let done = false;
    for (let b = 0; b < UI_BATCH; b++) {
        opt.step();
        M.totalIter += 1;
        if (opt.isConverged() || opt.iter >= M.maxIter) { done = true; break; }
    }
    ctx.setIter(M.totalIter);
    ctx.setMf(opt.mf);
    ctx.setOmf(opt.mfOpticalAt(opt.thicknesses));
    ctx.setMfHistory(prev => [...prev, { iter: M.totalIter, mf: opt.mf }]);

    // Live preview — applyToDesign already honors surfaceMode.
    const updated = opt.applyToDesign(ctx.designRef.current);
    ctx.updateDesignRef.current({
        frontLayers: updated.frontLayers,
        backLayers:  updated.backLayers,
    }, { transient: true });

    if (done) {
        if (opt.mfBest < M.globalBestMF) {
            M.globalBestMF     = opt.mfBest;
            M.globalBestThicks = [...opt.thickBest];
            M.globalBestOMF    = opt.mfOpticalAt(opt.thickBest);
            ctx.setMfBest(M.globalBestMF);
            ctx.setOmfBest(M.globalBestOMF);
        }
        console.log(`[Multi-start ${M.restart}/${M.N}] iter=${opt.iter} MF=${opt.mfBest.toFixed(6)} (global best=${M.globalBestMF.toFixed(6)})`);
        ctx.timerRef.current = setTimeout(() => msRunOne(ctx, M), 0);
        return;
    }
    ctx.timerRef.current = setTimeout(() => msTickInner(ctx, M, opt), 0);
}

function msRunOne(ctx, M) {
    if (!ctx.runningRef.current) return;
    if (M.restart >= M.N) { msFinish(ctx, M); return; }

    M.restart += 1;
    ctx.setRestartIdx(M.restart);

    let opt;
    try {
        opt = new DLSOptimizer(M.ops, perturbedDesignFor(M), resolveMat);
    } catch (err) {
        console.error(`[Multi-start ${M.restart}/${M.N}] init failed:`, err);
        ctx.timerRef.current = setTimeout(() => msRunOne(ctx, M), 0);
        return;
    }
    ctx.optimizerRef.current = opt;
    msTickInner(ctx, M, opt);
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
