import { WorkerPool } from '../../../../../utils/workers/workerPool.js';
import { getTmmWasmBytesForWorker } from '../../../../../tmmcore.js';
import { SYNTHESIS_WORKER_URL } from '../../../../../workerUrls.js';
import { createRunState } from './runState.js';
import { buildRunWorker } from './runWorker.js';
import { runLoop } from './loop.js';

// The run's refinements and children go to a pool of synthesis workers. When
// the pool cannot be built the run worker runs them itself, one job after
// another: the same job code on the same data, so the result is the same.
function buildPool(S) {
    try {
        const wasmBytes = getTmmWasmBytesForWorker();
        return new WorkerPool(SYNTHESIS_WORKER_URL, S.threads, wasmBytes ? { type: 'wasmInit', wasmBytes } : null);
    } catch (err) {
        console.warn('[DeepSynthesis] worker pool could not be built, the run worker runs the jobs itself:', err);
        return null;
    }
}

// Start a run on the window's context (runners/lifecycle.js). The run itself
// goes to a worker of its own (runWorker.js); without one it is refused. A
// stopped run whose worker has not ended yet still holds the window, so its
// kept design is written before the next run reads the design.
// Resolves when the run has ended and its result is written.
export function runDeepSynthesisWorker(ctx) {
    if (ctx.runningRef.current || ctx.runWorkerRef.current) return;
    const S = createRunState(ctx);
    if (!S) return;
    S.worker = buildRunWorker(ctx);
    if (!S.worker) return;
    S.workerPool = buildPool(S);
    ctx.poolRef.current = S.workerPool;
    ctx.runningRef.current = true;
    ctx.hist.parts = S.parts;
    ctx.publish({
        running: true, phase: null, step: 0, round: 0, rounds: S.method.search.rounds,
        parts: S.parts, startInfo: null, statusMsg: '',
    });
    return runLoop(ctx, S);
}
