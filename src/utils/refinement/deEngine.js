// Parallel Differential Evolution (a pool of stateless MF-evaluation workers)
// and the DLS multi-start as a promise, both used by the method flow
// (methodsFlow.js).

import { DEOptimizer } from '../optimizers/index.js';
import { designMaterialLookup } from '../materials/designMaterials.js';
import { MAXITER_FOR } from './methods.js';
import { perturbPayload, restartRng } from './restarts.js';
import { runEngineP } from './engineRun.js';

const nowMs = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

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
function dePostProgress(R, de, payload, onProg) {
    de.restoreBest();
    const upd = de.applyToDesign(payload);
    R.onProgress({ design: { frontLayers: upd.frontLayers, backLayers: upd.backLayers } });
    if (onProg) onProg(de.mfBest, de.iter, de.mfOpticalAt(de.thickBest));
}

// The DE generation loop: produce trials → score across the pool → ingest, with
// a throttled live-preview push. run carries { ops, payload, materials, sid, K,
// deMax, alive, onProg }.
async function runDeLoop(R, de, pool, run) {
    let lastPost = 0;
    while (run.alive() && !de.isConverged() && de.iter < run.deMax) {
        const trials = de.produceTrials();
        if (!trials) { de.iter++; break; }
        const mfs = await deEvalBatch(pool, run, trials);
        if (!run.alive()) break;
        de.ingestTrials(trials, mfs);
        const tnow = nowMs();
        if (tnow - lastPost >= 100) { lastPost = tnow; dePostProgress(R, de, run.payload, run.onProg); }
    }
}

// run: { ops, payload, materials, alive, onProg, maxIterOverride, seed }. The
// population and every trial are drawn from `seed` on this thread, so the run
// replays whatever the pool size. A pool that cannot be built, or a DE that
// cannot be set up, falls back to the serial DE engine in one optimizer worker.
export async function runParallelDEP(R, run) {
    const { ops, payload, materials, alive, onProg, maxIterOverride, seed } = run;
    const K = R.plan.threads;
    const deMax = maxIterOverride || MAXITER_FOR.de;
    const serialFallback = () => runEngineP(R, 'de', { ops, payload, materials, alive, onProg, preview: true, maxIterOverride, seed });
    let pool;
    try { pool = R.makeEvalPool(K); } catch (_) { return serialFallback(); }
    const untrack = R.track(() => pool.terminate());
    let de;
    try {
        de = new DEOptimizer(
            ops, payload, designMaterialLookup(R.design), { maxIter: deMax, seed });
    }
    catch (_) { try { pool.terminate(); } catch (e) {} untrack(); return serialFallback(); }

    const cfg = { ops, payload, materials, sid: Math.random().toString(36).slice(2), K, deMax, alive, onProg };
    try { await runDeLoop(R, de, pool, cfg); }
    catch (err) { console.error('[Refine] parallel DE error:', err); }

    de.restoreBest();
    const upd = de.applyToDesign(payload);
    const deOmf = de.mfOpticalAt(de.thickBest);
    if (onProg) onProg(de.mfBest, de.iter, deOmf);
    try { pool.terminate(); } catch (_) {}
    untrack();
    return {
        mf: de.mfBest, omf: deOmf, frontLayers: upd.frontLayers, backLayers: upd.backLayers, iters: de.iter,
        reason: de.isConverged() ? 'converged' : 'maxiter',
    };
}

// DLS multi-start as a promise (used inside a method list). N perturbed
// single-DLS runs in batches of K; keep the best. (A run of 'dls-multi' alone
// takes the DLS worker pool, runDlsPool.) run: { ops, payload, materials, N,
// pct, alive, onProg, seed }.
function makeMultiBatch(R, run, start, count) {
    const batch = [];
    for (let i = 0; i < count && start + i < run.N; i++) {
        const restart = start + i;
        batch.push(runEngineP(R, 'dls', {
            ops: run.ops, payload: perturbPayload(run.payload, run.pct, restart, restartRng(run.seed, restart)),
            materials: run.materials, alive: run.alive, onProg: null, preview: false,
        }));
    }
    return batch;
}

function collectMultiResult(R, state, result, onProg) {
    if (!result) return;
    const n = Number(result.iters);
    state.totalIters += Number.isFinite(n) ? Math.max(0, n) : 0;
    if (!state.best || result.mf < state.best.mf) {
        state.best = { ...result };
        R.onProgress({ design: { frontLayers: state.best.frontLayers, backLayers: state.best.backLayers } });
    }
    if (onProg && state.best) onProg(state.best.mf, state.totalIters, state.best.omf);
}

export async function runMultiP(R, run) {
    const K = R.plan.threads;
    const state = { best: null, totalIters: 0 };
    for (let start = 0; start < run.N && run.alive(); start += K) {
        const results = await Promise.all(makeMultiBatch(R, run, start, K));
        for (const result of results) collectMultiResult(R, state, result, run.onProg);
    }
    return state.best && { ...state.best, iters: state.totalIters };
}
