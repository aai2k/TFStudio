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
 *
 * inOptimizerWorker runs any other job of the optimizer worker the same way,
 * with the same Stop: Needle Manual's profile scan and the starting thickness
 * of a picked needle run through it.
 */

import { getTmmWasmBytesForWorker } from '../../../../tmmcore.js';
import { OPTIMIZER_WORKER_URL } from '../../../../workerUrls.js';
import { makeEngine } from '../../../../utils/optimizers/index.js';
import { presampleSynthesisMaterials } from './runGrid.js';

function startWorker() {
    try { return new Worker(OPTIMIZER_WORKER_URL, { type: 'module' }); }
    catch (_) { return null; }
}

/**
 * Runs one job in an optimizer worker of its own: posts `message` with the
 * WASM kernel, and hands each message the worker posts back to `onMessage`,
 * which returns true once the job is over. Resolves true then, when the worker
 * fails, or when `signal` aborts (at once if it already has), and the worker
 * is terminated. Resolves false when no worker starts.
 */
export function inOptimizerWorker(message, { signal, onMessage }) {
    if (signal && signal.aborted) return Promise.resolve(true);
    const worker = startWorker();
    if (!worker) return Promise.resolve(false);
    worker.postMessage({ ...message, wasmBytes: getTmmWasmBytesForWorker() });
    return untilDone(worker, { signal, onMessage });
}

// The job's end in `worker`, for inOptimizerWorker. The message is not in reach
// from here, so its material tables are not held on this thread while the
// worker runs.
function untilDone(worker, { signal, onMessage }) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            worker.terminate();
            if (signal) signal.removeEventListener('abort', finish);
            resolve(true);
        };
        if (signal) signal.addEventListener('abort', finish);
        worker.onmessage = ({ data: m }) => {
            if (!settled && m && onMessage(m)) finish();
        };
        worker.onerror = finish;
    });
}

// Runs `job` in a worker. Resolves when the worker finishes, or when `signal`
// aborts, with the best point it last reported. Resolves null when no worker
// starts, or it fails before reporting a point; the caller then runs the pass
// on its own thread.
export async function refineInWorker(job, { signal, onProgress } = {}) {
    if (signal && signal.aborted) return null;
    const materials = presampleSynthesisMaterials(job.design, job.operands, []);
    let mfInitial = null, best = null;
    const report = (m) => {
        best = { mf: m.mfBest, frontLayers: m.bestFrontLayers, backLayers: m.bestBackLayers };
        if (onProgress) onProgress({ step: m.iter, iters: job.iters, ...best });
    };
    await inOptimizerWorker({
        type: 'start', method: job.method, operands: job.operands, design: job.design, materials,
        opts: { maxIter: job.iters }, engineOpts: { dMin: job.dMin },
    }, {
        signal,
        onMessage: (m) => {
            if (m.type === 'init') mfInitial = m.mfInitial;
            if (m.type === 'progress' || m.type === 'done') report(m);
            return m.type === 'done' || m.type === 'error';
        },
    });
    return best && {
        mfInitial, mfBest: best.mf,
        design: { ...job.design, frontLayers: best.frontLayers, backLayers: best.backLayers },
    };
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
