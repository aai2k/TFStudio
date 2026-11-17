// The workers of a run the API makes (runs.js). On the app's own runtime a run
// of more than one thread gets the windows' own worker modules on Node worker
// threads (runThread.js) and spreads its jobs over them as its window spreads
// them over Web Workers. Elsewhere, or with one thread, each job is computed on
// the calling thread, one after another. The run gives the same answer either
// way.

import { ApiThread, onAppRuntime } from './apiThread.js';
import { WorkerPool } from '../utils/workers/workerPool.js';
import { InThreadOptimizerWorker } from '../utils/workers/inThreadOptimizerWorker.js';
import { InThreadSynthesisPool } from '../utils/workers/inThreadSynthesisPool.js';
import { getTmmWasmBytesForWorker } from '../tmmcore.js';

const THREAD_URL = new URL('./runThread.js', import.meta.url);

// A worker of `kind` ('synthesis', 'optimizer' or 'merit') on a thread of its
// own. terminate() asks it to end once the job under way is done.
class RunThread extends ApiThread {
    constructor(kind) {
        super(THREAD_URL, { kind });
    }
    terminate() {
        if (this.ending) return;
        this.ending = true;
        this.thread.postMessage({ type: 'endThread' });
    }
}

// The kernel each worker of a pool is sent before its first job, as the
// windows send it.
function wasmInit() {
    const wasmBytes = getTmmWasmBytesForWorker();
    return wasmBytes ? { type: 'wasmInit', wasmBytes } : null;
}

const inThread = () => ({
    onThreads: false,
    makeWorker: () => new InThreadOptimizerWorker(),
    makeWorkerPool: size => new InThreadSynthesisPool(size),
    makeEvalPool: undefined,
    close: () => Promise.resolve(),
});

/**
 * The workers of a run of `threads` threads, as the runs take them in their
 * hooks: makeWorker() an optimizer worker, makeWorkerPool(size) a pool of
 * synthesis workers, and makeEvalPool(size) a pool of merit workers for
 * parallel Differential Evolution, undefined on the calling thread, where DE
 * runs in its one optimizer worker. They are threads (`onThreads`) on the
 * app's own runtime when `threads` is above 1. close() ends every thread
 * made, each once the job under way is done, and resolves once all have
 * ended.
 */
export function runWorkers(threads) {
    if (!onAppRuntime() || !(threads > 1)) return inThread();
    const made = [];
    const spawn = kind => {
        const thread = new RunThread(kind);
        made.push(thread);
        return thread;
    };
    return {
        onThreads: true,
        makeWorker: () => spawn('optimizer'),
        makeWorkerPool: size => new WorkerPool(null, size, wasmInit(), () => spawn('synthesis')),
        makeEvalPool: size => new WorkerPool(null, size, wasmInit(), () => spawn('merit')),
        close() {
            for (const thread of made) thread.terminate();
            return Promise.all(made.map(thread => thread.ended));
        },
    };
}
