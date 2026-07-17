// DLS worker-pool run (methods 'dls' & 'dls-multi') — the validated event-based
// path. Each worker runs ONE single-start DLS off the UI thread; multi-start = a
// POOL (perturbation + global-best aggregation here, workers pull restarts off a
// queue). `multiStartRef` (derived from the method selector) decides single vs
// multi. cg/sa/de/all use runMethodsFlow instead.
//
// A plain function of the Refinement component's `ctx` bag (see mainThread.js).
// Per-restart job construction lives in dlsPoolJobs.js and the worker message
// handlers live in dlsPoolMessages.js, so pool setup/lifecycle here stays its
// own concern.

import { DLSOptimizer } from '../../../../../utils/physics/optimizer.js';
import { getThreadCount } from '../../../../../utils/synthesis/synthesisConfig.js';
import { OPTIMIZER_WORKER_URL as WORKER_URL } from '../../../../../workerUrls.js';
import { resolveMat, densifyForRun, presampleMaterials } from '../refinementUtils.js';
import { runOptMainThread } from './mainThread.js';
import { designForRestart, makeJob } from './dlsPoolJobs.js';
import { handleMsg, doFallback } from './dlsPoolMessages.js';

const serializeLayers = (arr) => (arr || []).map(l => ({
    id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked,
}));

function spawnWorker(ctx, S) {
    let w;
    try { w = new Worker(WORKER_URL, { type: 'module' }); }
    catch (_) { return null; }
    // Per-run sequential id, not Math.random: worker ids must not draw from the
    // RNG, or the pool size (= core count) would shift the seeded perturbation
    // stream and make multi-start results depend on the machine's thread budget.
    const wid = 'w' + (++S.widSeq);
    S.prevIterByW.set(wid, 0);
    w.onmessage = (e) => handleMsg(ctx, S, w, wid, e);
    w.onerror = (e) => {
        if (!S.gotProgress) doFallback(ctx, S, 'threw before progress', e.message || e);
        else { console.error('[DLS] Worker onerror:', e.message || e); ctx.stopOpt(); }
    };
    return w;
}

// Serializable media (everything but the layer stacks) shipped to each worker.
function buildMedia(curDes, surfMode) {
    return {
        surfaceMode:    surfMode,
        mfEvalMode:     curDes.mfEvalMode ?? 'side',
        incidentMedium: curDes.incidentMedium ?? 'Air',
        exitMedium:     curDes.exitMedium ?? 'Air',
        substrate: {
            material:  curDes.substrate?.material ?? 'BK7',
            thickness: curDes.substrate?.thickness ?? 1.0,
        },
        // Cone-angle averaging — ship to the worker so the pool refinement is
        // cone-averaged identically to the main-thread eval.
        ...(curDes.cone ? { cone: curDes.cone } : {}),
    };
}

// Whether the surface mode exposes optimization variables for multi-start.
function isMultiEligible(surfMode, hasFront, hasBack) {
    if (surfMode === 'back_only') return hasBack;
    if (surfMode === 'both_independent') return hasFront || hasBack;
    return hasFront;
}

// Take the single run checkpoint + Reset baseline once per open run session.
function ensureBaseline(ctx, curDes) {
    if (ctx.baselineRef.current) return;
    ctx.checkpointRef.current && ctx.checkpointRef.current();
    ctx.commitBaseline({ frontLayers: curDes.frontLayers, backLayers: curDes.backLayers });
    ctx.baselineRef.current = true;
}

// Spawn up to K workers and hand each its first restart job; falls back to the
// main thread if no worker can be constructed.
function startPool(ctx, S) {
    const workers = [];
    for (let i = 0; i < S.K && S.nextJob < S.nJobs; i++) {
        const w = spawnWorker(ctx, S);
        if (!w) { if (i === 0) { doFallback(ctx, S, 'construction failed', 'new Worker threw'); return; } break; }
        workers.push(w);
    }
    if (workers.length === 0) { doFallback(ctx, S, 'construction failed', 'no workers'); return; }
    ctx.poolRef.current = workers;
    for (const w of workers) {
        if (S.nextJob >= S.nJobs) break;
        const r = S.nextJob++;
        w.postMessage(makeJob(S, S.isMulti ? r + 1 : 0));
    }
}

// One cheap main-thread eval of the unperturbed design → seeds the MF/OMF
// readouts, independent of which worker reports first.
function evalBaseline(ctx, S) {
    try {
        const baseOpt = new DLSOptimizer(S.ops, designForRestart(S, 0), resolveMat);
        ctx.setMfInitial(baseOpt.mf);
        ctx.setMfBest(S.isMulti ? null : baseOpt.mfBest);
        ctx.setMf(baseOpt.mf);
        const baseOmf = baseOpt.mfOpticalAt(baseOpt.thicknesses);
        ctx.setOmfInitial(baseOmf);
        ctx.setOmfBest(S.isMulti ? null : baseOmf);
        ctx.setOmf(baseOmf);
    } catch (err) {
        console.error('[DLS] baseline eval failed:', err);
        ctx.setMfInitial(null); ctx.setMfBest(null); ctx.setOmfInitial(null); ctx.setOmfBest(null);
    }
}

export function runDlsEvent(ctx) {
    const {
        runningRef, designRef, operandsRef,
        multiStartRef, nRestartsRef, perturbPctRef, maxIterRef,
        optimizerRef, lastBestRef, bumpRunCount, histRunCount, t,
        setRunning, setCanReset, setMfHistory, setRestartIdx,
    } = ctx;

    if (runningRef.current) return;

    const curDes = designRef.current;
    const ops    = densifyForRun(operandsRef.current.filter(op => op.enabled), curDes);
    if (!curDes || ops.length === 0) return;

    let materials;
    try {
        materials = presampleMaterials(curDes, ops);
    } catch (err) {
        console.error('[DLS] Pre-sampling failed, using main-thread fallback:', err);
        runOptMainThread(ctx);
        return;
    }

    const surfMode  = curDes.surfaceMode || 'front_only';
    const layerSide = surfMode === 'back_only' ? 'backLayers' : 'frontLayers';

    ensureBaseline(ctx, curDes);
    bumpRunCount();
    const runLabel = t.refinement.history.run(histRunCount.current);

    const media     = buildMedia(curDes, surfMode);
    const baseFront = serializeLayers(curDes.frontLayers);
    const baseBack  = serializeLayers(curDes.backLayers);

    // Multi-start eligibility — identical rule to runOptMainThread.
    const wantMulti  = !!multiStartRef.current;
    const msEligible = isMultiEligible(surfMode, baseFront.length > 0, baseBack.length > 0);
    const N       = (wantMulti && msEligible) ? Math.max(1, Math.floor(nRestartsRef.current)) : 1;
    const isMulti = wantMulti && msEligible && N > 1;   // N==1 multi ≡ single

    // Whole-run state: config + mutable aggregation, threaded through the
    // module-scope message handlers.
    const S = {
        surfMode, layerSide, isMulti, N,
        pct: Math.max(0, perturbPctRef.current) / 100,
        ops, materials, media, baseFront, baseBack, runLabel,
        maxIter: maxIterRef.current || 500,
        nJobs: isMulti ? N : 1,
        K: isMulti ? Math.max(1, Math.min(N, getThreadCount())) : 1,
        nextJob: 0, completed: 0,
        globalBest: Infinity, globalBestOMF: null,
        finished: false, gotProgress: false, fellBack: false,
        cumIter: 0, prevIterByW: new Map(), widSeq: 0,
    };

    evalBaseline(ctx, S);

    runningRef.current = true;
    setRunning(true);
    setCanReset(true);
    setMfHistory([]);
    setRestartIdx(0);
    lastBestRef.current  = null;
    optimizerRef.current = null;

    startPool(ctx, S);
}
