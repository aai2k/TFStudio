// The optimizer workers a Structural run refines its proposals on, one job at
// a time each.

import { alive } from '../synthesis/poolRun.js';
import { postJob } from '../workers/jobTables.js';

const REFINE_TIMEOUT_MS = 45000;

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
        for (let i = 0; i < count; i++) workers.push(makeWorker());
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

function runOnce(worker, job, onTick) {
    return new Promise((resolve, reject) => {
        const settle = (finish, value) => {
            worker.onmessage = null;
            worker.onerror = null;
            finish(value);
        };
        worker.onmessage = event => {
            const message = event.data;
            if (!message || message.type === 'init') return;
            if (message.type === 'warn') { console.warn(message.message); return; }
            if (message.type === 'progress') { if (onTick) onTick(message); return; }
            if (message.type === 'error') { settle(reject, new Error(message.message || 'worker error')); return; }
            if (message.type === 'done' || message.type === 'structural') settle(resolve, answerOf(message));
        };
        worker.onerror = event => settle(reject, new Error((event && event.message) || 'worker onerror'));
        postJob(worker, job);
    });
}

function replaceTimedOutWorker(S, workerIndex) {
    console.warn(`[Structural] refine worker ${workerIndex} timed out, replacing it`);
    const { workers, makeWorker } = S.workerPool;
    try { workers[workerIndex]?.terminate(); } catch (_) {}
    // A worker that cannot be rebuilt leaves its slot empty, and every job
    // sent to the slot then fails at once (guarded).
    workers[workerIndex] = null;
    try {
        const worker = makeWorker();
        if (S.wasmBytes) worker.postMessage({ type: 'wasmInit', wasmBytes: S.wasmBytes });
        workers[workerIndex] = worker;
    } catch (_) {}
}

// Runs `job` on worker `workerIndex`. Resolves to its answer, or to null when
// it failed (`onError` gets the error), took longer than `timeoutMs` (the
// worker is then replaced) or the run was stopped.
function guarded(S, workerIndex, job, { tick = null, timeoutMs = null, onError = null }) {
    return new Promise(resolve => {
        let settled = false;
        let timeout = null;
        const done = value => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            S.signal?.removeEventListener('abort', onStop);
            resolve(value);
        };
        const onStop = () => done(null);
        if (S.signal?.aborted) { done(null); return; }
        const worker = S.workerPool.workers[workerIndex];
        if (!worker) {
            onError?.(new Error(`optimizer worker ${workerIndex} could not be rebuilt after a timeout`));
            done(null);
            return;
        }
        S.signal?.addEventListener('abort', onStop);
        if (timeoutMs != null) {
            timeout = setTimeout(() => {
                if (settled) return;
                if (alive(S)) replaceTimedOutWorker(S, workerIndex);
                done(null);
            }, timeoutMs);
        }
        runOnce(worker, job, tick)
            .then(result => done(result))
            .catch(err => {
                if (!settled) onError?.(err);
                done(null);
            });
    });
}

/**
 * Refine `job` on worker `workerIndex`. Resolves to the refined design, or to
 * null when the refine failed, took longer than its timeout (the worker is
 * then replaced) or the run was stopped.
 */
export function refineGuarded(S, workerIndex, job, tick) {
    return guarded(S, workerIndex, job, { tick, timeoutMs: REFINE_TIMEOUT_MS });
}

/**
 * Run a needle job (structural/workerJobs.js) on worker `workerIndex`, with no
 * time limit. Resolves to its result, or to null when it failed (`onError`
 * gets the error) or the run was stopped.
 */
export function needleTask(S, workerIndex, job, onError) {
    return guarded(S, workerIndex, job, { onError });
}
