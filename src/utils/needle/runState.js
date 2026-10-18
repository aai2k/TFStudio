// The state one Needle run carries from cycle to cycle.

import { chunkArray } from '../../components/windows/optimization/synthesisShared/synthesisMath.js';
import { designHelpers } from './setup.js';

export { alive } from '../synthesis/poolRun.js';

// A worker's in-flight design, as the run reports it live.
const liveOf = m => ({
    mf: m.mf, omf: m.omf, frontLayers: m.frontLayers, backLayers: m.backLayers, layers: m.layers,
});

/**
 * The state of a run of `plan` on `design`, with the prepared operands,
 * materials and scan sides and its built worker pool. `best` starts empty and
 * takes the start design's merit from the first scan. The generation count,
 * the ΔMF baseline, the clock and the rows a final winner is checked against
 * carry on from `plan.history`.
 */
export function makeRun(design, plan, prep, workerPool, hooks) {
    const { history } = plan;
    const poolSlices = chunkArray(plan.pool.map(p => ({ id: p.id, name: p.name })), plan.threads);
    const run = {
        hooks, signal: hooks.signal,
        curDes: design, pool: plan.pool, workerPool, poolClosed: false,
        operands: prep.operands, materials: prep.materials, scanSides: prep.scanSides,
        ...designHelpers(design, poolSlices),
        maxLayers: plan.maxLayers, deltaNm: plan.deltaNm, dMin: plan.dMin, refineIter: plan.refineIter,
        targetMF: plan.targetMF, innerEngine: plan.innerEngine, maxBatches: plan.maxBatches,
        sensFloor: plan.sensFloor, smartSeed: plan.smartSeed, K: plan.threads,
        best: { mf: Infinity, omf: null, frontLayers: null, backLayers: null },
        // Thin-start rescue: fires at most once, and keeps the design it was
        // called on so the run can never end worse than it stalled.
        rescued: false, preRescueBest: null, markRescue: false,
        genNum: history.genNum,
        prevBestMF: history.bestMF,
        rows: [...history.rows],
        runT0: performance.now() - history.elapsedMs,
        gotProgress: false,
    };
    run.emit = patch => hooks.onProgress?.(patch);
    // Once a live design is reported the caller may be showing it, so from
    // then on a failure is one after progress.
    run.onTick = (_i, m) => {
        if (m.type !== 'tick') return;
        if (m.frontLayers || m.backLayers) run.gotProgress = true;
        run.emit({ live: liveOf(m) });
    };
    return run;
}
