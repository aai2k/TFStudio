/**
 * MF batch-evaluator primitive Web Worker (parallel DE).
 *
 * STATELESS RPC runner, WorkerPool-compatible (responds with `{type:'result'}`).
 * It evaluates the merit function for a BATCH of thickness vectors and returns
 * their MFs. This is the parallelism primitive for Differential Evolution: a
 * generation's `popSize` trial-vector evaluations are independent, so the
 * main-thread DE orchestrator (Refinement.js) fans them across a pool of
 * these workers and does the cheap mutation/crossover/selection itself.
 *
 * Determinism: all RNG (mutation/crossover/selection) stays on the main thread;
 * these workers are PURE functions of their input vectors, so seeded DE stays
 * reproducible regardless of worker count, and a parallel generation yields the
 * SAME result as the serial one (synchronous DE — trials built from the old
 * population).
 *
 * The evaluator is a `DLSOptimizer` used only via its pure `mfAt(vec)` helper
 * (identical surface-mode/bounds/material handling as every other engine). It is
 * cached per `sid` (session id) so it is constructed once per worker per DE run,
 * not once per generation. Materials cross via Approach A pre-sampling, with the
 * same exact-λ table-lookup getNK used by optimizerWorker / synthesisWorker.
 */

import { DLSOptimizer } from '../physics/optimizer.js';
import { noteTmmWasmBytes, awaitTmmWasmReady } from './tmmWasm.js';

function makeResolveMat(materials) {
    const cache = new Map();
    let missReported = false;
    function build(id) {
        const entry = materials[id] || materials['Air'] || null;
        const map = new Map();
        let sortedL = null, sortedNK = null;
        if (entry && entry.lambdas) {
            const { lambdas, n, k } = entry;
            for (let i = 0; i < lambdas.length; i++) map.set(lambdas[i], [n[i], k[i]]);
            const idx = lambdas.map((_, i) => i).sort((a, b) => lambdas[a] - lambdas[b]);
            sortedL  = idx.map(i => lambdas[i]);
            sortedNK = idx.map(i => [n[i], k[i]]);
        }
        return {
            _wkrMat: true,
            getNK(lam) {
                const v = map.get(lam);
                if (v !== undefined) return v;
                if (!sortedL || sortedL.length === 0) return [1, 0];
                if (!missReported) {
                    missReported = true;
                    postMessage({ type: 'warn', message:
                        `mfEvalWorker: λ ${lam} not pre-sampled for "${id}" — nearest-λ fallback (not bit-identical)` });
                }
                let lo = 0, hi = sortedL.length - 1;
                while (hi - lo > 1) {
                    const mid = (lo + hi) >> 1;
                    if (sortedL[mid] < lam) lo = mid; else hi = mid;
                }
                return (Math.abs(sortedL[lo] - lam) <= Math.abs(sortedL[hi] - lam)) ? sortedNK[lo] : sortedNK[hi];
            },
        };
    }
    return function resolveMat(id) {
        const key = (id == null || id === '') ? 'Air' : id;
        let s = cache.get(key);
        if (!s) { s = build(key); cache.set(key, s); }
        return s;
    };
}

// Cache the evaluator across generations of the same DE run (same sid).
let CACHE = { sid: null, opt: null };

onmessage = async (e) => {
    const job = e.data;
    if (!job) return;
    if (job.type === 'wasmInit') { noteTmmWasmBytes(job.wasmBytes); return; }
    if (job.type !== 'evalBatch') return;
    try {
        await awaitTmmWasmReady();
        if (CACHE.sid !== job.sid || !CACHE.opt) {
            const resolveMat = makeResolveMat(job.materials || {});
            CACHE = { sid: job.sid, opt: new DLSOptimizer(job.operands, job.design, resolveMat) };
        }
        const opt = CACHE.opt;
        const vectors = job.vectors || [];
        const mfs = new Array(vectors.length);
        for (let i = 0; i < vectors.length; i++) mfs[i] = opt.mfAt(vectors[i]);
        postMessage({ type: 'result', mfs, idx: job.idx });
    } catch (err) {
        postMessage({ type: 'error', message: (err && err.stack) || String(err) });
    }
};
