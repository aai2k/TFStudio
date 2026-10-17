/**
 * The edge filter search off the renderer thread.
 *
 * The search walks every value of a on its grid: about a quarter of a second
 * for the default nineteen, minutes for the finest step the window allows. Here
 * the window stays alive and stops the search by terminating the worker.
 *
 * Protocol:
 *   main → worker : { type: 'search', request }  (see searchEdgeFilters)
 *   worker → main : { type: 'progress', done, total }  at most every 100 ms
 *                   { type: 'result', result }          { solutions } or { errorKey }
 *                   { type: 'error', message }
 */

import { searchEdgeFilters } from '../synthesis/edgeFilter.js';

const PROGRESS_INTERVAL_MS = 100;

globalThis.onmessage = (event) => {
    const job = event.data;
    if (job?.type !== 'search') return;
    try {
        let last = 0;
        const result = searchEdgeFilters(job.request, {
            onProgress: (done, total) => {
                const now = Date.now();
                if (now - last < PROGRESS_INTERVAL_MS && done < total) return;
                last = now;
                postMessage({ type: 'progress', done, total });
            },
        });
        postMessage({ type: 'result', result });
    } catch (error) {
        postMessage({ type: 'error', message: error?.stack || String(error) });
    }
};
