// Worker-POOL Gradual-Evolution engine — the default run path. The main thread
// orchestrates the GE state machine while a WorkerPool runs the heavy
// primitives: SCAN is fanned across the pool by candidate-material slice
// (bit-identical per candidate); the needle-optimization step deliberately
// refines a BATCH of top candidates in parallel and keeps the best (not
// first-improving in ΔMF order), so it is not bit-identical. Seed-DLS and the
// forced-TOT step are also pool jobs. Falls back to the synchronous main-thread
// engine (mainThread.js) if the pool fails before any progress.
//
// A plain function of the GradualEvolution window's `ctx` bag; see
// GradualEvolution.js which builds the ctx and owns the React state. The
// orchestration is split across workerPoolCore.js (shared helpers),
// workerPoolSeed.js, workerPoolNeedle.js, workerPoolGeStep.js and
// workerPoolFinalize.js (one phase group per file), driven off a single
// run-state object `S`, so no giant nested closure builds up.

import {
    requiredLambdas, collectDesignMaterialIds, buildPresampledTable,
} from '../../../../../utils/physics/optimizer.js';
import { WorkerPool } from '../../../../../utils/workers/workerPool.js';
import {
    getSynthesisInnerEngine, getSynthesisMaxBatches,
    getSynthesisSeedMode, PRESERVE_BULK_GENTLE_ITER,
} from '../../../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../../../utils/workers/tmmWasm.js';
import { SYNTHESIS_WORKER_URL as SYNTH_WORKER_URL } from '../../../../../workerUrls.js';
import {
    activeSide, densifyForRun, chunkArray, poolSize, resolveMat,
} from '../../synthesisShared/synthesisHelpers.js';
import { runGeMainThread } from './mainThread.js';
import { alive, fallback } from './workerPoolCore.js';
import { seedPhase } from './workerPoolSeed.js';
import { tryAcceptOnSide } from './workerPoolNeedle.js';
import { forcedGeStep } from './workerPoolGeStep.js';
import { finalize } from './workerPoolFinalize.js';

// Try every eligible side (smaller side first, so growth stays balanced) for
// an improving needle. Returns 'stop' if the pool died or the run converged
// (finalize already called), 'continue' if any side accepted a needle, or
// 'none' if none did (caller takes a forced GE step).
async function tryEachSide(ctx, S, orderedSides) {
    let needleAccepted = false;
    for (const sd of orderedSides) {
        if (!alive(ctx, S)) return 'stop';
        const ok = await tryAcceptOnSide(ctx, S, sd);
        if (ok) {
            needleAccepted = true;
            if (S.best.mf < S.targetMF) {
                console.log(`[GE] Converged: best MF=${S.best.mf.toFixed(6)} < tol=${S.targetMF}`);
                await finalize(ctx, S, `Converged MF=${S.best.mf.toFixed(6)}`);
                return 'stop';
            }
        }
    }
    return needleAccepted ? 'continue' : 'none';
}

// One outer-loop iteration: try every eligible scan side for an improving
// needle; if none improve, take a forced total-optical-thickness step.
// Returns 'stop' once the run should end (finalize already called) or
// 'continue' to run another iteration.
async function runGeCycle(ctx, S) {
    // Max-layers stop: each scan-side caps independently.
    const remainingSides = S.scanSides.filter(sd =>
        (sd === 'front' ? S.work.frontLayers : S.work.backLayers).length < S.maxLayers);
    if (remainingSides.length === 0) {
        console.log(`[GE] Max layers reached on all scan sides`);
        await finalize(ctx, S, 'Max layers reached');
        return 'stop';
    }
    // Smaller side first (tiebreak: front).
    const orderedSides = [...remainingSides].sort((a, b) => {
        const la = (a === 'front' ? S.work.frontLayers : S.work.backLayers).length;
        const lb = (b === 'front' ? S.work.frontLayers : S.work.backLayers).length;
        return (la - lb) || (a === 'front' ? -1 : 1);
    });

    const sideOutcome = await tryEachSide(ctx, S, orderedSides);
    if (sideOutcome !== 'none') return sideOutcome;

    // ── Forced total-optical-thickness step ──────────────────
    console.log('[GE] Needle-optimal on all eligible sides → forced GE step');
    return (await forcedGeStep(ctx, S)) ? 'continue' : 'stop';
}

// The async orchestration: seed, then the outer per-side GE loop (Option 1,
// per-side acceptance): each outer iteration processes every eligible side
// independently; forced GE only fires when NO side could find an improving
// needle.
async function runGeLoop(ctx, S) {
    try {
        if (await seedPhase(ctx, S) == null) return;
        while (alive(ctx, S)) {
            if (await runGeCycle(ctx, S) === 'stop') return;
        }
    } catch (err) {
        // Expected: a Stop tears down the pool, which rejects the in-flight job
        // with 'pool terminated'. That's a clean stop, not an error — stopOpt
        // already ran, so just bail silently.
        if (!alive(ctx, S) || String(err && err.message) === 'pool terminated') return;
        if (!S.gotProgress) fallback(ctx, S, 'errored before progress', err);
        else { console.error('[GE] Pool error:', err); ctx.stopOpt(String(err && err.message || err)); }
    }
}

export function runGeWorker(ctx) {
    if (ctx.runningRef.current) return;
    ctx.reconcileBaseWithEdits();   // M12: pick up manual edits made between runs

    const curDes   = ctx.baseDesignRef.current || ctx.designRef.current;
    const operands  = densifyForRun(ctx.operandsRef.current.filter(op => op.enabled), curDes);
    if (!curDes || operands.length === 0) { ctx.setStatusMsg(ctx.t.gradualEvolution.noOperands); return; }

    // Sides to scan per cycle. For both_independent we scan BOTH front and back
    // and pick the global best needle (regardless of side); for forced modes we
    // scan one side. Seed DLS / candidate-DLS in both_independent vary BOTH sides
    // simultaneously regardless.
    const surfaceMode = curDes.surfaceMode || 'front_only';
    const scanSides = surfaceMode === 'both_independent' ? ['front', 'back'] : [activeSide(curDes)];

    const pool = ctx.getPoolMaterials(ctx.selectedCatsRef.current, ctx.excludedMatsRef.current);
    if (!pool.length) { ctx.setStatusMsg('No candidate materials'); return; }

    if (!ctx.savedDesignRef.current) {
        ctx.checkpointRef.current && ctx.checkpointRef.current();
        ctx.savedDesignRef.current = { frontLayers: ctx.designRef.current.frontLayers, backLayers: ctx.designRef.current.backLayers };
        ctx.baseDesignRef.current  = curDes;
        ctx.setCanReset(true);
    }

    let materials;
    try {
        const lambdas = requiredLambdas(operands);
        const pairs = collectDesignMaterialIds(curDes).map(id => ({ id, mat: resolveMat(id) }))
            .concat(pool.map(p => ({ id: p.id, mat: p.mat })));
        materials = buildPresampledTable(lambdas, pairs);
    } catch (err) {
        console.error('[GE] Pre-sampling failed, main-thread fallback:', err);
        runGeMainThread(ctx);
        return;
    }

    const innerEngine = getSynthesisInnerEngine('ge');   // GE default 'cg' (user-selectable)
    // Preserve-bulk + gentle refine (gated; default 'refine'). 'preserve-bulk':
    // skip the bare-seed refine (else a lone thick seed collapses 7k→2k nm for
    // zero MF gain) and refine each step GENTLY so the bulk persists and TOT
    // grows organically.
    const preserveBulk = getSynthesisSeedMode() === 'preserve-bulk';
    const dlsIter = ctx.dlsIterRef.current;
    const K = poolSize();

    let workerPool;
    const wasmBytes = getTmmWasmBytesForWorker();
    window.electronAPI?.diagLog?.(`GE start: poolSize=${K} wasmBytesForWorker=${wasmBytes ? (wasmBytes.byteLength ?? wasmBytes.length) : 0} workerURL=${String(SYNTH_WORKER_URL)}`);
    try { workerPool = new WorkerPool(SYNTH_WORKER_URL, K, wasmBytes ? { type: 'wasmInit', wasmBytes } : null); }
    catch (err) {
        console.error('[GE] WorkerPool construction failed, main-thread fallback:', err);
        window.electronAPI?.diagLog?.(`GE WorkerPool construction FAILED → main-thread fallback: ${err?.message || err}`);
        runGeMainThread(ctx);
        return;
    }
    ctx.workerRef.current = workerPool;

    const media = {
        surfaceMode:    curDes.surfaceMode || 'front_only',
        mfEvalMode:     curDes.mfEvalMode ?? 'side',
        incidentMedium: curDes.incidentMedium ?? 'Air',
        exitMedium:     curDes.exitMedium ?? 'Air',
        substrate: {
            material:  curDes.substrate?.material ?? 'BK7',
            thickness: curDes.substrate?.thickness ?? 1.0,
        },
        // Cone-angle averaging: ship to the synthesis workers so the scan (FD
        // fallback) + DLS refine are cone-averaged like the eval.
        ...(curDes.cone ? { cone: curDes.cone } : {}),
    };
    const poolLite = pool.map(p => ({ id: p.id, name: p.name }));

    ctx.runningRef.current = true;
    ctx.setPhase('refining');
    ctx.setStatusMsg('');

    // Whole-run state: config + mutable aggregation, threaded through the
    // module-scope orchestration handlers. best / work carry the FULL design
    // (front + back layers); either side may change in any cycle for
    // both_independent. genNum / geSteps / prevBestMF continue across Stop→Run
    // (M4) so gen numbering + the GE-step budget don't reset while history
    // persists; runT0 offsets the elapsed-time column by the last cycle's time.
    const S = {
        workerPool, operands, materials, media, curDes, pool, poolLite,
        poolSlices: chunkArray(poolLite, K), K,
        scanSides, innerEngine, preserveBulk, dlsIter,
        stepIter: preserveBulk ? Math.min(dlsIter, PRESERVE_BULK_GENTLE_ITER) : dlsIter,
        maxLayers: ctx.maxLayersRef.current, maxGeCycles: ctx.maxGeCyclesRef.current,
        targetMF: ctx.targetMFRef.current, dMin: ctx.dMinRef.current,
        maxBatches: getSynthesisMaxBatches(),      // cap candidate escalation
        tg: ctx.t.gradualEvolution,
        best: { mf: Infinity, frontLayers: null, backLayers: null },
        work: { mf: Infinity, frontLayers: null, backLayers: null },
        geStagn: { n: 0 },
        genNum: ctx.genCountRef.current, geSteps: ctx.geStepsRef.current,
        prevBestMF: ctx.cyclesRef.current.length ? Math.min(...ctx.cyclesRef.current.map(c => c.mf)) : Infinity,
        runT0: performance.now() - (ctx.cyclesRef.current.length
            ? (ctx.cyclesRef.current[ctx.cyclesRef.current.length - 1].tMs || 0) : 0),
        gotProgress: false, lastTick: 0,
    };

    runGeLoop(ctx, S);
}
