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

// ── Single-engine worker run (dls/cg/sa/de-serial) ────────────────────────────
// Message handler for one optimizerWorker; mutates st.best and settles the run
// promise via opts.{cleanup,resolve}. preview=false suppresses the live design
// write (used by multistart restarts, which would thrash it).
function engineOnMessage(ctx, st, m, opts) {
    if (!m) return;
    if (m.type === 'warn' || m.type === 'init') return;
    if (m.type === 'error') { opts.cleanup(); opts.resolve(st.best); return; }
    if (m.type === 'progress' || m.type === 'done') {
        const fL = m.bestFrontLayers || m.frontLayers, bL = m.bestBackLayers || m.backLayers;
        st.best = { mf: (m.mfBest != null ? m.mfBest : m.mf), omf: (m.omfBest != null ? m.omfBest : m.omf), frontLayers: fL, backLayers: bL, iters: m.iter, reason: m.reason };
        if (opts.onProg) opts.onProg(st.best.mf, st.best.iters, st.best.omf);
        if (opts.preview && fL) ctx.updateDesignRef.current({ frontLayers: fL, backLayers: bL }, { transient: true });
        if (m.type === 'done') { opts.cleanup(); opts.resolve(st.best); }
    }
    if (!opts.alive()) { opts.cleanup(); opts.resolve(st.best); }
}

function runEngineP(ctx, engine, ops, payload, materials, alive, onProg, preview, maxIterOverride) {
    return new Promise((resolve) => {
        let w;
        try { w = new Worker(WORKER_URL, { type: 'module' }); }
        catch (_) { resolve(null); return; }
        ctx.flowWorkersRef.current.add(w);
        const st = { best: null };
        const cleanup = () => { try { w.terminate(); } catch (_) {} ctx.flowWorkersRef.current.delete(w); };
        const opts = { onProg, preview, alive, cleanup, resolve };
        w.onmessage = (e) => engineOnMessage(ctx, st, e.data, opts);
        w.onerror = () => { cleanup(); resolve(st.best); };
        w.postMessage({ type: 'start', method: engine, operands: ops, design: payload, materials, opts: { maxIter: maxIterOverride || MAXITER_FOR[engine] || 500 }, wasmBytes: getTmmWasmBytesForWorker() });
    });
}

// ── Parallel Differential Evolution (worker POOL of stateless mfEvalWorkers) ───
// Score all trial vectors across the pool, K per batch.
async function deEvalBatch(pool, cfg, trials) {
    const { ops, payload, materials, sid, K } = cfg;
    const per = Math.max(1, Math.ceil(trials.length / K));
    const jobs = [], starts = [];
    for (let s = 0; s < trials.length; s += per) { starts.push(s); jobs.push({ type: 'evalBatch', sid, operands: ops, design: payload, materials, vectors: trials.slice(s, s + per) }); }
    const results = await pool.map(jobs);
    const mfs = new Array(trials.length);
    results.forEach((r, ci) => { const st = starts[ci]; (r.mfs || []).forEach((v, k) => { mfs[st + k] = v; }); });
    return mfs;
}

// Throttled live-preview push of the DE best-so-far.
function dePostProgress(ctx, de, payload, onProg) {
    de.restoreBest();
    const upd = de.applyToDesign(payload);
    ctx.updateDesignRef.current({ frontLayers: upd.frontLayers, backLayers: upd.backLayers }, { transient: true });
    if (onProg) onProg(de.mfBest, de.iter, de.mfOpticalAt(de.thickBest));
}

// The DE generation loop: produce trials → score across the pool → ingest, with
// a throttled live-preview push. cfg carries { ops, payload, materials, sid, K, deMax }.
async function runDeLoop(ctx, de, pool, cfg, alive, onProg) {
    let lastPost = 0;
    while (alive() && !de.isConverged() && de.iter < cfg.deMax) {
        const trials = de.produceTrials();
        if (!trials) { de.iter++; break; }
        const mfs = await deEvalBatch(pool, cfg, trials);
        if (!alive()) break;
        de.ingestTrials(trials, mfs);
        const tnow = nowMs();
        if (tnow - lastPost >= 100) { lastPost = tnow; dePostProgress(ctx, de, cfg.payload, onProg); }
    }
}

async function runParallelDEP(ctx, ops, payload, materials, alive, onProg, maxIterOverride) {
    const K  = getThreadCount();   // global Threads setting
    const deMax = maxIterOverride || MAXITER_FOR.de;
    const serialFallback = () => runEngineP(ctx, 'de', ops, payload, materials, alive, onProg, true, maxIterOverride);
    const wasmBytes = getTmmWasmBytesForWorker();
    let pool;
    try { pool = new WorkerPool(MFEVAL_URL, K, wasmBytes ? { type: 'wasmInit', wasmBytes } : null); } catch (_) { return serialFallback(); }
    ctx.dePoolRef.current = pool;
    let de;
    try { de = new DEOptimizer(ops, payload, resolveMat, { maxIter: deMax }); }
    catch (_) { try { pool.terminate(); } catch (e) {} ctx.dePoolRef.current = null; return serialFallback(); }

    const cfg = { ops, payload, materials, sid: Math.random().toString(36).slice(2), K, deMax };
    try { await runDeLoop(ctx, de, pool, cfg, alive, onProg); }
    catch (err) { console.error('[Refine] parallel DE error:', err); }

    de.restoreBest();
    const upd = de.applyToDesign(payload);
    const deOmf = de.mfOpticalAt(de.thickBest);
    try { pool.terminate(); } catch (_) {} ctx.dePoolRef.current = null;
    return { mf: de.mfBest, omf: deOmf, frontLayers: upd.frontLayers, backLayers: upd.backLayers, iters: de.iter };
}

// DLS multi-start as a promise (used inside the 'all' flow). N perturbed
// single-DLS runs in batches of K; keep the best. (Single-method 'dls-multi'
// selection still uses the faster validated event pool, runDlsEvent.)
async function runMultiP(ctx, ops, payload, materials, N, pct, alive, onProg) {
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
                ctx.updateDesignRef.current({ frontLayers: best.frontLayers, backLayers: best.backLayers }, { transient: true });
            }
        }
    }
    return best;
}

// ── Async orchestrator for cg / sa / de / all ─────────────────────────────────
// Pick + run the engine for method m (F bundles the shared run config).
function runMethodOnce(ctx, m, F) {
    const mi = F.singleMethod ? ctx.maxIterRef.current : undefined;
    if (m === 'de' && F.HW > 2 && countFreeVars(F.curDes) >= 4)
        return runParallelDEP(ctx, F.ops, F.payload, F.materials, F.alive, F.onProg, mi);
    if (m === 'dls-multi')
        return runMultiP(ctx, F.ops, F.payload, F.materials, ctx.nRestartsRef.current, ctx.perturbPctRef.current, F.alive, F.onProg);
    return runEngineP(ctx, m, F.ops, F.payload, F.materials, F.alive, F.onProg, true, mi);
}

// Record one method's result: append a history row; track the global best.
function recordMethodResult(ctx, F, m, res, best) {
    const layers = (F.layerSide === 'backLayers' ? res.backLayers : res.frontLayers) || [];
    ctx.addHistEntry({
        id: Math.random().toString(36).slice(2),
        label: METHOD_LABELS[m],
        iter: res.iters || 0, mf: res.mf, omf: res.omf, layers, layerCount: layers.length,
        layerSide: F.layerSide,
    });
    if (res.mf < best.cur.mf) {
        best.cur = { mf: res.mf, omf: res.omf, frontLayers: res.frontLayers, backLayers: res.backLayers, method: m };
        ctx.setOmfBest(best.cur.omf);
    }
}

// Apply the global best; set a synthetic optimizerRef so Best/Reset work.
function finalizeMethodsFlow(ctx, F, gb, methods) {
    ctx.runningRef.current = false; ctx.setRunning(false); ctx.setRestartIdx(0);
    ctx.updateDesignRef.current({ frontLayers: gb.frontLayers, backLayers: gb.backLayers }, { transient: true });
    ctx.lastBestRef.current = { mfBest: gb.mf, omf: gb.omf, frontLayers: gb.frontLayers, backLayers: gb.backLayers };
    ctx.optimizerRef.current = {
        iter: 0, mf: gb.mf, mfBest: gb.mf, layerSide: F.layerSide,
        applyToDesign: (d) => ({ ...d, frontLayers: gb.frontLayers, backLayers: gb.backLayers }),
        restoreBest: () => {},
    };
    ctx.setMf(gb.mf); ctx.setMfBest(gb.mf); ctx.setOmf(gb.omf); ctx.setOmfBest(gb.omf);
    ctx.setStopReason(gb.mf < 1e-6 ? 'target' : (gb.method && methods.length > 1 ? `best: ${METHOD_LABELS[gb.method]}` : 'stalled'));
    if (methods.length > 1) console.log(`[Refine] Try-all done: best = ${gb.method} (MF=${gb.mf.toFixed(6)})`);
}

// Take the run checkpoint/baseline once, then evaluate the unperturbed start as
// the seed for the global best. Returns { baseMF, baseOMF }.
function seedBaseline(ctx, curDes, ops, payload) {
    if (!ctx.baselineRef.current) {
        ctx.checkpointRef.current && ctx.checkpointRef.current();
        ctx.commitBaseline({ frontLayers: curDes.frontLayers, backLayers: curDes.backLayers });
        ctx.baselineRef.current = true;
    }
    let baseMF = Infinity, baseOMF = null;
    try {
        const b = new DLSOptimizer(ops, payload, resolveMat);
        baseMF = b.mf; baseOMF = b.mfOpticalAt(b.thicknesses);
        ctx.setMfInitial(b.mf); ctx.setOmfInitial(baseOMF);
    } catch (_) {}
    return { baseMF, baseOMF };
}

// Each method runs from the SAME baseline; the global best across methods is
// kept and applied at the end. INDEPENDENT (not a relay): a relay variant tended
// to dip on the first improving method and then stall — the local methods can't
// escape that basin and the globals have nothing left to improve.
export async function runMethodsFlow(ctx, methods) {
    if (ctx.runningRef.current) return;
    const curDes = ctx.designRef.current;
    const ops    = densifyForRun(ctx.operandsRef.current.filter(op => op.enabled), curDes);
    if (!curDes || ops.length === 0) return;
    let materials;
    try { materials = presampleMaterials(curDes, ops); }
    catch (err) { console.error('[Refine] presample failed:', err); runOptMainThread(ctx); return; }

    const payload   = buildPayload(curDes);
    const layerSide = payload.surfaceMode === 'back_only' ? 'backLayers' : 'frontLayers';

    const { baseMF, baseOMF } = seedBaseline(ctx, curDes, ops, payload);

    const myRun = ++ctx.runIdRef.current;
    const alive = () => ctx.runningRef.current && ctx.runIdRef.current === myRun;
    ctx.runningRef.current = true; ctx.setRunning(true); ctx.setCanReset(true);
    ctx.setMfHistory([]); ctx.setIter(0); ctx.setStopReason(null); ctx.setRestartIdx(0);
    ctx.setMf(baseMF); ctx.setMfBest(baseMF); ctx.setOmf(baseOMF); ctx.setOmfBest(baseOMF);

    const best = { cur: { mf: baseMF, omf: baseOMF, frontLayers: payload.frontLayers, backLayers: payload.backLayers, method: null } };
    const F = {
        ops, payload, materials, layerSide, curDes, alive,
        singleMethod: methods.length === 1,
        HW: (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4,
        onProg: (mfNow, _iters, omfNow) => {
            const y = Math.min(best.cur.mf, mfNow);
            ctx.setMf(mfNow); ctx.setMfBest(y);
            if (omfNow != null) ctx.setOmf(omfNow);
            ctx.setOmfBest(best.cur.omf);
            ctx.setMfHistory(prev => [...prev, { iter: prev.length, mf: y }]);
        },
    };

    try {
        for (const m of methods) {
            if (!alive()) break;
            ctx.bumpRunCount();
            if (methods.length > 1) ctx.setRestartIdx(methods.indexOf(m) + 1);
            const res = await runMethodOnce(ctx, m, F);
            if (res) recordMethodResult(ctx, F, m, res, best);
        }
    } catch (err) { console.error('[Refine] method flow error:', err); }

    finalizeMethodsFlow(ctx, F, best.cur, methods);
}
