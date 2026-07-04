/**
 * Monte-Carlo Web Worker — runs a chunk of monitoring simulator trials off the
 * UI thread (BBM today, MMS once its sim module lands).
 *
 * Stateless RPC: each `postMessage(job)` runs `job.runCount` independent trials
 * starting at `job.runStart`, posts one `{type:'tick', kind:'trial', runIdx,
 * trial}` per completed trial, and resolves with `{type:'done', runStart,
 * runCount}` when the chunk is finished. Workers carry no state between calls —
 * `WorkerPool` (utils/workerPool.js) hands out and recycles them.
 *
 * Cross-thread materials = Approach A pre-sampled: the main thread samples
 * every referenced material's [n,k] on the union of all λ values the chunk
 * will touch (`requiredLambdasBBM`) and ships plain arrays. We rebuild a
 * table-lookup `getNK` so the worker math is bit-identical to the serial
 * `runMonteCarloBBM` path for the same per-trial RNG seed.
 *
 * Per-trial determinism: the orchestrator passes a `seedBase`; this file
 * derives a per-trial seed via `deriveSeed(seedBase, runIdx)` (the same helper
 * the serial path uses), so a given (seedBase, runIdx) pair always produces
 * the same trial regardless of which worker runs it. That's what makes
 * `tests/mc_worker_equivalence.mjs` able to compare serial vs parallel.
 *
 * Cancellation: main thread calls `pool.terminate()`; the worker dies between
 * trials. No graceful-stop flag needed.
 */

import {
    runOneTrialBBM,
    mulberry32,
    deriveSeed,
} from '../monitoring/monitoringSim.js';
import { runOneTrialMMS } from '../monitoring/monoMonitoringSim.js';

// Table-lookup material factory (same pattern as optimizerWorker.js).
// Exact float-key lookup; nearest-λ fallback only as defense-in-depth.
function makeResolveMat(materials) {
    const cache = new Map();
    let missReported = false;

    function build(id) {
        const entry = materials[id] || materials['Air'] || null;
        const map = new Map();
        let sortedL = null, sortedNK = null;
        if (entry && entry.lambdas) {
            const { lambdas, n, k } = entry;
            for (let i = 0; i < lambdas.length; i++) {
                map.set(lambdas[i], [n[i], k[i]]);
            }
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
                    postMessage({
                        type: 'warn',
                        message: `mcWorker: λ ${lam} not pre-sampled for "${id}" `
                               + `— nearest-λ fallback used (centralized-λ guard violated; results no longer bit-identical)`,
                    });
                }
                let lo = 0, hi = sortedL.length - 1;
                while (hi - lo > 1) {
                    const mid = (lo + hi) >> 1;
                    if (sortedL[mid] < lam) lo = mid; else hi = mid;
                }
                return (Math.abs(sortedL[lo] - lam) <= Math.abs(sortedL[hi] - lam))
                    ? sortedNK[lo] : sortedNK[hi];
            },
        };
    }

    return function resolveMat(id) {
        const key = (id == null || id === '') ? 'Air' : id;
        let stub = cache.get(key);
        if (!stub) { stub = build(key); cache.set(key, stub); }
        return stub;
    };
}

self.onmessage = (e) => {
    const job = e.data;
    if (!job || (job.cmd !== 'bbm' && job.cmd !== 'mms')) {
        postMessage({ type: 'error', message: `mcWorker: unknown cmd "${job?.cmd}"` });
        return;
    }
    try {
        const {
            materials, design, cfg, operands,
            displayCtx, runStart, runCount, seedBase,
        } = job;

        const resolveMat = makeResolveMat(materials);
        const displayCtxLocal = {
            lambdas: Float64Array.from(displayCtx.lambdas),
            theta:   displayCtx.theta,
            pol:     displayCtx.pol,
            char:    displayCtx.char,
        };
        const runOne = job.cmd === 'mms' ? runOneTrialMMS : runOneTrialBBM;

        for (let k = 0; k < runCount; k++) {
            const runIdx = runStart + k;
            const rng = mulberry32(deriveSeed(seedBase, runIdx));
            const trial = runOne(design, resolveMat, cfg, rng, displayCtxLocal, operands || []);
            postMessage({ type: 'tick', kind: 'trial', runIdx, trial });
        }

        postMessage({ type: 'done', runStart, runCount });
    } catch (err) {
        postMessage({ type: 'error', message: err?.message || String(err) });
    }
};
