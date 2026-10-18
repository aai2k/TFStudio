// The end of a Gradual Evolution run that ended on its own: merit-aware layer
// consolidation on the best design, then the run's answer.

import { deep, designSnap, recordCycle } from './core.js';
import { alive } from './runState.js';

// Merit-aware consolidation on the BEST design before the run ends (Macleod,
// "Automatic Design": needle/GE thin+redundant layers "must then be processed
// to remove them"). Trial-deletes each layer and re-refines on the worker;
// keeps deletions that don't worsen MF beyond `consolidateTol`. No-op when
// disabled, when best is ≤1 layer, or if the run was stopped. Updates `best`
// in place and records a 'clean' row.
async function consolidateBest(S) {
    const total = (S.best.frontLayers?.length || 0) + (S.best.backLayers?.length || 0);
    if (!S.consolidate || !alive(S) || total <= 1) return;
    S.emit({ phase: 'refining', activity: { id: 'consolidating' } });
    let res;
    try {
        res = await S.workerPool.run({
            type: 'removePass', operands: S.operands,
            design: designSnap(S, S.best.frontLayers, S.best.backLayers),
            materials: S.materials, dMin: S.dMin, side: S.scanSides[0], engine: S.innerEngine,
            tol: S.consolidateTol, minLayers: 1, maxIter: S.dlsIter,
        }, (m) => S.onTick(0, m));
    } catch (_) { return; }                // pool terminated / errored → skip silently
    if (!alive(S) || !res || (res.removed || 0) <= 0) return;   // stopped, no result, or nothing redundant
    S.best.mf = res.mf;
    S.best.frontLayers = deep(res.frontLayers || S.best.frontLayers);
    S.best.backLayers  = deep(res.backLayers  || S.best.backLayers);
    S.work.mf = res.mf;
    S.work.frontLayers = deep(S.best.frontLayers);
    S.work.backLayers  = deep(S.best.backLayers);
    const cleanSide = S.scanSides[0];
    const activeLayers = cleanSide === 'back' ? S.best.backLayers : S.best.frontLayers;
    recordCycle(S, { type: 'clean', mf: res.mf, layerCount: res.nLayers, insertMat: null, side: cleanSide, activeLayers, omf: res.omf });
    console.log(`[GE] Consolidate: removed ${res.removed} layer(s), ${res.baseLayers}→${res.nLayers}, MF ${res.baseMf?.toFixed?.(6)} → ${res.mf.toFixed(6)}`);
}

/**
 * The run ended on its own with `end` ({ stopReason, stopMF? }): consolidate
 * the best design, then return the run's result, or null when the run was
 * stopped meanwhile.
 */
export async function finish(S, end) {
    await consolidateBest(S);
    if (!alive(S)) return null;
    const { best } = S;
    return {
        completed: true, ...end,
        mf: best.mf, frontLayers: best.frontLayers, backLayers: best.backLayers,
        geSteps: S.geSteps,
    };
}
