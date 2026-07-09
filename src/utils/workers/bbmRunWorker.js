/**
 * bbmRunWorker — runs ONE broadband-monitoring manufacturing experiment
 * (`simulateRun`) off the UI thread so the wizard's "Start" never freezes the
 * renderer, even for large stacks where the per-scan thickness fit is costly.
 *
 * Stateless RPC: `postMessage({ design, cfg, materials, seed })` →
 * `postMessage({ type:'done', run })` where `run` is the plain-number trajectory
 * (`asBuiltFront`, `targetFront`, `matDeltas`, `cutTimes`, `rates`,
 * `estimatedFront`, `materialsFront`). The wizard computes the page-5/6 spectra
 * itself from the real material objects it already holds.
 *
 * Cross-thread materials = Approach A pre-sampling: the main thread samples
 * every referenced material's [n,k] on the monitor scan
 * λ grid and ships plain arrays; we rebuild a table-lookup `getNK`. `simulateRun`
 * only ever samples on that scan grid, so the worker math matches the main-thread
 * path for the same seed.
 */

import { simulateRun, mulberry32 } from '../monitoring/monitoringSim.js';

function makeResolveMat(materials) {
    const cache = new Map();
    function build(id) {
        const entry = materials[id] || materials['Air'] || null;
        const map = new Map();
        if (entry && entry.lambdas) {
            for (let i = 0; i < entry.lambdas.length; i++) map.set(entry.lambdas[i], [entry.n[i], entry.k[i]]);
        }
        return {
            _wkrMat: true,
            getNK(lam) {
                const v = map.get(lam);
                return v !== undefined ? v : [1, 0];
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
    if (!job || job.cmd !== 'bbm-run') {
        postMessage({ type: 'error', message: `bbmRunWorker: unknown cmd "${job?.cmd}"` });
        return;
    }
    try {
        const { design, cfg, materials, seed } = job;
        const resolveMat = makeResolveMat(materials);
        const cfgLocal = {
            ...cfg, rng: mulberry32(seed >>> 0), recordTrajectory: true,
            onLayer: (i, n) => postMessage({ type: 'progress', i, n }),
        };
        const run = simulateRun(design, resolveMat, cfgLocal);
        postMessage({ type: 'done', run });
    } catch (err) {
        postMessage({ type: 'error', message: err?.message || String(err) });
    }
};
