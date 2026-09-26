/**
 * Runs the Structural Optimizer window's own runner (runStructuralWorker) for
 * the optimizer benchmark, headless: refs stand in for the window's state, the
 * display setters record what the benchmark reports, and each refine runs on
 * the calling thread through InThreadOptimizerWorker. A change to the window's
 * search therefore shows in the benchmark. Materials resolve through the
 * built-in catalog, as in the window.
 */
import { runStructuralWorker } from '../../components/windows/optimization/structuralOptimizer/runners/workerPool.js';
import { stallPatience } from '../../components/windows/optimization/structuralOptimizer/runners/runState.js';
import { InThreadOptimizerWorker } from '../workers/inThreadOptimizerWorker.js';
import { getCatalogs } from '../materials/catalogManager.js';
import en from '../../constants/locales/en.js';

const now = () => performance.now();
const ref = current => ({ current });
const noop = () => {};
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

// The benchmark's stop reason ('maxIter' | 'patience' | 'budget' |
// 'noProposals' | 'target') for the window's final status line, or null for a
// status the loop's own ending does not produce.
function stopReasonOf(status, cfg, bestMf) {
    const ts = en.structural;
    const reasons = new Map([
        [ts.statusMaxIter, 'maxIter'], [ts.statusDone, 'maxIter'],
        [ts.statusTimeUp, 'budget'], [ts.statusStalled(stallPatience(cfg.maxIter)), 'patience'],
        [ts.statusCap, 'noProposals'], [ts.statusNoMut, 'noProposals'],
    ]);
    if (Number.isFinite(bestMf)) reasons.set(ts.statusConverged(bestMf), 'target');
    return reasons.get(status) || null;
}

function makeCtx({ start, ops, poolIds, cfg, onTick, t0, seen }) {
    const designRef = ref({ ...deep(start), id: 'benchmark-structural' });
    const ctx = {
        cfgRef: ref(cfg), runningRef: ref(false), workersRef: ref([]), runIdRef: ref(0), designRef,
        operandsRef: ref(ops.map((op, i) => ({ ...op, id: op.id || `op${i}`, enabled: op.enabled !== false }))),
        savedDesignRef: ref(null), baseDesignRef: ref(null), runsRef: ref([]), runOpenRef: ref(false),
        gensRef: ref([]), genCountRef: ref(0), trendRef: ref([]),
        updateDesignRef: ref(patch => { designRef.current = { ...designRef.current, ...deep(patch) }; }),
        checkpointRef: ref(noop),
        selectedCatsRef: ref(new Set(['builtin'])), excludedMatsRef: ref(excludedFor(poolIds)),
        reconcileBaseWithEdits: noop, saveCache: noop,
        makeWorker: () => new InThreadOptimizerWorker(),
        killWorkers: () => {
            for (const worker of ctx.workersRef.current) worker.terminate();
            ctx.workersRef.current = [];
        },
        // The run loop hands an exception to stopOpt.
        stopOpt: message => { ctx.runningRef.current = false; seen.error = String(message); },
        ts: en.structural,
        setRunning: noop, setTemp: noop, setAccRate: noop, setMf: noop,
        setOmf: noop, setOmfBest: noop, setLayerCount: noop, setTopDesigns: noop, setTrend: noop,
        setCanReset: noop, setSeed: noop,
        setMfBest: value => { seen.mfBest = value; },
        setIter: value => { seen.iter = value; },
        setReheats: value => { seen.reheats = value; },
        setStatusMsg: value => { seen.status = value; },
        setGenerations: gens => {
            const last = gens[gens.length - 1];
            if (last && onTick) onTick({
                phase: 'structural', mf: last.mf, layers: last.layerCount, steps: seen.iter, elapsed: now() - t0,
            });
        },
    };
    return ctx;
}

/**
 * One headless Structural run from `start` against `ops`, with the pool
 * `poolIds` and the window settings `cfg` (runState.js reads them). Resolves to
 * the design the window ends on (its last best), its merit and layer count, the
 * time taken, the reheat and iteration counts, why it stopped and its history
 * rows. Rejects when the run fails or does not start (no operands, no pool, a
 * failed first refine), as the other benchmark drivers throw.
 */
export async function runWindowStructural({ start, ops, poolIds, cfg, onTick }) {
    const t0 = now();
    const seen = { iter: 0, reheats: 0, status: '', error: null, mfBest: null };
    const ctx = makeCtx({ start, ops, poolIds, cfg, onTick, t0, seen });
    await runStructuralWorker(ctx);
    ctx.killWorkers();
    if (seen.error) throw new Error(seen.error);
    const gens = ctx.gensRef.current;
    const best = gens[gens.length - 1];
    const mf = Number.isFinite(seen.mfBest) ? seen.mfBest : best?.mf;
    const stopReason = best ? stopReasonOf(seen.status, cfg, mf) : null;
    if (!stopReason) throw new Error(`Structural run did not finish: ${seen.status || 'no design'}`);
    const design = { ...deep(start), frontLayers: best.frontSnap || [], backLayers: best.backSnap || [] };
    return {
        mf,
        layers: design.frontLayers.length,
        ms: now() - t0,
        design,
        reheats: seen.reheats,
        // A budget stop happens at the start of an iteration that then does no work.
        iters: stopReason === 'budget' ? Math.max(0, seen.iter - 1) : seen.iter,
        stopReason,
        rows: gens.map(g => ({ kind: g.kind, layers: g.layerCount, mf: g.mf })),
    };
}
