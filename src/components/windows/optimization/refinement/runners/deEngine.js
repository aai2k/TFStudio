// Parallel Differential Evolution (worker POOL of stateless mfEvalWorkers) and
// the DLS multi-start-as-a-promise helper, both used by runMethodsFlow (see
// methodsFlow.js). Split out from engineRun.js so the single-engine run and this
// pool-based batching code don't compound into one high-complexity file.

import { DEOptimizer } from '../../../../../utils/optimizers/index.js';
import { WorkerPool } from '../../../../../utils/workers/workerPool.js';
import { getThreadCount } from '../../../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../../../utils/workers/tmmWasm.js';
import { MFEVAL_WORKER_URL as MFEVAL_URL } from '../../../../../workerUrls.js';
import { resolveMat, nowMs, perturbPayload } from '../refinementUtils.js';
import { MAXITER_FOR } from '../refinementConfig.js';
import { runEngineP } from './engineRun.js';

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
// a throttled live-preview push. run carries { ops, payload, materials, sid, K,
// deMax, alive, onProg }.
async function runDeLoop(ctx, de, pool, run) {
    let lastPost = 0;
    while (run.alive() && !de.isConverged() && de.iter < run.deMax) {
        const trials = de.produceTrials();
        if (!trials) { de.iter++; break; }
        const mfs = await deEvalBatch(pool, run, trials);
        if (!run.alive()) break;
        de.ingestTrials(trials, mfs);
        const tnow = nowMs();
        if (tnow - lastPost >= 100) { lastPost = tnow; dePostProgress(ctx, de, run.payload, run.onProg); }
    }
}

// run: { ops, payload, materials, alive, onProg, maxIterOverride }
export async function runParallelDEP(ctx, run) {
    const { ops, payload, materials, alive, onProg, maxIterOverride } = run;
    const K  = getThreadCount();   // global Threads setting
    const deMax = maxIterOverride || MAXITER_FOR.de;
    const serialFallback = () => runEngineP(ctx, 'de', { ops, payload, materials, alive, onProg, preview: true, maxIterOverride });
    const wasmBytes = getTmmWasmBytesForWorker();
    let pool;
    try { pool = new WorkerPool(MFEVAL_URL, K, wasmBytes ? { type: 'wasmInit', wasmBytes } : null); } catch (_) { return serialFallback(); }
    ctx.dePoolRef.current = pool;
    let de;
    try { de = new DEOptimizer(ops, payload, resolveMat, { maxIter: deMax }); }
    catch (_) { try { pool.terminate(); } catch (e) {} ctx.dePoolRef.current = null; return serialFallback(); }

    const cfg = { ops, payload, materials, sid: Math.random().toString(36).slice(2), K, deMax, alive, onProg };
    try { await runDeLoop(ctx, de, pool, cfg); }
    catch (err) { console.error('[Refine] parallel DE error:', err); }

    de.restoreBest();
    const upd = de.applyToDesign(payload);
    const deOmf = de.mfOpticalAt(de.thickBest);
    try { pool.terminate(); } catch (_) {} ctx.dePoolRef.current = null;
    return { mf: de.mfBest, omf: deOmf, frontLayers: upd.frontLayers, backLayers: upd.backLayers, iters: de.iter };
}

// DLS multi-start as a promise (used inside the 'all' flow). N perturbed
// single-DLS runs in batches of K; keep the best. (Single-method 'dls-multi'
// selection still uses the faster validated event pool, runDlsEvent.) run:
// { ops, payload, materials, N, pct, alive, onProg }.
export async function runMultiP(ctx, run) {
    const { ops, payload, materials, N, pct, alive, onProg } = run;
    const K  = getThreadCount();   // global Threads setting
    let best = null, done = 0;
    for (let s = 0; s < N && alive(); s += K) {
        const batch = [];
        for (let i = 0; i < K && (s + i) < N; i++) {
            batch.push(runEngineP(ctx, 'dls', { ops, payload: perturbPayload(payload, pct, s + i), materials, alive, onProg: null, preview: false }));
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
