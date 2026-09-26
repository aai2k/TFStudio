import { OPTIMIZER_WORKER_URL as WORKER_URL } from '../../../../../workerUrls.js';

const REFINE_TIMEOUT_MS = 45000;

// An optimizer Web Worker, unless the caller brings its own: the benchmark,
// which already runs off the UI thread, refines on its own thread
// (utils/workers/inThreadOptimizerWorker.js).
function newWorker(ctx) {
    return ctx.makeWorker ? ctx.makeWorker() : new Worker(WORKER_URL, { type: 'module' });
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

function replaceTimedOutWorker(ctx, S, workerIndex) {
    console.warn(`[Structural] refine worker ${workerIndex} timed out — replacing`);
    try { ctx.workersRef.current[workerIndex]?.terminate(); } catch (_) {}
    try {
        const worker = newWorker(ctx);
        if (S.wasmBytes) worker.postMessage({ type: 'wasmInit', wasmBytes: S.wasmBytes });
        ctx.workersRef.current[workerIndex] = worker;
    } catch (_) {}
}

export function refineGuarded(ctx, S, workerIndex, job, tick) {
    return new Promise(resolve => {
        let settled = false;
        let timeout = null;
        const done = value => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            resolve(value);
        };
        timeout = setTimeout(() => {
            if (settled) return;
            replaceTimedOutWorker(ctx, S, workerIndex);
            done(null);
        }, REFINE_TIMEOUT_MS);
        refineOnce(ctx.workersRef.current[workerIndex], job, tick)
            .then(result => done(result))
            .catch(() => done(null));
    });
}

export function createWorkers(ctx, count) {
    try {
        ctx.killWorkers();
        for (let i = 0; i < count; i++) {
            ctx.workersRef.current.push(newWorker(ctx));
        }
        return true;
    } catch (err) {
        console.error('[Structural] worker construction failed:', err);
        ctx.setStatusMsg(ctx.ts.statusWorkerFailed);
        ctx.killWorkers();
        return false;
    }
}
