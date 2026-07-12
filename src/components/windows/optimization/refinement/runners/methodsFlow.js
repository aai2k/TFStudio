// Promise-based runners for methods cg / sa / de / all, plus the async
// orchestrator that runs a list of methods from the same baseline and keeps the
// global best. These reuse the validated engines via optimizerWorker (any
// method) and mfEvalWorker (parallel DE).
//
// All are plain functions of the Refinement component's `ctx` bag (see
// mainThread.js); the promise runners additionally take an `alive()` predicate
// so a Stop / run-id bump cancels an in-flight flow.

import { DLSOptimizer } from '../../../../../utils/physics/optimizer.js';
import { DEOptimizer } from '../../../../../utils/optimizers/index.js';
import { WorkerPool } from '../../../../../utils/workers/workerPool.js';
import { getThreadCount } from '../../../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../../../utils/workers/tmmWasm.js';
import { OPTIMIZER_WORKER_URL as WORKER_URL, MFEVAL_WORKER_URL as MFEVAL_URL } from '../../../../../workerUrls.js';
import {
    resolveMat, nowMs, densifyForRun, presampleMaterials, buildPayload, perturbPayload,
} from '../refinementUtils.js';
import { countFreeVars, MAXITER_FOR, METHOD_LABELS } from '../refinementConfig.js';
import { runOptMainThread } from './mainThread.js';

// Single-engine worker run (dls/cg/sa/de-serial). preview=false suppresses
// the live design write (used by multistart restarts, which would thrash it).
function runEngineP(ctx, engine, ops, payload, materials, alive, onProg, preview, maxIterOverride) {
    const { flowWorkersRef, updateDesignRef } = ctx;
    return new Promise((resolve) => {
        let w;
        try { w = new Worker(WORKER_URL, { type: 'module' }); }
        catch (_) { resolve(null); return; }
        flowWorkersRef.current.add(w);
        let best = null;
        const cleanup = () => { try { w.terminate(); } catch (_) {} flowWorkersRef.current.delete(w); };
        w.onmessage = (e) => {
            const m = e.data; if (!m) return;
            if (m.type === 'warn' || m.type === 'init') return;
            if (m.type === 'error') { cleanup(); resolve(best); return; }
            if (m.type === 'progress' || m.type === 'done') {
                const fL = m.bestFrontLayers || m.frontLayers, bL = m.bestBackLayers || m.backLayers;
                best = { mf: (m.mfBest != null ? m.mfBest : m.mf), omf: (m.omfBest != null ? m.omfBest : m.omf), frontLayers: fL, backLayers: bL, iters: m.iter, reason: m.reason };
                if (onProg) onProg(best.mf, best.iters, best.omf);
                if (preview && fL) updateDesignRef.current({ frontLayers: fL, backLayers: bL }, { transient: true });
                if (m.type === 'done') { cleanup(); resolve(best); }
            }
            if (!alive()) { cleanup(); resolve(best); }
        };
        w.onerror = () => { cleanup(); resolve(best); };
        w.postMessage({ type: 'start', method: engine, operands: ops, design: payload, materials, opts: { maxIter: maxIterOverride || MAXITER_FOR[engine] || 500 }, wasmBytes: getTmmWasmBytesForWorker() });
    });
}

// Parallel Differential Evolution (worker POOL of stateless mfEvalWorkers).
async function runParallelDEP(ctx, ops, payload, materials, alive, onProg, maxIterOverride) {
    const { dePoolRef, updateDesignRef } = ctx;
    const K  = getThreadCount();   // global Threads setting
    const deMax = maxIterOverride || MAXITER_FOR.de;
    let pool;
    const wasmBytes = getTmmWasmBytesForWorker();
    try { pool = new WorkerPool(MFEVAL_URL, K, wasmBytes ? { type: 'wasmInit', wasmBytes } : null); } catch (_) { return runEngineP(ctx, 'de', ops, payload, materials, alive, onProg, true, maxIterOverride); }
    dePoolRef.current = pool;
    let de;
    try { de = new DEOptimizer(ops, payload, resolveMat, { maxIter: deMax }); }
    catch (_) { try { pool.terminate(); } catch (e) {} dePoolRef.current = null; return runEngineP(ctx, 'de', ops, payload, materials, alive, onProg, true, maxIterOverride); }
    const sid = Math.random().toString(36).slice(2);
    const MAX = deMax;
    const evalAll = async (trials) => {
        const per = Math.max(1, Math.ceil(trials.length / K));
        const jobs = [], starts = [];
        for (let s = 0; s < trials.length; s += per) { starts.push(s); jobs.push({ type: 'evalBatch', sid, operands: ops, design: payload, materials, vectors: trials.slice(s, s + per) }); }
        const results = await pool.map(jobs);
        const mfs = new Array(trials.length);
        results.forEach((r, ci) => { const st = starts[ci]; (r.mfs || []).forEach((v, k) => { mfs[st + k] = v; }); });
        return mfs;
    };
    let lastPost = 0;
    try {
        while (alive() && !de.isConverged() && de.iter < MAX) {
            const trials = de.produceTrials();
            if (!trials) { de.iter++; break; }
            const mfs = await evalAll(trials);
            if (!alive()) break;
            de.ingestTrials(trials, mfs);
            const t = nowMs();
            if (t - lastPost >= 100) {
                lastPost = t;
                de.restoreBest();
                const upd = de.applyToDesign(payload);
                updateDesignRef.current({ frontLayers: upd.frontLayers, backLayers: upd.backLayers }, { transient: true });
                if (onProg) onProg(de.mfBest, de.iter, de.mfOpticalAt(de.thickBest));
            }
        }
    } catch (err) { console.error('[Refine] parallel DE error:', err); }
    de.restoreBest();
    const upd = de.applyToDesign(payload);
    const deOmf = de.mfOpticalAt(de.thickBest);
    try { pool.terminate(); } catch (_) {} dePoolRef.current = null;
    return { mf: de.mfBest, omf: deOmf, frontLayers: upd.frontLayers, backLayers: upd.backLayers, iters: de.iter };
}

// DLS multi-start as a promise (used inside the 'all' flow). N perturbed
// single-DLS runs in batches of K; keep the best. (Single-method 'dls-multi'
// selection still uses the faster validated event pool, runDlsEvent.)
async function runMultiP(ctx, ops, payload, materials, N, pct, alive, onProg) {
    const { updateDesignRef } = ctx;
    const K  = getThreadCount();   // global Threads setting
    let best = null, done = 0;
    for (let s = 0; s < N && alive(); s += K) {
        const batch = [];
        for (let i = 0; i < K && (s + i) < N; i++) {
            batch.push(runEngineP(ctx, 'dls', ops, perturbPayload(payload, pct, s + i), materials, alive, null, false));
        }
        const results = await Promise.all(batch);
        for (const r of results) {
            done++;
            if (r && (!best || r.mf < best.mf)) {
                best = { ...r };
                if (onProg) onProg(best.mf, done, best.omf);
                updateDesignRef.current({ frontLayers: best.frontLayers, backLayers: best.backLayers }, { transient: true });
            }
        }
    }
    return best;
}

// Async orchestrator for cg / sa / de / all. Each method runs from the SAME
// baseline; the global best across methods is kept and applied at the end.
export async function runMethodsFlow(ctx, methods) {
    const {
        runningRef, designRef, operandsRef, baselineRef, checkpointRef, runIdRef,
        maxIterRef, nRestartsRef, perturbPctRef, updateDesignRef, optimizerRef, lastBestRef,
        commitBaseline, bumpRunCount, addHistEntry,
        setMfInitial, setOmfInitial, setRunning, setCanReset, setMfHistory, setIter,
        setStopReason, setRestartIdx, setMf, setMfBest, setOmf, setOmfBest,
    } = ctx;

    if (runningRef.current) return;
    const curDes = designRef.current;
    const ops    = densifyForRun(operandsRef.current.filter(op => op.enabled), curDes);
    if (!curDes || ops.length === 0) return;
    let materials;
    try { materials = presampleMaterials(curDes, ops); }
    catch (err) { console.error('[Refine] presample failed:', err); runOptMainThread(ctx); return; }

    const payload   = buildPayload(curDes);
    const layerSide = payload.surfaceMode === 'back_only' ? 'backLayers' : 'frontLayers';

    if (!baselineRef.current) {
        checkpointRef.current && checkpointRef.current();
        commitBaseline({ frontLayers: curDes.frontLayers, backLayers: curDes.backLayers });
        baselineRef.current = true;
    }
    let baseMF = Infinity, baseOMF = null;
    try { const b = new DLSOptimizer(ops, payload, resolveMat); baseMF = b.mf; baseOMF = b.mfOpticalAt(b.thicknesses); setMfInitial(b.mf); setOmfInitial(baseOMF); } catch (_) {}

    const myRun = ++runIdRef.current;
    const alive = () => runningRef.current && runIdRef.current === myRun;
    runningRef.current = true; setRunning(true); setCanReset(true);
    setMfHistory([]); setIter(0); setStopReason(null); setRestartIdx(0);
    setMf(baseMF); setMfBest(baseMF); setOmf(baseOMF); setOmfBest(baseOMF);

    let globalBest = { mf: baseMF, omf: baseOMF, frontLayers: payload.frontLayers, backLayers: payload.backLayers, method: null };
    const HW = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;

    const onProg = (mfNow, _iters, omfNow) => {
        const y = Math.min(globalBest.mf, mfNow);
        setMf(mfNow); setMfBest(y);
        if (omfNow != null) setOmf(omfNow);
        setOmfBest(globalBest.omf);
        setMfHistory(prev => [...prev, { iter: prev.length, mf: y }]);
    };

    try {
        // INDEPENDENT: every method runs from the SAME original baseline, so
        // each gets a fair shot and "Try all" surfaces the genuinely best
        // method (not just whichever ran first). A relay variant tended to
        // dip on the first improving method and then stall — the local
        // methods can't escape that basin and the globals have nothing left
        // to improve. We keep the global best and apply it at the end.
        for (const m of methods) {
            if (!alive()) break;
            bumpRunCount();
            if (methods.length > 1) setRestartIdx(methods.indexOf(m) + 1);
            let res;
            // User's Max-iterations field applies to single-method runs; in
            // Try-all ('all') each method keeps its own natural budget.
            const mi = methods.length === 1 ? maxIterRef.current : undefined;
            if (m === 'de' && HW > 2 && countFreeVars(curDes) >= 4)
                res = await runParallelDEP(ctx, ops, payload, materials, alive, onProg, mi);
            else if (m === 'dls-multi')
                res = await runMultiP(ctx, ops, payload, materials, nRestartsRef.current, perturbPctRef.current, alive, onProg);
            else
                res = await runEngineP(ctx, m, ops, payload, materials, alive, onProg, true, mi);
            if (!res) continue;
            const layers = (layerSide === 'backLayers' ? res.backLayers : res.frontLayers) || [];
            addHistEntry({
                id: Math.random().toString(36).slice(2),
                label: METHOD_LABELS[m],
                iter: res.iters || 0, mf: res.mf, omf: res.omf, layers, layerCount: layers.length,
                layerSide,
            });
            if (res.mf < globalBest.mf) {
                globalBest = { mf: res.mf, omf: res.omf, frontLayers: res.frontLayers, backLayers: res.backLayers, method: m };
                setOmfBest(globalBest.omf);
            }
        }
    } catch (err) { console.error('[Refine] method flow error:', err); }

    // Finalize: apply the global best; set a synthetic optimizerRef so Best/Reset work.
    runningRef.current = false; setRunning(false); setRestartIdx(0);
    updateDesignRef.current({ frontLayers: globalBest.frontLayers, backLayers: globalBest.backLayers }, { transient: true });
    lastBestRef.current = { mfBest: globalBest.mf, omf: globalBest.omf, frontLayers: globalBest.frontLayers, backLayers: globalBest.backLayers };
    optimizerRef.current = {
        iter: 0, mf: globalBest.mf, mfBest: globalBest.mf, layerSide,
        applyToDesign: (d) => ({ ...d, frontLayers: globalBest.frontLayers, backLayers: globalBest.backLayers }),
        restoreBest: () => {},
    };
    setMf(globalBest.mf); setMfBest(globalBest.mf); setOmf(globalBest.omf); setOmfBest(globalBest.omf);
    setStopReason(globalBest.mf < 1e-6 ? 'target' : (globalBest.method && methods.length > 1 ? `best: ${METHOD_LABELS[globalBest.method]}` : 'stalled'));
    if (methods.length > 1) console.log(`[Refine] Try-all done: best = ${globalBest.method} (MF=${globalBest.mf.toFixed(6)})`);
}
