// DLS worker-pool run (methods 'dls' & 'dls-multi') — the validated event-based
// path. Each worker runs ONE single-start DLS off the UI thread; multi-start = a
// POOL (perturbation + global-best aggregation here, workers pull restarts off a
// queue). `multiStartRef` (derived from the method selector) decides single vs
// multi. cg/sa/de/all use runMethodsFlow instead.
//
// A plain function of the Refinement component's `ctx` bag (see mainThread.js).
// The pool's message state machine is a set of module-scope handlers driven off
// a single run-state object `S`, so no giant nested closure builds up.

import { DLSOptimizer, mirrorLayers } from '../../../../../utils/physics/optimizer.js';
import { getThreadCount } from '../../../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../../../utils/workers/tmmWasm.js';
import { OPTIMIZER_WORKER_URL as WORKER_URL } from '../../../../../workerUrls.js';
import { resolveMat, densifyForRun, presampleMaterials } from '../refinementUtils.js';
import { runOptMainThread } from './mainThread.js';

const D_MIN = 1.0, D_MAX = 2000.0;

const serializeLayers = (arr) => (arr || []).map(l => ({
    id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked,
}));

function perturbLayers(layers, pct) {
    return layers.map(l => {
        if (l.locked) return { ...l };
        const base = l.thickness || 0;
        const f    = 1 + pct * (Math.random() * 2 - 1);
        let tt = base * f;
        if (tt < D_MIN) tt = D_MIN;
        if (tt > D_MAX) tt = D_MAX;
        return { ...l, thickness: tt };
    });
}

// Design snapshot for restart r (1-based; r===0 → unperturbed).
function designForRestart(S, r) {
    const { media, baseFront, baseBack, surfMode, pct } = S;
    if (r === 0) return { ...media, frontLayers: baseFront, backLayers: baseBack };
    if (surfMode === 'both_independent')
        return { ...media, frontLayers: perturbLayers(baseFront, pct), backLayers: perturbLayers(baseBack, pct) };
    if (surfMode === 'back_only')
        return { ...media, frontLayers: baseFront, backLayers: perturbLayers(baseBack, pct) };
    if (surfMode === 'symmetric') {
        const fr = perturbLayers(baseFront, pct);
        return { ...media, frontLayers: fr, backLayers: mirrorLayers(fr) };
    }
    return { ...media, frontLayers: perturbLayers(baseFront, pct), backLayers: baseBack };
}

function makeJob(S, r) {
    return {
        type: 'start',
        operands: S.ops,
        design: designForRestart(S, r),
        materials: S.materials,
        opts: { maxIter: S.maxIter },
        wasmBytes: getTmmWasmBytesForWorker(),   // null unless WASM enabled
        restartIdx: S.isMulti ? r : undefined,
        nRestarts:  S.isMulti ? S.N : undefined,
    };
}

// Monotonic cumulative iteration counter across ALL workers/restarts. A pooled
// worker's reported iter resets to 0 when it picks up the next restart, so we
// accumulate per-worker DELTAS instead of summing last-reported iters (which was
// non-monotonic and made the MF-trend plot zig-zag / collapse).
function bumpCum(S, wid, it) {
    const prev = S.prevIterByW.get(wid) ?? 0;
    S.cumIter += (it >= prev) ? (it - prev) : it;   // it < prev ⇒ restart reset
    S.prevIterByW.set(wid, it);
    return S.cumIter;
}

// best = { front, back, iter, mf, omf }
function setSyntheticBest(ctx, S, best) {
    const { front, back, iter, mf, omf } = best;
    ctx.lastBestRef.current = { mfBest: mf, omf: omf ?? null, frontLayers: front, backLayers: back };
    ctx.optimizerRef.current = {
        iter, mf, mfBest: mf, layerSide: S.layerSide,
        applyToDesign: (d) => ({ ...d, frontLayers: front, backLayers: back }),
        restoreBest: () => {},
    };
}

function finalizeRun(ctx, S) {
    if (S.finished) return;
    S.finished = true;
    ctx.runningRef.current = false;
    ctx.setRunning(false);
    ctx.setRestartIdx(0);
    const lb = ctx.lastBestRef.current;
    if (lb) {
        ctx.updateDesignRef.current(
            { frontLayers: lb.frontLayers, backLayers: lb.backLayers }, { transient: true });
        if (S.isMulti) {
            const layers = S.layerSide === 'backLayers' ? lb.backLayers : lb.frontLayers;
            ctx.addHistEntry({
                id: Math.random().toString(36).slice(2),
                label: `${S.runLabel} (×${S.N})`,
                iter:  S.cumIter,
                omf:   lb.omf,
                mf:    lb.mfBest,
                layers,
                layerCount: (layers || []).length,
                layerSide: S.layerSide,
            });
            console.log(`[Multi-start pool] Done: ${S.N} restarts on ${S.K} workers, best MF=${lb.mfBest.toFixed(6)} (mode=${S.surfMode})`);
        } else {
            console.log(`[DLS] done: best MF=${lb.mfBest.toFixed(6)}`);
        }
    }
    ctx.killWorker();
}

// Idempotent — only one fallback ever fires (M6 fix).
function doFallback(ctx, S, why, err) {
    if (S.fellBack) return;
    S.fellBack = true;
    console.error(`[DLS] Worker ${why}, using main-thread fallback:`, err);
    ctx.killWorker();
    ctx.runningRef.current = false;
    runOptMainThread(ctx);
}

function onProgressMsg(ctx, S, m, wid) {
    S.gotProgress = true;
    const ci = bumpCum(S, wid, m.iter);
    ctx.setIter(ci);
    if (m.mfBest != null && m.mfBest < S.globalBest) {
        S.globalBest = m.mfBest;
        S.globalBestOMF = m.omfBest ?? S.globalBestOMF;
        ctx.setMfBest(S.globalBest);
        ctx.setOmfBest(S.globalBestOMF);
        if (m.bestFrontLayers) {
            setSyntheticBest(ctx, S, { front: m.bestFrontLayers, back: m.bestBackLayers, iter: ci, mf: S.globalBest, omf: S.globalBestOMF });
            if (S.isMulti) ctx.updateDesignRef.current(
                { frontLayers: m.bestFrontLayers, backLayers: m.bestBackLayers }, { transient: true });
        }
    }
    if (!S.isMulti) {
        // Single-start: live MF trajectory (per-progress) + live design.
        ctx.setMf(m.mf);
        if (m.omf != null) ctx.setOmf(m.omf);
        ctx.setMfHistory(prev => [...prev, { iter: ci, mf: m.mf }]);
        ctx.updateDesignRef.current(
            { frontLayers: m.frontLayers, backLayers: m.backLayers }, { transient: true });
    } else {
        // Multi-start pool: a point on EVERY progress so the plot renders,
        // plotting best-so-far vs. monotonic cumulative iterations (clean
        // staircase across all restarts).
        const y = (S.globalBest === Infinity) ? m.mf : S.globalBest;
        ctx.setMf(y);
        ctx.setOmf((S.globalBest === Infinity) ? (m.omf ?? null) : S.globalBestOMF);
        ctx.setMfHistory(prev => [...prev, { iter: ci, mf: y }]);
    }
}

function onDoneMsg(ctx, S, w, m, wid) {
    S.gotProgress = true;
    const ci = bumpCum(S, wid, m.iter);
    const mfB = m.mfBest ?? m.mf;
    const omfB = m.omfBest ?? m.omf;
    if (mfB < S.globalBest) {
        S.globalBest = mfB;
        S.globalBestOMF = omfB ?? S.globalBestOMF;
        ctx.setMfBest(S.globalBest);
        ctx.setMf(S.globalBest);
        ctx.setOmfBest(S.globalBestOMF);
        ctx.setOmf(S.globalBestOMF);
        setSyntheticBest(ctx, S, {
            front: m.bestFrontLayers || m.frontLayers,
            back:  m.bestBackLayers  || m.backLayers,
            iter: ci, mf: S.globalBest, omf: S.globalBestOMF,
        });
    }
    S.completed++;
    if (S.isMulti) {
        ctx.setIter(ci);
        ctx.setMfHistory(prev => [...prev, {
            iter: ci, mf: (S.globalBest === Infinity ? mfB : S.globalBest),
        }]);
        ctx.setRestartIdx(S.completed);
    }
    if (S.nextJob < S.nJobs) {
        const r = S.nextJob++;
        w.postMessage(makeJob(S, S.isMulti ? r + 1 : 0));
    } else {
        try { w.terminate(); } catch (_) {}
        ctx.poolRef.current = ctx.poolRef.current.filter(x => x !== w);
        if (S.completed >= S.nJobs) finalizeRun(ctx, S);
    }
}

function onErrorMsg(ctx, S, m) {
    if (!S.gotProgress) doFallback(ctx, S, 'errored before progress', m.message);
    else { console.error('[DLS] Worker error:', m.message); ctx.stopOpt(); }
}

function handleMsg(ctx, S, w, wid, e) {
    const m = e.data;
    if (!m || (!ctx.runningRef.current && !S.finished)) return;   // empty / stale post-stop message
    if (m.type === 'warn')  { console.warn(m.message); return; }
    if (m.type === 'error') { onErrorMsg(ctx, S, m); return; }
    // 'init' is a no-op (mfInitial is computed main-side).
    if (m.type === 'progress') onProgressMsg(ctx, S, m, wid);
    else if (m.type === 'done') onDoneMsg(ctx, S, w, m, wid);
}

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
