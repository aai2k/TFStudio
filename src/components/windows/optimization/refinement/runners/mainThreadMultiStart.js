// Multi-start animation loop for the main-thread refinement fallback (see
// mainThread.js). A module-scope stepper driven off a run-state object `M` so no
// giant nested closure builds up — split into its own file so mainThread.js's
// dispatch/single-start code and this restart loop don't compound into one
// high-complexity file.

import { DLSOptimizer, mirrorLayers } from '../../../../../utils/physics/optimizer.js';
import { resolveMat } from '../refinementUtils.js';

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

export function msRunOne(ctx, M) {
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
