// Final application and Design History recording for the DLS worker pool.

import { endReasonFor } from '../refinementUtils.js';

export function finalizeDlsRun(ctx, S) {
    if (S.finished) return;
    S.finished = true;
    ctx.runningRef.current = false;
    ctx.setRunning(false);
    ctx.setRestartIdx(0);
    const best = ctx.lastBestRef.current;
    if (best) {
        ctx.updateDesignRef.current(
            { frontLayers: best.frontLayers, backLayers: best.backLayers }, { transient: true });
        const layers = S.layerSide === 'backLayers' ? best.backLayers : best.frontLayers;
        ctx.addHistEntry({
            id: Math.random().toString(36).slice(2),
            label: S.isMulti ? `${S.runLabel} (×${S.N})` : ctx.t.refinement.methods.dls,
            iter: S.cumIter, omf: best.omf, mf: best.mfBest, layers,
            layerCount: (layers || []).length, layerSide: S.layerSide,
            mfHistory: [...S.mfHistory],
            ...(S.seed != null ? { seed: S.seed } : {}),
        });
        // A single run reports how it ended; a multi-start ends when its last
        // restart does, which says nothing about the others.
        if (!S.isMulti) ctx.setStopReason(endReasonFor(best.mfBest, S.lastReason));
        logCompletion(S, best.mfBest);
    }
    ctx.killWorker();
}

function logCompletion(S, mf) {
    if (S.isMulti)
        console.log(`[Multi-start pool] Done: ${S.N} restarts on ${S.K} workers, best MF=${mf.toFixed(6)} (mode=${S.surfMode}, seed ${S.seed})`);
    else
        console.log(`[DLS] done: best MF=${mf.toFixed(6)} (${S.lastReason})`);
}
