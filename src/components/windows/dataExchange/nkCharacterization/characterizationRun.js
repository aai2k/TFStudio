/**
 * The worker a characterization runs in.
 *
 * The extraction runs in a worker. On a spectroscopic ellipsometer's own grid
 * it is tens of seconds, which on the render thread is an application that
 * stops answering; here the window stays alive and the run can be stopped.
 *
 * Only the worker the ref still points at is allowed to report. A run that was
 * stopped or replaced keeps arriving for a while, and its progress and result
 * belong to a question nobody is asking any more.
 */

import { CHARACTERIZATION_WORKER_URL } from '../../../../workerUrls.js';
import { getTmmWasmBytesForWorker } from '../../../../tmmcore.js';
import { characterizationRequest } from './model.js';

const failure = message => ({ error: 'failed', message });

function createWorker(ctx) {
    try {
        return new Worker(CHARACTERIZATION_WORKER_URL, { type: 'module' });
    } catch (caught) {
        console.error('[Characterization worker] construction failed', caught);
        ctx.patchRunState({
            result: failure(caught?.message || String(caught)),
            ranWith: ctx.signature,
        });
        ctx.setRunning(false);
        return null;
    }
}

/** Take the run's answer, whether it is a result or a failure, and shut down. */
function makeFinish(ctx, worker, measurementMode) {
    return (result) => {
        if (ctx.workerRef.current !== worker) return;
        ctx.workerRef.current = null;
        ctx.patchRunState({
            result: result.error ? result : { ...result, measurementMode },
            ranWith: ctx.signature,
        });
        ctx.setRunning(false);
        worker.terminate();
    };
}

function routeMessage(ctx, worker, finish, message) {
    if (message?.type === 'progress') {
        if (ctx.workerRef.current === worker) ctx.setProgress(message.progress);
    } else if (message?.type === 'result') finish(message.result);
    else if (message?.type === 'error') {
        console.error('[Characterization worker]', message.message);
        finish(failure(message.message));
    }
}

/**
 * Start an extraction.
 *
 * A request the settings cannot produce is reported as the run's own result,
 * without a worker, so the window says what is missing rather than spinning.
 */
export function startCharacterization(ctx) {
    const prepared = characterizationRequest(ctx.design, ctx.settings);
    if (prepared.error) {
        ctx.patchRunState({ result: prepared, ranWith: ctx.signature });
        return;
    }
    ctx.stop();
    ctx.setRunning(true);
    ctx.setProgress(null);
    ctx.setStartedAt(Date.now());

    const worker = createWorker(ctx);
    if (!worker) return;
    ctx.workerRef.current = worker;
    const finish = makeFinish(ctx, worker, prepared.measurementMode);
    worker.onmessage = event => routeMessage(ctx, worker, finish, event.data);
    worker.onerror = (event) => {
        console.error('[Characterization worker]', event.message);
        finish(failure(event.message));
    };
    const wasmBytes = getTmmWasmBytesForWorker();
    if (wasmBytes) worker.postMessage({ type: 'wasmInit', wasmBytes });
    worker.postMessage({ type: 'characterize', request: prepared.request });
}

/** Drop the running worker, if there is one, and leave the window idle. */
export function stopCharacterization(workerRef, setRunning) {
    if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
    }
    setRunning(false);
}
