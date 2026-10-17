/**
 * The worker the edge filter search runs in (utils/workers/edgeFilterWorker.js).
 *
 * A stopped or replaced worker may still post; only the worker the ref holds
 * reports.
 */

import { EDGE_FILTER_WORKER_URL } from '../../../../workerUrls.js';

/**
 * Start a search. `ctx` holds { workerRef, request, signature, setProgress,
 * finish(result, signature) }; a failure finishes with { errorKey: 'failed' }.
 */
export function startEdgeSearch(ctx) {
    stopEdgeSearch(ctx.workerRef);
    let worker;
    try {
        worker = new Worker(EDGE_FILTER_WORKER_URL, { type: 'module' });
    } catch (caught) {
        console.error('[Edge filter worker] construction failed', caught);
        ctx.finish({ errorKey: 'failed' }, ctx.signature);
        return;
    }
    ctx.workerRef.current = worker;
    const end = (result) => {
        if (ctx.workerRef.current !== worker) return;
        stopEdgeSearch(ctx.workerRef);
        ctx.finish(result, ctx.signature);
    };
    worker.onmessage = ({ data }) => {
        if (ctx.workerRef.current !== worker) return;
        if (data?.type === 'progress') ctx.setProgress({ done: data.done, total: data.total });
        else if (data?.type === 'result') end(data.result);
        else if (data?.type === 'error') {
            console.error('[Edge filter worker]', data.message);
            end({ errorKey: 'failed' });
        }
    };
    worker.onerror = (event) => {
        console.error('[Edge filter worker]', event.message);
        end({ errorKey: 'failed' });
    };
    worker.postMessage({ type: 'search', request: ctx.request });
}

/** Terminate the running search, if there is one. */
export function stopEdgeSearch(workerRef) {
    if (!workerRef.current) return;
    workerRef.current.terminate();
    workerRef.current = null;
}
