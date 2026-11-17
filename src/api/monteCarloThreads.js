// Monte Carlo trials on worker threads (monteCarloThread.js), each with a
// kernel of its own, spread as the Monte Carlo window spreads them over its
// workers (utils/physics/errorAnalysis/mcPool.js), for a run long enough to
// gain from them on the app's own runtime: the result is the one the run
// gives on one thread with the same seed. Elsewhere, or where no thread
// starts, the run is made on the calling thread.

import os from 'node:os';
import { ApiThread, onAppRuntime } from './apiThread.js';
import { runErrorAnalysisMC } from '../utils/physics/errorAnalysis.js';
import { runMCPool } from '../utils/physics/errorAnalysis/mcPool.js';
import { normalizeSeed, randomSeed } from '../utils/physics/errorAnalysis/mcConfig.js';
import { defaultThreadCount } from '../utils/synthesis/synthesisConfig/threads.js';
import { designMaterialLookup, embedDesignMaterials } from '../utils/materials/designMaterials.js';
import { getTmmWasmBytesForWorker } from '../tmmcore.js';

const THREAD_URL = new URL('./monteCarloThread.js', import.meta.url);

// The threads a run starts: as many as the app's Threads setting starts with
// on this machine, on the app's own runtime alone (apiThread.js).
const threadCount = () => (onAppRuntime() ? defaultThreadCount(os.availableParallelism?.() ?? os.cpus().length) : 0);

// Starting the threads, each loading its modules and compiling the kernel,
// took about 0.3 s on a 16-thread Windows machine (2026-11-14), however short
// the run; a run spends that only where the threads save more.
const THREAD_START_MS = 300;

/**
 * Whether a run of `total` trials of `trialMs` each, `done` of them made on
 * the calling thread, ends sooner when it is made again from the start on
 * `threads` threads than when it goes on there: starting them, and as many
 * trials in turn as the busiest thread gets, against the trials left.
 */
export function threadsPayOff(trialMs, done, total, threads) {
    if (threads < 2) return false;
    return THREAD_START_MS + trialMs * Math.ceil(total / threads) < trialMs * (total - done);
}

// After each trial a run on the calling thread gives way to the event loop,
// when it has a signal, so a Stop posted to this thread arrives. setImmediate
// rather than a timer: a timer waits for the system clock's tick, several
// milliseconds on Windows, longer than a trial on a usual grid.
const yielding = signal => (signal ? { yieldEvery: 1, onYield: () => new Promise(resolve => globalThis.setImmediate(resolve)) } : {});

// The run on the calling thread.
function runHere(design, params, options, { signal, onProgress }) {
    return runErrorAnalysisMC(design, params, designMaterialLookup(design), {
        ...options,
        ...(onProgress ? { onTrial: ({ i, total }) => onProgress({ trial: i, total }) } : {}),
        ...yielding(signal),
        ...(signal ? { shouldCancel: () => signal.aborted } : {}),
    });
}

/**
 * A promise of the run runErrorAnalysisMC makes of `design` with `options`
 * (plain data and a seed). It starts on the calling thread, and moves to
 * `threads` worker threads when its second trial shows they would end the
 * rest sooner (threadsPayOff): the run is then made there from the start with
 * the same seed, which gives the same result. `signal` is looked at after
 * each trial, and a run it stops gives the trials done, at least one;
 * onProgress({ trial, total }) is called after each trial of the run that
 * gives the result.
 */
export function runMonteCarlo(design, params, options, { signal, onProgress, threads = threadCount() } = {}) {
    const opts = { ...options, seed: normalizeSeed(options.seed) ?? randomSeed() };
    // Reports wait until the run is known to stay on this thread.
    const held = [];
    const show = () => { for (const report of held.splice(0)) onProgress?.(report); };
    let first = 0;
    let moves = false;
    return runErrorAnalysisMC(design, params, designMaterialLookup(design), {
        ...opts,
        onTrial: ({ i, total }) => {
            held.push({ trial: i, total });
            if (i === 1) first = performance.now();
            else if (i === 2) moves = threadsPayOff(performance.now() - first, 2, total, threads);
            if (!moves && (i >= 2 || i === total)) show();
        },
        ...yielding(signal),
        shouldCancel: () => moves || !!signal?.aborted,
    }).then(result => {
        if (moves && !signal?.aborted) return runOnThreads(design, params, opts, { signal, onProgress, threads });
        show();
        return result;
    });
}

/**
 * A promise of the run runErrorAnalysisMC makes of `design` with `options`
 * (plain data), its trials on `threads` worker threads. `signal` is looked at
 * after each trial, and a run it stops gives the trials done, at least one;
 * onProgress({ trial, total }) is called after each trial. A thread that
 * fails part-way has the run made again on the calling thread, whose reports
 * start again from the first trial. The promise settles once every thread has
 * ended, so a caller on a thread of its own, an MCP job or a Script Console
 * run, can be ended as soon as it answers.
 */
export function runOnThreads(design, params, options, { signal, onProgress, threads = threadCount() } = {}) {
    const wasmBytes = getTmmWasmBytesForWorker();
    const run = runMCPool(embedDesignMaterials(design), params, designMaterialLookup(design), options, {
        size: threads,
        makeWorker: () => new ApiThread(THREAD_URL),
        initMessage: wasmBytes ? { type: 'wasmInit', wasmBytes } : null,
        ...(onProgress ? { onTrial: (trial, total) => onProgress({ trial, total }) } : {}),
        ...(signal ? { shouldStop: () => signal.aborted } : {}),
        runHere: opts => ({ done: runHere(design, params, opts, { signal, onProgress }) }),
        restartHere: true,
    });
    return run.done.then(
        result => run.ended.then(() => result),
        error => run.ended.then(() => { throw error; }),
    );
}
