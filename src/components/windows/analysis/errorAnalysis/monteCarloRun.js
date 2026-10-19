import { ANALYSIS_EVALUATION_WORKER_URL } from '../../../../workerUrls.js';
import { getTmmWasmBytesForWorker } from '../../../../tmmcore.js';
import { designMaterialLookup, embedDesignMaterials } from '../../../../utils/materials/designMaterials.js';
import { runErrorAnalysisMC } from '../../../../utils/physics/errorAnalysis.js';

// Time a run on this thread may hold the interface between yields, ms.
const FRAME_MS = 16;

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

/**
 * One Monte Carlo run (runErrorAnalysisMC) on the analysis worker
 * (utils/workers/analysisEvaluationWorker.js), so trials whose Specification
 * checks read their band at a fine Step never hold the window. `options` are
 * runErrorAnalysisMC's, plain data only.
 *
 * The worker reports progress with the result so far, so stop() ends it at
 * once and `done` resolves to that result: the result of a run of that many
 * trials with the same seed. stop({ keep: false }) resolves `done` to null.
 * `done` also resolves to null when stopped before any trial was reported,
 * and rejects with the run's error. Where no worker can be made, or it fails
 * to load, the run stays on this thread; a worker that fails after reporting
 * ends the run as Stop does.
 *
 * Returns { done, stop }.
 */
export function startMonteCarloRun(design, params, options, onProgress = () => {}) {
    let worker;
    try {
        worker = new Worker(ANALYSIS_EVALUATION_WORKER_URL, { type: 'module' });
    } catch {
        return runHere(design, params, options, onProgress);
    }
    let settle, fail;
    const done = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
    let finished = false;
    let heard = false;
    let here = null;
    let latest = null;
    const trials = [];
    // The result as the worker sent it, with the trial records gathered from
    // every post.
    const assemble = result => (result && options.recordTrials ? { ...result, trials: trials.slice() } : result);
    const finish = (outcome, value) => {
        if (finished) return;
        finished = true;
        worker.terminate();
        outcome(value);
    };

    worker.onmessage = ({ data }) => {
        if (finished || !data) return;
        heard = true;
        for (const trial of data.trials || []) trials.push(trial);
        if (data.type === 'progress') {
            latest = data.result;
            onProgress({ i: data.i, total: data.total });
        } else if (data.type === 'monteCarloDone') {
            onProgress({ i: data.result.nTrials, total: options.nTrials });
            finish(settle, assemble(data.result));
        } else if (data.type === 'error') {
            finish(fail, new Error(data.message));
        }
    };
    worker.onerror = () => {
        if (finished) return;
        if (heard) {
            finish(settle, assemble(latest));
            return;
        }
        finished = true;
        worker.terminate();
        here = runHere(design, params, options, onProgress);
        here.done.then(settle, fail);
    };

    try {
        const wasmBytes = getTmmWasmBytesForWorker();
        if (wasmBytes) worker.postMessage({ type: 'wasmInit', wasmBytes });
        worker.postMessage({ type: 'monteCarlo', design: embedDesignMaterials(design), params, options });
    } catch (error) {
        finish(fail, error);
    }
    return {
        done,
        stop: ({ keep = true } = {}) => (here ? here.stop({ keep }) : finish(settle, keep ? assemble(latest) : null)),
    };
}
