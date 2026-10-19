/**
 * Runs the Structural Optimizer's run (utils/structural/runStructural.js) for
 * the optimizer benchmark, headless: each refine runs on the calling thread
 * through InThreadOptimizerWorker. The pool is drawn the way the window draws
 * it, from the built-in catalog, so a change to the window's search shows in
 * the benchmark.
 */
import { runStructural } from '../structural/runStructural.js';
import { InThreadOptimizerWorker } from '../workers/inThreadOptimizerWorker.js';
import { getCatalogs } from '../materials/catalogManager.js';
import { getPoolMaterials } from '../../components/windows/optimization/synthesisShared/catalogPool.js';

const now = () => performance.now();
const deep = value => JSON.parse(JSON.stringify(value));

// The window draws its pool from the selected catalogs minus the excluded
// materials, so a pool of built-in ids excludes every other built-in. An id
// the built-in catalog lacks would silently shrink the pool, so it is an error.
function excludedFor(poolIds) {
    const ids = Object.keys(getCatalogs().find(catalog => catalog.id === 'builtin')?.materials || {});
    const unknown = poolIds.filter(id => !ids.includes(id));
    if (unknown.length) throw new Error(`Structural pool: not in the built-in catalog: ${unknown.join(', ')}`);
    return new Set(ids.filter(id => !poolIds.includes(id)));
}

// The benchmark's stop reason for each way a run ends on its own.
const STOP_REASON = {
    maxIter: 'maxIter', iterationCap: 'maxIter', budget: 'budget', patience: 'patience',
    layerCap: 'noProposals', noMutation: 'noProposals', target: 'target',
};

function settingsOf(cfg, pool) {
    return {
        pool, maxIter: cfg.maxIter, targetMF: cfg.targetMF, T0: cfg.T0, jitterPct: cfg.jitterPct,
        refineIter: cfg.refineIter, dMin: cfg.dMin, addMaxNm: cfg.addMaxNm, maxLayers: cfg.maxLayers,
        kinds: [...cfg.kinds], deepSearch: !!cfg.deepMode, deepMaxMin: cfg.deepMaxMin, seed: cfg.seed ?? null,
        innerEngine: cfg.engine, smartSeed: cfg.smartSeed, threads: cfg.threads,
    };
}

/**
 * One headless Structural run from `start` against `ops`, with the pool
 * `poolIds` and the window settings `cfg` plus engine, smartSeed and threads.
 * Resolves to the design the run ends on (its last best), its merit and layer
 * count, the time taken, the reheat and iteration counts, why it stopped
 * ('maxIter' | 'patience' | 'budget' | 'noProposals' | 'target') and its
 * history rows. Rejects when the run fails or does not start (no operands, no
 * pool, a failed first refine), as the other benchmark drivers throw.
 */
export async function runWindowStructural({ start, ops, poolIds, cfg, onTick }) {
    const t0 = now();
    const design = { ...deep(start), id: 'benchmark-structural' };
    const operands = ops.map((op, i) => ({ ...op, id: op.id || `op${i}`, enabled: op.enabled !== false }));
    const pool = getPoolMaterials(new Set(['builtin']), { excluded: excludedFor(poolIds), design });
    const gens = [];
    let iter = 0;
    const result = await runStructural(design, operands, settingsOf(cfg, pool), {
        makeWorker: () => new InThreadOptimizerWorker(),
        onProgress: patch => { if ('iter' in patch) iter = patch.iter; },
        onRow: row => {
            gens.push(row);
            onTick?.({ phase: 'structural', mf: row.mf, layers: row.layerCount, steps: iter, elapsed: now() - t0 });
        },
    });
    if (!result.completed) throw new Error(result.message || `Structural run did not finish: ${result.stopReason}`);
    const best = gens[gens.length - 1];
    if (!best) throw new Error(`Structural run did not finish: ${result.stopReason}`);
    const stopReason = STOP_REASON[result.stopReason];
    return {
        mf: Number.isFinite(result.mf) ? result.mf : best.mf,
        layers: (best.frontSnap || []).length,
        ms: now() - t0,
        design: { ...deep(start), frontLayers: best.frontSnap || [], backLayers: best.backSnap || [] },
        reheats: result.reheats,
        // A budget stop happens at the start of an iteration that then does no work.
        iters: stopReason === 'budget' ? Math.max(0, iter - 1) : iter,
        stopReason,
        rows: gens.map(g => ({ kind: g.kind, layers: g.layerCount, mf: g.mf })),
    };
}
