// The state one Gradual Evolution run carries from cycle to cycle.

import { chunkArray, serializableMedia } from '../../components/windows/optimization/synthesisShared/synthesisMath.js';
import { PRESERVE_BULK_GENTLE_ITER } from '../synthesis/synthesisConfig.js';

export { alive } from '../synthesis/poolRun.js';

// A worker's in-flight design, as the run reports it live.
const liveOf = m => ({
    mf: m.mf, omf: m.omf, frontLayers: m.frontLayers, backLayers: m.backLayers, layers: m.layers,
});

/**
 * The state of a run of `plan` on `design`, with the prepared operands,
 * materials and scan sides and its built worker pool. `best` and `work` carry
 * the full design (front and back layers); either side may change in any cycle
 * for both_independent. The generation and GE-step counts, the ΔMF baseline
 * and the clock carry on from `plan.history`.
 *
 * Preserve-bulk (synthesisConfig/seedMode.js) refines each step gently, at
 * most PRESERVE_BULK_GENTLE_ITER iterations, so the bulk of a thick seed
 * persists and the total optical thickness grows as the needles go in.
 */
export function makeRun(design, plan, prep, workerPool, hooks) {
    const { history } = plan;
    const poolLite = plan.pool.map(p => ({ id: p.id, name: p.name }));
    const S = {
        hooks, signal: hooks.signal,
        workerPool, poolClosed: false,
        operands: prep.operands, materials: prep.materials, scanSides: prep.scanSides,
        media: serializableMedia(design), curDes: design, pool: plan.pool, poolLite,
        poolSlices: chunkArray(poolLite, plan.threads), K: plan.threads,
        innerEngine: plan.innerEngine, preserveBulk: plan.preserveBulk, dlsIter: plan.refineIter,
        stepIter: plan.preserveBulk ? Math.min(plan.refineIter, PRESERVE_BULK_GENTLE_ITER) : plan.refineIter,
        maxLayers: plan.maxLayers, maxGeCycles: plan.maxGeCycles, deepSearch: plan.deepSearch,
        targetMF: plan.targetMF, dMin: plan.dMin, maxBatches: plan.maxBatches, sensFloor: plan.sensFloor,
        smartSeed: plan.smartSeed, consolidate: plan.consolidate, consolidateTol: plan.consolidateTol,
        best: { mf: Infinity, frontLayers: null, backLayers: null },
        work: { mf: Infinity, frontLayers: null, backLayers: null },
        genNum: history.genNum, geSteps: history.geSteps, hasRows: history.hasRows,
        prevBestMF: history.bestMF,
        runT0: performance.now() - history.elapsedMs,
        lastRow: null, foldRowId: null,
        gotProgress: false,
    };
    S.emit = patch => hooks.onProgress?.(patch);
    // Once a live design is reported the caller may be showing it, so from
    // then on a failure is one after progress.
    S.onTick = (_i, m) => {
        if (!m || m.type !== 'tick') return;
        if (m.frontLayers || m.backLayers) S.gotProgress = true;
        S.emit({ live: liveOf(m) });
    };
    return S;
}
