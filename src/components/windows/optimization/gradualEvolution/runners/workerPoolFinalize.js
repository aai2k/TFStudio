// Run finalization for the worker-pool Gradual-Evolution engine: merit-aware
// layer consolidation on the best design, then committing it and tearing down
// the pool. See workerPool.js.

import { getSynthesisConsolidate, getSynthesisConsolidateTol } from '../../../../../utils/synthesis/synthesisConfig.js';
import { setCached } from '../geCache.js';
import { alive, onTick, designSnap, deep, recordCycle, applyDesignPatch } from './workerPoolCore.js';

// Merit-aware consolidation on the BEST design before committing (Macleod,
// "Automatic Design": needle/GE thin+redundant layers "must then be processed to
// remove them"). Trial-deletes each layer and re-refines on the worker; keeps
// deletions that don't worsen MF beyond `tol`. No-op when disabled, when best is
// ≤1 layer, or if the pool was already torn down. Updates `best` in place and
// records a 'clean' row.
export async function consolidateBest(ctx, S) {
    const total = (S.best.frontLayers?.length || 0) + (S.best.backLayers?.length || 0);
    if (!getSynthesisConsolidate() || ctx.workerRef.current !== S.workerPool || total <= 1) return;
    ctx.setPhase('refining');
    ctx.setStatusMsg('Consolidating layers…');
    let res;
    try {
        res = await S.workerPool.run({
            type: 'removePass', operands: S.operands,
            design: designSnap(S, S.best.frontLayers, S.best.backLayers),
            materials: S.materials, dMin: S.dMin, side: S.scanSides[0], engine: S.innerEngine,
            tol: getSynthesisConsolidateTol(), minLayers: 1, maxIter: S.dlsIter,
        }, (m) => onTick(ctx, S, 0, m));   // run() calls onProgress(m); onTick expects (i, m)
    } catch (_) { return; }                // pool terminated / errored → skip silently
    if (!alive(ctx, S) || !res || (res.removed || 0) <= 0) return;   // torn down, no result, or nothing redundant
    S.best.mf = res.mf;
    S.best.frontLayers = deep(res.frontLayers || S.best.frontLayers);
    S.best.backLayers  = deep(res.backLayers  || S.best.backLayers);
    S.work.mf = res.mf;
    S.work.frontLayers = deep(S.best.frontLayers);
    S.work.backLayers  = deep(S.best.backLayers);
    const cleanSide = S.scanSides[0];
    const activeLayers = cleanSide === 'back' ? S.best.backLayers : S.best.frontLayers;
    recordCycle(ctx, S, { type: 'clean', mf: res.mf, layerCount: res.nLayers, insertMat: null, side: cleanSide, activeLayers, omf: res.omf });
    console.log(`[GE] Consolidate: removed ${res.removed} layer(s), ${res.baseLayers}→${res.nLayers}, MF ${res.baseMf?.toFixed?.(6)} → ${res.mf.toFixed(6)}`);
}

export async function finalize(ctx, S, reason) {
    if (ctx.workerRef.current !== S.workerPool) return;
    await consolidateBest(ctx, S);
    if (ctx.workerRef.current !== S.workerPool) return;   // stopped during consolidation
    if (S.best.frontLayers || S.best.backLayers) {
        applyDesignPatch(ctx, S, S.best.frontLayers, S.best.backLayers);
        ctx.setMfBest(S.best.mf);
        const totalLayers =
            (S.best.frontLayers ? S.best.frontLayers.length : 0) +
            (S.best.backLayers  ? S.best.backLayers.length  : 0);
        ctx.setLayerCount(totalLayers);
    }
    setCached(ctx.designRef.current?.id, {
        cycles: ctx.cyclesRef.current, geSteps: S.geSteps,
        savedDesign: ctx.savedDesignRef.current, baseDesign: ctx.baseDesignRef.current,
    });
    ctx.runningRef.current = false;
    ctx.setPhase('idle');
    ctx.setStatusMsg(reason || '');
    ctx.setCanReset(true);
    try { S.workerPool.terminate(); } catch (_) {}
    if (ctx.workerRef.current === S.workerPool) ctx.workerRef.current = null;
}
