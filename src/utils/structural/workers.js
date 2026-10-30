// The optimizer workers a Structural run refines its proposals on, one job at
// a time each. A job has no time limit: it ends when its worker answers, when
// the worker fails, or on Stop. A worker that stops answering without failing
// holds its job, and the run, until Stop.

import { alive } from '../synthesis/poolRun.js';
import { postJob } from '../workers/jobTables.js';

// Workers that failed while they held no job. Such a worker may be gone, so it
// is replaced before its slot takes the next job (guarded).
const failedIdle = new WeakSet();

// Notes a failure of `worker` while it holds no job; runOnce takes its error
// events over while it runs a job.
function watchIdle(worker) {
    const failed = () => failedIdle.add(worker);
    worker.onerror = failed;
    worker.onmessageerror = failed;
    return worker;
}

/**
 * `count` workers from `makeWorker`, with terminate() for all of them. A
 * worker that cannot be built ends the ones built before it, and the error
 * goes on to the caller.
 */
export function buildWorkers(makeWorker, count) {
    const workers = [];
    const terminate = () => {
        for (const worker of workers) { try { worker.terminate(); } catch (_) {} }
    };
    try {
        for (let i = 0; i < count; i++) workers.push(watchIdle(makeWorker()));
    } catch (err) {
        terminate();
        throw err;
    }
    return { workers, makeWorker, terminate };
}

// What a job's last message answers: a refine's best design, with the full
// merit of the design the run keeps (`scored`, structural/workerJobs.js), or a
// needle job's result.
function answerOf(message) {
    if (message.type === 'structural') return message.result;
    return {
        mf: message.mfBest,
        omf: message.omfBest,
        frontLayers: message.bestFrontLayers,
        backLayers: message.bestBackLayers,
        scored: message.scored,
    };
}

// Runs `job` on `worker`. Rejects when the job reports an error, or with
// `workerFailed` set when the worker itself fails: an error event, or a
// message that cannot be read, which may have been the answer.
function runOnce(worker, job, onTick) {
    return new Promise((resolve, reject) => {
        const settle = (finish, value) => {
            worker.onmessage = null;
            watchIdle(worker);
            finish(value);
        };
        const workerFailed = text => settle(reject, Object.assign(new Error(text), { workerFailed: true }));
        worker.onmessage = event => {
            const message = event.data;
            if (!message || message.type === 'init') return;
            if (message.type === 'warn') { console.warn(message.message); return; }
            if (message.type === 'progress') { if (onTick) onTick(message); return; }
            if (message.type === 'error') { settle(reject, new Error(message.message || 'worker error')); return; }
            if (message.type === 'done' || message.type === 'structural') settle(resolve, answerOf(message));
        };
        worker.onerror = event => workerFailed((event && event.message) || 'worker onerror');
        worker.onmessageerror = () => workerFailed('worker messageerror');
        try { postJob(worker, job); } catch (err) { settle(reject, err); }
    });
}

// A worker that failed may be gone, so the jobs its slot takes from now on go
// to a new one. A worker that cannot be built leaves the slot empty, and every
// job sent to the slot then fails at once (guarded).
function replaceFailedWorker(S, workerIndex) {
    console.warn(`[Structural] optimizer worker ${workerIndex} failed, replacing it`);
    const { workers, makeWorker } = S.workerPool;
    try { workers[workerIndex]?.terminate(); } catch (_) {}
    workers[workerIndex] = null;
    try {
        const worker = watchIdle(makeWorker());
        workers[workerIndex] = worker;
        if (S.wasmBytes) worker.postMessage({ type: 'wasmInit', wasmBytes: S.wasmBytes });
    } catch (_) {}
}

// Runs `job` on worker `workerIndex`. Resolves to its answer, or to null when
// it failed (`onError` gets the error; a worker that failed is replaced) or
// the run was stopped. A worker that failed while it held no job is replaced
// before the job is sent.
function guarded(S, workerIndex, job, { tick = null, onError = null }) {
    return new Promise(resolve => {
        let settled = false;
        const done = value => {
            if (settled) return;
            settled = true;
            S.signal?.removeEventListener('abort', onStop);
            resolve(value);
        };
        const onStop = () => done(null);
        if (S.signal?.aborted) { done(null); return; }
        if (failedIdle.has(S.workerPool.workers[workerIndex]) && !S.poolClosed) replaceFailedWorker(S, workerIndex);
        const worker = S.workerPool.workers[workerIndex];
        if (!worker) {
            onError?.(new Error(`optimizer worker ${workerIndex} could not be rebuilt after it failed`));
            done(null);
            return;
        }
        S.signal?.addEventListener('abort', onStop);
        runOnce(worker, job, tick)
            .then(result => done(result))
            .catch(err => {
                if (settled) return;
                if (err?.workerFailed && alive(S) && !S.poolClosed) replaceFailedWorker(S, workerIndex);
                onError?.(err);
                done(null);
            });
    });
}

/**
 * Refine `job` on worker `workerIndex`. Resolves to the refined design, or to
 * null when the refine failed (`onError` gets the error) or the run was
 * stopped.
 */
export function refineGuarded(S, workerIndex, job, tick, onError = null) {
    return guarded(S, workerIndex, job, { tick, onError });
}

/**
 * Run a needle job (structural/workerJobs.js) on worker `workerIndex`.
 * Resolves to its result, or to null when it failed (`onError` gets the error)
 * or the run was stopped.
 */
export function needleTask(S, workerIndex, job, onError) {
    return guarded(S, workerIndex, job, { onError });
}
