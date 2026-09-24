/**
 * The Design Cleaner's post-clean refinement in the optimizer worker, the one
 * the Refinement window runs its methods in, so the window keeps painting and
 * taking input while the steps run. One SQP step on a few hundred layers takes
 * seconds, too long to run between two frames even one step at a time.
 *
 * The worker gets the cleaned design, the operands, and every material sampled
 * on the operands' exact wavelengths, and runs the same engine with the same
 * stopping rule as the main-thread loop (converged, or the step budget).
 */

import { getTmmWasmBytesForWorker } from '../../../../tmmcore.js';
import { OPTIMIZER_WORKER_URL } from '../../../../workerUrls.js';
import { presampleSynthesisMaterials } from '../synthesisShared/runGrid.js';

function startWorker() {
    try { return new Worker(OPTIMIZER_WORKER_URL, { type: 'module' }); }
    catch (_) { return null; }
}

// Runs `job` ({ method, operands, design, iters, dMin }) in a worker. Resolves
// with { mfInitial, mfBest, design } when the worker finishes, or when `signal`
// aborts, with the best point it last reported. Resolves null when no worker
// starts, or it fails before reporting a point; the caller then runs the pass
// on its own thread. `onProgress` gets { step, iters, mf } per worker report.
export function refineInWorker(job, { signal, onProgress } = {}) {
    if (signal && signal.aborted) return Promise.resolve(null);
    const materials = presampleSynthesisMaterials(job.design, job.operands, []);
    const worker = startWorker();
    if (!worker) return Promise.resolve(null);

    return new Promise((resolve) => {
        let mfInitial = null, best = null, settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            worker.terminate();
            if (signal) signal.removeEventListener('abort', finish);
            resolve(best && {
                mfInitial, mfBest: best.mf,
                design: { ...job.design, frontLayers: best.frontLayers, backLayers: best.backLayers },
            });
        };
        const report = (m) => {
            best = { mf: m.mfBest, frontLayers: m.bestFrontLayers, backLayers: m.bestBackLayers };
            if (onProgress) onProgress({ step: m.iter, iters: job.iters, mf: m.mfBest });
        };
        if (signal) signal.addEventListener('abort', finish);
        worker.onmessage = ({ data: m }) => {
            if (settled || !m) return;
            if (m.type === 'init') mfInitial = m.mfInitial;
            if (m.type === 'progress' || m.type === 'done') report(m);
            if (m.type === 'done' || m.type === 'error') finish();
        };
        worker.onerror = finish;
        worker.postMessage({
            type: 'start', method: job.method, operands: job.operands, design: job.design, materials,
            opts: { maxIter: job.iters }, engineOpts: { dMin: job.dMin },
            wasmBytes: getTmmWasmBytesForWorker(),
        });
    });
}
