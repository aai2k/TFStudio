/**
 * Needle Variation optimization engine — worker-POOL run (default path).
 *
 * Main thread orchestrates; a WorkerPool runs the heavy primitives:
 *  • SCAN is fanned across the pool by candidate-material slice — each
 *    candidate's gradient is computed in the same op→λ→pol order as a single
 *    scan, so that part stays bit-identical.
 *  • CANDIDATE refinement runs a BATCH of the top improving candidates in
 *    parallel and keeps the best post-refinement. Deliberate: keeps best of
 *    top-K candidates (not first-improving in ΔMF order); NOT bit-identical,
 *    but uses many threads.
 *
 * The pool is injected via ctx.makeWorkerPool(K, initMessage) so the component
 * supplies a real WorkerPool while a test can supply an in-process fake pool
 * (see tests/needle_worker_pool.mjs). The orchestration is split across
 * workerPoolSetup.js (per-run setup), workerPoolScan.js (scan + smart seed),
 * workerPoolRefine.js (batch refine + accept), and workerPoolLifecycle.js
 * (ticks, teardown, fallback); on any pre-progress failure it falls back to
 * the identical-math main-thread loop in mainThread.js.
 */

import { chunkArray, poolSize } from '../../synthesisShared/synthesisHelpers.js';
import {
    getSynthesisInnerEngine, getSynthesisMaxBatches, getSynthesisSmartSeed,
} from '../../../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../../../utils/workers/tmmWasm.js';

import { runNeedleMainThread } from './mainThread.js';
import { wpPrepare, wpPresample, wpDesignHelpers } from './workerPoolSetup.js';
import { wpSmartSeed, wpScanCycle } from './workerPoolScan.js';
import { wpRefineBatches } from './workerPoolRefine.js';
import { wpAlive, wpFinalize, wpHandleLoopError } from './workerPoolLifecycle.js';

// One scan+refine cycle. Returns 'abort' (a Stop tore the run down, already
// unwound), a finalize reason string (stop the loop), or null (keep cycling).
async function wpRunCycle(run) {
    const scan = await wpScanCycle(run);
    if (scan.aborted) return 'abort';
    if (scan.done) return scan.reason;

    const ref = await wpRefineBatches(run, scan.queue);
    if (ref.aborted) return 'abort';
    if (ref.done) return ref.reason;
    return ref.accepted ? null : 'Needle-optimal (all candidates exhausted)';
}

// Async driver: optional smart-seed, then scan → refine cycles until a stop
// condition (max layers / needle-optimal / converged / exhausted).
async function wpRun(run) {
    try {
        if (getSynthesisSmartSeed('needle') && !(await wpSmartSeed(run))) return;
        while (wpAlive(run)) {
            const reason = await wpRunCycle(run);
            if (reason === 'abort') return;
            if (reason !== null) { wpFinalize(run, reason); return; }
        }
    } catch (err) {
        wpHandleLoopError(run, err);
    }
}

export function runNeedleWorkerPool(ctx) {
    if (ctx.runningRef.current) return;
    const prep = wpPrepare(ctx);
    if (!prep) return;
    const { curDes, operands, scanSides, pool } = prep;

    // Snapshot on first run + one undo checkpoint for the whole synthesis run.
    if (!ctx.savedDesignRef.current) {
        ctx.checkpointRef.current && ctx.checkpointRef.current();
        ctx.savedDesignRef.current = { frontLayers: ctx.designRef.current.frontLayers, backLayers: ctx.designRef.current.backLayers };
        ctx.baseDesignRef.current  = curDes;
        ctx.setCanReset(true);
    }

    const materials = wpPresample(curDes, operands, pool);
    if (!materials) { runNeedleMainThread(ctx); return; }

    const innerEngine = getSynthesisInnerEngine('needle');   // Needle default 'cg'
    const K = poolSize();
    let workerPool;
    const wasmBytes = getTmmWasmBytesForWorker();
    try { workerPool = ctx.makeWorkerPool(K, wasmBytes ? { type: 'wasmInit', wasmBytes } : null); }
    catch (err) {
        console.error('[Needle] WorkerPool construction failed, main-thread fallback:', err);
        runNeedleMainThread(ctx);
        return;
    }
    ctx.workerRef.current = workerPool;

    const poolSlices = chunkArray(pool.map(p => ({ id: p.id, name: p.name })), K);
    // Cumulative wallclock, continuous across stop/resume; genNum + ΔMF baseline
    // continue across Stop→Run (M4) rather than resetting.
    const prevElapsed = ctx.gensRef.current.length
        ? (ctx.gensRef.current[ctx.gensRef.current.length - 1].tMs || 0) : 0;
    const run = {
        ctx, curDes, operands, scanSides, pool, materials, workerPool,
        ...wpDesignHelpers(curDes, poolSlices),
        maxLayers: ctx.maxLayersRef.current, deltaNm: ctx.deltaNmRef.current,
        dMin: ctx.dMinRef.current, dlsIter: ctx.dlsIterRef.current,
        // Needle always uses the full per-step refine (preserve-bulk is GE-only;
        // the GUI 2×2 showed more iters help Needle), so stepIter == dlsIter.
        stepIter: ctx.dlsIterRef.current,
        innerEngine, maxBatches: getSynthesisMaxBatches(), K,
        best: { mf: Infinity, frontLayers: null, backLayers: null },
        genNum: ctx.genCountRef.current,
        prevBestMF: ctx.gensRef.current.length ? Math.min(...ctx.gensRef.current.map(g => g.mf)) : Infinity,
        runT0: performance.now() - prevElapsed,
        gotProgress: false, lastTick: 0,
    };

    ctx.runningRef.current = true;
    ctx.setPhase('scanning');
    ctx.setStatusMsg('');
    wpRun(run);
}
