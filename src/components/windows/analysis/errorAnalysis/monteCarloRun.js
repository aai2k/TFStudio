import { ANALYSIS_EVALUATION_WORKER_URL } from '../../../../workerUrls.js';
import { getTmmWasmBytesForWorker } from '../../../../tmmcore.js';
import { designMaterialLookup, embedDesignMaterials } from '../../../../utils/materials/designMaterials.js';
import { runErrorAnalysisMC } from '../../../../utils/physics/errorAnalysis.js';
import { runMCPool } from '../../../../utils/physics/errorAnalysis/mcPool.js';
import { getThreadCount } from '../../../../utils/synthesis/synthesisConfig.js';

// Time a run on this thread may hold the interface between yields, ms.
const FRAME_MS = 16;

// Progress reaches the window at most this often, ms, and at the last trial:
// a pool adds trials faster than the window redraws.
const PROGRESS_MS = 100;

// A yield the run awaits after every trial, which hands the interface a turn
// once FRAME_MS have passed.
function frameYield() {
    let last = performance.now();
    return async () => {
        if (performance.now() - last < FRAME_MS) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
        last = performance.now();
    };
}

// The run on this thread, where no worker can be made: stop() ends it after
// the trial under way, and `done` resolves to the result of the trials run.
function runHere(design, params, options, onProgress) {
    let stopped = false;
    let keepResult = true;
    const done = runErrorAnalysisMC(design, params, designMaterialLookup(design), {
        ...options,
        yieldEvery: 1,
        onYield: frameYield(),
        shouldCancel: () => stopped,
        onTrial: ({ i, total }) => onProgress({ i, total }),
    }).then(result => (keepResult ? result : null));
    return {
        done,
        stop: ({ keep = true } = {}) => { stopped = true; keepResult = keep; },
    };
}

// onProgress({ i, total }) at most every PROGRESS_MS, and at the last trial.
function throttled(onProgress) {
    let shown = -Infinity;
    return (i, total) => {
        const now = performance.now();
        if (i < total && now - shown < PROGRESS_MS) return;
        shown = now;
        onProgress({ i, total });
    };
}

/**
 * One Monte Carlo run (runErrorAnalysisMC) with its trials spread over
 * `threads` analysis workers (utils/workers/analysisEvaluationWorker.js), the
 * Threads setting by default, so trials whose Specification checks read their
 * band at a fine Step never hold the window. `options` are
 * runErrorAnalysisMC's, plain data only. The result is the one the run gives
 * on this thread with the same seed (physics/errorAnalysis/mcPool.js).
 *
 * stop() ends the run at once and `done` resolves to the result of the trials
 * done so far, the first N: the result of a run of N trials with the same
 * seed; the workers end once they have finished the trial under way.
 * stop({ keep: false }) resolves `done` to null, and so does a stop before
 * the first trial is done. `done` rejects with the run's error. Where
 * no worker can be made, or the workers fail before the first trial is done,
 * the run stays on this thread; a worker that fails later ends the run as
 * Stop does.
 *
 * Returns { done, stop }.
 */
export function startMonteCarloRun(design, params, options, onProgress = () => {}, threads = getThreadCount()) {
    const wasmBytes = getTmmWasmBytesForWorker();
    return runMCPool(embedDesignMaterials(design), params, designMaterialLookup(design), options, {
        size: threads,
        makeWorker: () => new Worker(ANALYSIS_EVALUATION_WORKER_URL, { type: 'module' }),
        initMessage: wasmBytes ? { type: 'wasmInit', wasmBytes } : null,
        onTrial: throttled(onProgress),
        runHere: opts => runHere(design, params, opts, onProgress),
    });
}
