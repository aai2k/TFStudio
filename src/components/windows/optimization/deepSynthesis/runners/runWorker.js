// The run on a worker of its own (utils/workers/deepSynthesisWorker.js), so
// the start, the needle scans and the search's draws stay off this thread.
// This thread forwards the jobs the run asks for to the synthesis pool,
// answers its turns when there is no pool, and turns its events into rows and
// trend points.

import { DEEP_SYNTHESIS_WORKER_URL } from '../../../../../workerUrls.js';
import { getTmmWasmBytesForWorker } from '../../../../../tmmcore.js';
import { makeEvaluator } from '../../../../../utils/synthesis/deepSynthesis/evaluator.js';
import { isCurrentRun } from './lifecycle.js';
import { handleEvent } from './events.js';
import { openBlock } from './runState.js';

// The run worker, or null with the reason in the status line: the run is
// refused rather than run on this thread.
export function buildRunWorker(ctx) {
    try {
        return new Worker(DEEP_SYNTHESIS_WORKER_URL, { type: 'module' });
    } catch (err) {
        console.error('[DeepSynthesis] the run worker could not be built:', err);
        ctx.publish({ statusMsg: ctx.td.statusNoWorker });
        return null;
    }
}

function send(S, message) {
    try { S.worker.postMessage(message); } catch (_) {}
}

// The run is this window's and no Stop has come.
const live = (ctx, S) => ctx.runningRef.current && isCurrentRun(ctx, S);

const errorText = err => String(err?.message || err);

// Every batch after Stop is refused, whether or not the pool still holds it.
function forwardJobs(ctx, S, { id, jobs }) {
    const pool = live(ctx, S) ? S.workerPool : null;
    const results = pool ? pool.map(jobs) : Promise.reject(new Error('stopped'));
    results.then(
        list => send(S, { type: 'results', id, results: list }),
        err => send(S, { type: 'failed', id, message: errorText(err) }),
    );
}

function answerTurn(ctx, S, { id }) {
    send(S, live(ctx, S) ? { type: 'go', id } : { type: 'failed', id, message: 'stopped' });
}

function onEvent(ctx, S, { event, best }) {
    if (!isCurrentRun(ctx, S)) return;
    S.run.best = best;
    handleEvent(ctx, S, event);
}

// The run moved to a denser grid (runGrid.js) for a design of n layers: the
// best design this press recorded is rescored on it, so the next row is judged
// on the same grid.
function onRegrid(ctx, S, { operands, materials, n }) {
    if (!isCurrentRun(ctx, S)) return;
    S.ev = makeEvaluator({ ...S.ev.spec, operands }, { materials });
    if (S.bestLayers) S.bestMf = S.ev.mf(S.bestLayers);
    console.log(`[DeepSynthesis] Grid re-sampled for the grown design (${n} layers)`);
}

const ROUTES = {
    event: onEvent,
    jobs: forwardJobs,
    turn: answerTurn,
    regrid: onRegrid,
};

// The run worker's first message ('ready', once its module has loaded) opens
// the press's run block, so a worker that never loads leaves no block and no
// undo checkpoint.
function hear(ctx, S) {
    S.heard = true;
    if (isCurrentRun(ctx, S)) openBlock(ctx, S);
}

function route(ctx, S, message, end) {
    if (!S.heard) hear(ctx, S);
    if (message?.type === 'done') {
        end({ result: message.result });
    } else if (message?.type === 'error') {
        console.error('[DeepSynthesis] run error:', message.stack || message.message);
        end({ result: null, failure: new Error(message.message) });
    } else {
        ROUTES[message?.type]?.(ctx, S, message);
    }
}

function startMessage(S) {
    return {
        type: 'start', spec: S.ev.spec, materials: S.ev.materials, source: S.source,
        start: S.start, method: S.method, seed: S.seed, pool: S.workerPool ? S.workerPool.size : 0,
    };
}

// Ends the run once: the worker goes, the window lets go of it, and the run's
// promise settles with the outcome.
function makeEnd(ctx, S, resolve) {
    let ended = false;
    return (outcome) => {
        if (ended) return;
        ended = true;
        try { S.worker.terminate(); } catch (_) {}
        if (ctx.runWorkerRef.current === S.handle) ctx.runWorkerRef.current = null;
        resolve(outcome);
    };
}

function begin(S, end) {
    try {
        const wasmBytes = getTmmWasmBytesForWorker();
        if (wasmBytes) S.worker.postMessage({ type: 'wasmInit', wasmBytes });
        S.worker.postMessage(startMessage(S));
    } catch (failure) {
        end({ result: null, failure });
    }
}

// An error before the worker has said anything is a worker that did not load
// (a missing or broken module): the run never started.
function onWorkerError(S, e, end) {
    const failure = new Error(e?.message || 'run worker error');
    end({ result: null, failure, noWorker: !S.heard });
}

// Resolves to { result } when the run ends, { result: null, failure } when it
// fails (noWorker when the worker never loaded), and null when the window
// leaves it (lifecycle.js). Either way the worker is gone by then.
export function runOnWorker(ctx, S) {
    return new Promise((resolve) => {
        const end = makeEnd(ctx, S, resolve);
        S.run = { best: null };
        S.handle = { stop: () => send(S, { type: 'stop' }), leave: () => end(null) };
        ctx.runWorkerRef.current = S.handle;
        S.worker.onmessage = e => route(ctx, S, e.data, end);
        S.worker.onerror = e => onWorkerError(S, e, end);
        begin(S, end);
    });
}
