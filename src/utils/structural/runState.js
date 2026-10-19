// The state one Structural run carries from iteration to iteration.

import { makeRng, MUTATION_KINDS } from '../synthesis/structuralOptimizer.js';
import { randomSeed } from '../physics/errorAnalysis/mcConfig.js';
import { getTmmWasmBytesForWorker } from '../../tmmcore.js';
import { serializableMedia } from '../../components/windows/optimization/synthesisShared/synthesisMath.js';

export { alive } from '../synthesis/poolRun.js';

// Iterations without a new best after which a run stops, or Deep search reheats.
const stallPatience = maxIter => Math.max(15, Math.round(maxIter / 3));

// Every enabled operand the run keeps, constraints included, for scoring
// results; band rows carry the run's sample counts so the score and the refine
// share one grid.
function scoringOperands(enabled, operands) {
    const byId = new Map(operands.map(op => [op.id, op]));
    return enabled.map(op => byId.get(op.id) || op);
}

/**
 * The state of a run of `plan` on `design`, with the prepared operands, bounds
 * and material tables and its built workers. The seed is the plan's, or a
 * fresh one; proposals, accept rolls and basin kicks all draw from it, so with
 * the same design, settings and thread count the run repeats. The generation
 * count, the clock and the trend carry on from `plan.history`.
 */
export function makeRun(design, plan, prep, workerPool, hooks) {
    const { history } = plan;
    const seed = plan.seed ?? randomSeed();
    const best = { mf: Infinity, omf: null, frontLayers: null, backLayers: null };
    const S = {
        hooks, signal: hooks.signal, workerPool, poolClosed: false,
        cfg: { ...plan, dMin: prep.dMin, dMax: prep.dMax },
        curDes: design, operands: prep.operands, fullOps: scoringOperands(prep.enabled, prep.operands),
        side: prep.side, layerKey: prep.layerKey, otherKey: prep.otherKey,
        surfaceMode: design.surfaceMode || 'front_only', pool: plan.pool,
        poolLite: plan.pool.map(material => ({ id: material.id, name: material.name })),
        materials: prep.materials, workerCount: plan.threads, wasmBytes: getTmmWasmBytesForWorker(),
        runT0: performance.now() - history.elapsedMs,
        media: serializableMedia(design),
        structEngine: plan.innerEngine, smartSeed: plan.smartSeed,
        seed, rng: makeRng(seed), best, current: { ...best },
        trendX: history.trendIter, genNum: history.genNum, hasRows: history.hasRows,
        accepts: 0, attempts: 0, prevBestMF: Infinity, noImprove: 0,
        patience: stallPatience(plan.maxIter),
        kinds: MUTATION_KINDS.filter(kind => plan.kinds.has(kind)),
        endTemperature: plan.T0 * 0.005,
        coolPeriod: Math.max(40, plan.maxIter),
        deepBudgetMs: plan.deepMaxMin > 0 ? plan.deepMaxMin * 60000 : 0,
        cycleStart: 1, reheatCount: 0, iteration: 0,
    };
    S.emit = patch => hooks.onProgress?.(patch);
    S.onTick = message => S.emit({ live: { mf: message.mf, omf: message.omf } });
    return S;
}
