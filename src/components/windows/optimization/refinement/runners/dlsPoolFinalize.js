// Final application and Design History recording for the DLS worker pool.

import { METHOD_LABELS } from '../refinementConfig.js';

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
            label: S.isMulti ? `${S.runLabel} (×${S.N})` : METHOD_LABELS.dls,
            iter: S.cumIter, omf: best.omf, mf: best.mfBest, layers,
            layerCount: (layers || []).length, layerSide: S.layerSide,
            mfHistory: [...S.mfHistory],
        });
        logCompletion(S, best.mfBest);
    }
    ctx.killWorker();
}

function logCompletion(S, mf) {
    if (S.isMulti)
        console.log(`[Multi-start pool] Done: ${S.N} restarts on ${S.K} workers, best MF=${mf.toFixed(6)} (mode=${S.surfMode})`);
    else
        console.log(`[DLS] done: best MF=${mf.toFixed(6)}`);
}
