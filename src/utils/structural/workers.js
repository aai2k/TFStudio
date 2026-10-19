// The optimizer workers a Structural run refines its proposals on, one refine
// at a time each.

import { alive } from '../synthesis/poolRun.js';

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

function refineOnce(worker, job, onTick) {
    return new Promise((resolve, reject) => {
        worker.onmessage = event => {
            const message = event.data;
            if (!message) return;
            if (message.type === 'warn') { console.warn(message.message); return; }
            if (message.type === 'init') return;
            if (message.type === 'progress') { if (onTick) onTick(message); return; }
            if (message.type === 'error') {
                worker.onmessage = null;
                worker.onerror = null;
                reject(new Error(message.message || 'worker error'));
                return;
            }
            if (message.type === 'done') {
                worker.onmessage = null;
                worker.onerror = null;
                resolve({
                    mf: message.mfBest,
                    omf: message.omfBest,
                    frontLayers: message.bestFrontLayers,
                    backLayers: message.bestBackLayers,
                });
            }
        };
        worker.onerror = event => {
            worker.onmessage = null;
            worker.onerror = null;
            reject(new Error((event && event.message) || 'worker onerror'));
        };
        worker.postMessage(job);
    });
}

function replaceTimedOutWorker(S, workerIndex) {
    console.warn(`[Structural] refine worker ${workerIndex} timed out, replacing it`);
    const { workers, makeWorker } = S.workerPool;
    try { workers[workerIndex]?.terminate(); } catch (_) {}
    try {
        const worker = makeWorker();
        if (S.wasmBytes) worker.postMessage({ type: 'wasmInit', wasmBytes: S.wasmBytes });
        workers[workerIndex] = worker;
    } catch (_) {}
}

/**
 * Refine `job` on worker `workerIndex`. Resolves to the refined design, or to
 * null when the refine failed, took longer than its timeout (the worker is
 * then replaced) or the run was stopped.
 */
export function refineGuarded(S, workerIndex, job, tick) {
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
        S.signal?.addEventListener('abort', onStop);
        timeout = setTimeout(() => {
            if (settled) return;
            if (alive(S)) replaceTimedOutWorker(S, workerIndex);
            done(null);
        }, REFINE_TIMEOUT_MS);
        refineOnce(S.workerPool.workers[workerIndex], job, tick)
            .then(result => done(result))
            .catch(() => done(null));
    });
}
