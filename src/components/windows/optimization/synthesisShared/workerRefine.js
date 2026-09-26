/**
 * A single refinement pass off the UI thread, for the windows that refine a
 * design they have just changed: the Design Cleaner after a cleanup and Needle
 * Manual after an insertion. The pass runs in the optimizer worker, the one
 * the Refinement window runs its methods in, so the window keeps painting and
 * taking input while the steps run. One SQP step on a few hundred layers takes
 * seconds, too long to run between two frames even one step at a time.
 *
 * The worker gets the design, the operands, and every material sampled on the
 * operands' exact wavelengths, and runs the same engine with the same stopping
 * rule as the main-thread loop (converged, or the step budget).
 *
 * A job is { method, operands, design, iters, dMin }. Both runners resolve with
 * { mfInitial, mfBest, design }, the design at the best point, and report
 * progress as { step, iters, mf, frontLayers, backLayers }: the best merit so
 * far and the layers of that best point.
 */

import { getTmmWasmBytesForWorker } from '../../../../tmmcore.js';
import { OPTIMIZER_WORKER_URL } from '../../../../workerUrls.js';
import { makeEngine } from '../../../../utils/optimizers/index.js';
import { presampleSynthesisMaterials } from './runGrid.js';

function startWorker() {
    try { return new Worker(OPTIMIZER_WORKER_URL, { type: 'module' }); }
    catch (_) { return null; }
}

// Runs `job` in a worker. Resolves when the worker finishes, or when `signal`
// aborts, with the best point it last reported. Resolves null when no worker
// starts, or it fails before reporting a point; the caller then runs the pass
// on its own thread.
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
            if (onProgress) onProgress({ step: m.iter, iters: job.iters, ...best });
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

// One macrotask boundary: the browser paints and dispatches input here.
const nextMacrotask = () => new Promise(resolve => setTimeout(resolve, 0));

// The layers at the engine's best point, leaving the engine where it is.
function bestLayers(opt, design) {
    const current = opt.thicknesses;
    opt.thicknesses = opt.thickBest;
    const d = opt.applyToDesign(design);
    opt.thicknesses = current;
    return { frontLayers: d.frontLayers, backLayers: d.backLayers };
}

// The pass on this thread, for when no worker can be started: one step per
// macrotask, so the window repaints and Stop takes effect between steps. The
// stopping rule is the worker's, so a pass nobody stops ends on the same
// thicknesses. Throws if the merit cannot be evaluated.
export async function refineInTicks(job, resolveMat, { signal, onProgress } = {}) {
    const opt = makeEngine(job.method, job.operands, job.design, resolveMat, { dMin: job.dMin });
    const mfInitial = opt.mf;
    const report = step => onProgress
        && onProgress({ step, iters: job.iters, mf: opt.mfBest, ...bestLayers(opt, job.design) });
    report(0);
    for (let i = 0; i < job.iters && !opt.isConverged(); i++) {
        await nextMacrotask();
        if (signal && signal.aborted) break;
        opt.step();
        report(i + 1);
    }
    opt.restoreBest();
    return { mfInitial, mfBest: opt.mfBest, design: opt.applyToDesign(job.design) };
}

// The pass in the worker, or on this thread when no worker starts. Resolves
// null when `signal` aborts before the worker reports its first point: the
// pass is over before it began, and running it here instead would build the
// engine on this thread for nothing.
export async function refineOffThread(job, resolveMat, { signal, onProgress } = {}) {
    const res = await refineInWorker(job, { signal, onProgress });
    if (res || (signal && signal.aborted)) return res;
    return refineInTicks(job, resolveMat, { signal, onProgress });
}
