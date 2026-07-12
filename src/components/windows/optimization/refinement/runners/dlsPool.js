// DLS worker-pool run (methods 'dls' & 'dls-multi') — the validated event-based
// path. Each worker runs ONE single-start DLS off the UI thread; multi-start = a
// POOL (perturbation + global-best aggregation here, workers pull restarts off a
// queue). `multiStartRef` (derived from the method selector) decides single vs
// multi. cg/sa/de/all use runMethodsFlow instead.
//
// A plain function of the Refinement component's `ctx` bag (see mainThread.js).

import { DLSOptimizer, mirrorLayers } from '../../../../../utils/physics/optimizer.js';
import { getThreadCount } from '../../../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../../../utils/workers/tmmWasm.js';
import { OPTIMIZER_WORKER_URL as WORKER_URL } from '../../../../../workerUrls.js';
import { resolveMat, densifyForRun, presampleMaterials } from '../refinementUtils.js';
import { runOptMainThread } from './mainThread.js';

export function runDlsEvent(ctx) {
    const {
        runningRef, designRef, operandsRef, baselineRef, checkpointRef,
        multiStartRef, nRestartsRef, perturbPctRef, maxIterRef,
        updateDesignRef, optimizerRef, lastBestRef, poolRef,
        commitBaseline, bumpRunCount, addHistEntry, killWorker, stopOpt, histRunCount, t,
        setMfInitial, setMfBest, setMf, setOmfInitial, setOmfBest, setOmf,
        setRunning, setCanReset, setMfHistory, setRestartIdx, setIter,
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

    if (!baselineRef.current) {
        checkpointRef.current && checkpointRef.current();
        commitBaseline({ frontLayers: curDes.frontLayers, backLayers: curDes.backLayers });
        baselineRef.current = true;
    }
    bumpRunCount();
    const runLabel = t.refinement.history.run(histRunCount.current);

    const mkLayers = (arr) => (arr || []).map(l => ({
        id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked,
    }));
    const media = {
        surfaceMode:    surfMode,
        mfEvalMode:     curDes.mfEvalMode ?? 'side',
        incidentMedium: curDes.incidentMedium ?? 'Air',
        exitMedium:     curDes.exitMedium ?? 'Air',
        substrate: {
            material:  curDes.substrate?.material ?? 'BK7',
            thickness: curDes.substrate?.thickness ?? 1.0,
        },
        // Cone-angle averaging — ship to the worker so the pool
        // refinement is cone-averaged identically to the main-thread eval.
        ...(curDes.cone ? { cone: curDes.cone } : {}),
    };
    const baseFront = mkLayers(curDes.frontLayers);
    const baseBack  = mkLayers(curDes.backLayers);

    // Multi-start eligibility — identical rule to runOptMainThread.
    const hasFront   = baseFront.length > 0;
    const hasBack    = baseBack.length  > 0;
    const wantMulti  = !!multiStartRef.current;
    const msEligible = (surfMode === 'back_only')
        ? hasBack
        : (surfMode === 'both_independent' ? (hasFront || hasBack) : hasFront);
    const N       = (wantMulti && msEligible) ? Math.max(1, Math.floor(nRestartsRef.current)) : 1;
    const isMulti = wantMulti && msEligible && N > 1;   // N==1 multi ≡ single
    const pct     = Math.max(0, perturbPctRef.current) / 100;
    const D_MIN = 1.0, D_MAX = 2000.0;

    const perturb = (layers) => layers.map(l => {
        if (l.locked) return { ...l };
        const base = l.thickness || 0;
        const f    = 1 + pct * (Math.random() * 2 - 1);
        let tt = base * f;
        if (tt < D_MIN) tt = D_MIN;
        if (tt > D_MAX) tt = D_MAX;
        return { ...l, thickness: tt };
    });

    // Design snapshot for restart r (1-based; r===0 → unperturbed).
    const designForRestart = (r) => {
        if (r === 0) return { ...media, frontLayers: baseFront, backLayers: baseBack };
        if (surfMode === 'both_independent')
            return { ...media, frontLayers: perturb(baseFront), backLayers: perturb(baseBack) };
        if (surfMode === 'back_only')
            return { ...media, frontLayers: baseFront, backLayers: perturb(baseBack) };
        if (surfMode === 'symmetric') {
            const fr = perturb(baseFront);
            return { ...media, frontLayers: fr, backLayers: mirrorLayers(fr) };
        }
        return { ...media, frontLayers: perturb(baseFront), backLayers: baseBack };
    };

    // Baseline (unperturbed) MF reference — one cheap main-thread eval,
    // independent of which worker reports first.
    try {
        const baseOpt = new DLSOptimizer(ops, designForRestart(0), resolveMat);
        setMfInitial(baseOpt.mf);
        setMfBest(isMulti ? null : baseOpt.mfBest);
        setMf(baseOpt.mf);
        const baseOmf = baseOpt.mfOpticalAt(baseOpt.thicknesses);
        setOmfInitial(baseOmf);
        setOmfBest(isMulti ? null : baseOmf);
        setOmf(baseOmf);
    } catch (err) {
        console.error('[DLS] baseline eval failed:', err);
        setMfInitial(null); setMfBest(null); setOmfInitial(null); setOmfBest(null);
    }

    const nJobs = isMulti ? N : 1;
    // Worker count = global Threads setting (multi-start needs at most nJobs).
    const K  = isMulti ? Math.max(1, Math.min(nJobs, getThreadCount())) : 1;

    runningRef.current = true;
    setRunning(true);
    setCanReset(true);
    setMfHistory([]);
    setRestartIdx(0);
    lastBestRef.current  = null;
    optimizerRef.current = null;

    let gotProgress = false;
    let nextJob     = 0;          // next 0-based restart slot to dispatch
    let completed   = 0;          // restarts finished
    let globalBest  = Infinity;
    let globalBestOMF = null;     // optical merit of the global-best (display only)
    let finished    = false;
    // Monotonic cumulative iteration counter across ALL workers/restarts.
    // A pooled worker's reported iter resets to 0 when it picks up the
    // next restart, so we accumulate per-worker DELTAS instead of summing
    // last-reported iters (which was non-monotonic and made the MF-trend
    // plot zig-zag / collapse).
    const prevIterByW = new Map();    // wid → last reported iter
    let cumIter = 0;
    const bumpCum = (wid, it) => {
        const prev = prevIterByW.get(wid) ?? 0;
        cumIter += (it >= prev) ? (it - prev) : it;   // it < prev ⇒ restart reset
        prevIterByW.set(wid, it);
        return cumIter;
    };

    const setSyntheticBest = (front, back, iterN, mfB, omfB) => {
        lastBestRef.current = { mfBest: mfB, omf: omfB ?? null, frontLayers: front, backLayers: back };
        optimizerRef.current = {
            iter: iterN, mf: mfB, mfBest: mfB, layerSide,
            applyToDesign: (d) => ({ ...d, frontLayers: front, backLayers: back }),
            restoreBest: () => {},
        };
    };

    const finalize = () => {
        if (finished) return;
        finished = true;
        runningRef.current = false;
        setRunning(false);
        setRestartIdx(0);
        const lb = lastBestRef.current;
        if (lb) {
            updateDesignRef.current(
                { frontLayers: lb.frontLayers, backLayers: lb.backLayers }, { transient: true });
            if (isMulti) {
                const layers = layerSide === 'backLayers' ? lb.backLayers : lb.frontLayers;
                addHistEntry({
                    id: Math.random().toString(36).slice(2),
                    label: `${runLabel} (×${N})`,
                    iter:  cumIter,
                    omf:   lb.omf,
                    mf:    lb.mfBest,
                    layers,
                    layerCount: (layers || []).length,
                    layerSide,
                });
                console.log(`[Multi-start pool] Done: ${N} restarts on ${K} workers, best MF=${lb.mfBest.toFixed(6)} (mode=${surfMode})`);
            } else {
                console.log(`[DLS] done: best MF=${lb.mfBest.toFixed(6)}`);
            }
        }
        killWorker();
    };

    let fellBack = false;
    const fallback = (why, err) => {
        if (fellBack) return;   // idempotent — only one fallback ever fires (M6 fix)
        fellBack = true;
        console.error(`[DLS] Worker ${why}, using main-thread fallback:`, err);
        killWorker();
        runningRef.current = false;
        runOptMainThread(ctx);
    };

    const makeJob = (r) => ({
        type: 'start',
        operands: ops,
        design: designForRestart(r),
        materials,
        opts: { maxIter: maxIterRef.current || 500 },
        wasmBytes: getTmmWasmBytesForWorker(),   // null unless WASM enabled
        restartIdx: isMulti ? r : undefined,
        nRestarts:  isMulti ? N : undefined,
    });

    const onMsg = (w, wid) => (e) => {
        const m = e.data;
        if (!m) return;
        if (!runningRef.current && !finished) return;   // stale post-stop message
        if (m.type === 'warn') { console.warn(m.message); return; }
        if (m.type === 'error') {
            if (!gotProgress) fallback('errored before progress', m.message);
            else { console.error('[DLS] Worker error:', m.message); stopOpt(); }
            return;
        }
        if (m.type === 'init') return;   // mfInitial computed main-side

        if (m.type === 'progress') {
            gotProgress = true;
            const ci = bumpCum(wid, m.iter);
            setIter(ci);
            if (m.mfBest != null && m.mfBest < globalBest) {
                globalBest = m.mfBest;
                globalBestOMF = m.omfBest ?? globalBestOMF;
                setMfBest(globalBest);
                setOmfBest(globalBestOMF);
                if (m.bestFrontLayers) {
                    setSyntheticBest(m.bestFrontLayers, m.bestBackLayers, ci, globalBest, globalBestOMF);
                    if (isMulti) updateDesignRef.current(
                        { frontLayers: m.bestFrontLayers, backLayers: m.bestBackLayers }, { transient: true });
                }
            }
            if (!isMulti) {
                // Single-start: live MF trajectory (per-progress) + live design.
                setMf(m.mf);
                if (m.omf != null) setOmf(m.omf);
                setMfHistory(prev => [...prev, { iter: ci, mf: m.mf }]);
                updateDesignRef.current(
                    { frontLayers: m.frontLayers, backLayers: m.backLayers }, { transient: true });
            } else {
                // Multi-start pool: a point on EVERY progress so the plot
                // renders, plotting best-so-far vs. monotonic cumulative
                // iterations (clean staircase across all restarts).
                const y = (globalBest === Infinity) ? m.mf : globalBest;
                setMf(y);
                setOmf((globalBest === Infinity) ? (m.omf ?? null) : globalBestOMF);
                setMfHistory(prev => [...prev, { iter: ci, mf: y }]);
            }
            return;
        }

        if (m.type === 'done') {
            gotProgress = true;
            const ci = bumpCum(wid, m.iter);
            const mfB = m.mfBest ?? m.mf;
            const omfB = m.omfBest ?? m.omf;
            if (mfB < globalBest) {
                globalBest = mfB;
                globalBestOMF = omfB ?? globalBestOMF;
                setMfBest(globalBest);
                setMf(globalBest);
                setOmfBest(globalBestOMF);
                setOmf(globalBestOMF);
                setSyntheticBest(
                    m.bestFrontLayers || m.frontLayers,
                    m.bestBackLayers  || m.backLayers,
                    ci, globalBest, globalBestOMF);
            }
            completed++;
            if (isMulti) {
                setIter(ci);
                setMfHistory(prev => [...prev, {
                    iter: ci, mf: (globalBest === Infinity ? mfB : globalBest),
                }]);
                setRestartIdx(completed);
            }
            if (nextJob < nJobs) {
                const r = nextJob++;
                w.postMessage(makeJob(isMulti ? r + 1 : 0));
            } else {
                try { w.terminate(); } catch (_) {}
                poolRef.current = poolRef.current.filter(x => x !== w);
                if (completed >= nJobs) finalize();
            }
            return;
        }
    };

    const spawn = () => {
        let w;
        try { w = new Worker(WORKER_URL, { type: 'module' }); }
        catch (_) { return null; }
        const wid = Math.random().toString(36).slice(2);
        prevIterByW.set(wid, 0);
        w.onmessage = onMsg(w, wid);
        w.onerror = (e) => {
            if (!gotProgress) fallback('threw before progress', e.message || e);
            else { console.error('[DLS] Worker onerror:', e.message || e); stopOpt(); }
        };
        return w;
    };

    const workers = [];
    for (let i = 0; i < K && nextJob < nJobs; i++) {
        const w = spawn();
        if (!w) { if (i === 0) { fallback('construction failed', 'new Worker threw'); return; } break; }
        workers.push(w);
    }
    if (workers.length === 0) { fallback('construction failed', 'no workers'); return; }
    poolRef.current = workers;
    for (const w of workers) {
        if (nextJob >= nJobs) break;
        const r = nextJob++;
        w.postMessage(makeJob(isMulti ? r + 1 : 0));
    }
}
