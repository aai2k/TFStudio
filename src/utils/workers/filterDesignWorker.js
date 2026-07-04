/**
 * Filter Design — Global Integer Search Web Worker (module worker).
 *
 * Runs `globalIntegerSearch` off the UI thread so the wizard's step-5 Start/Stop
 * stays responsive. Materials cross the boundary via Approach-A pre-sampling
 * (`presampleForSearch` on the main thread); the worker rebuilds an
 * interpolating index function from the dense λ grid.
 *
 * Protocol:
 *   main → worker : { lambda0, targetParams, search, tables }
 *   worker → main : { type:'tick',   best, candidates }   (after each restart)
 *                   { type:'result', candidates }         (search complete)
 *                   { type:'error',  message }
 *   Stop = main thread calls worker.terminate().
 */

import { globalIntegerSearch, buildFilterTarget } from '../filter/filterDesign.js';

/** Build an interpolating index fn [n,k] from a dense pre-sampled grid. */
function interpIndexFn(grid) {
    const L = grid.lambdas, V = grid; // V.* arrays parallel to L
    const arr = grid.nk;              // [[n,k], ...]
    const n = L.length;
    return (lam) => {
        if (n === 0) return [1, 0];
        if (lam <= L[0]) return arr[0];
        if (lam >= L[n - 1]) return arr[n - 1];
        // binary search for the bracket
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (L[mid] <= lam) lo = mid; else hi = mid;
        }
        const t = (lam - L[lo]) / (L[hi] - L[lo] || 1);
        const a = arr[lo], b = arr[hi];
        return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    };
}

self.onmessage = (e) => {
    const msg = e.data || {};
    try {
        const { lambda0, targetParams, search, tables } = msg;
        const nH = interpIndexFn({ lambdas: tables.lambdas, nk: tables.H });
        const nL = interpIndexFn({ lambdas: tables.lambdas, nk: tables.L });
        const nSub = interpIndexFn({ lambdas: tables.lambdas, nk: tables.Sub });
        const target = buildFilterTarget(targetParams);

        const { candidates } = globalIntegerSearch({
            ...search,
            nH, nL, nSub, lambda0_nm: lambda0, target,
            onProgress: (best, cands) => {
                self.postMessage({ type: 'tick', best, candidates: cands.slice(0, 16) });
            },
        });
        self.postMessage({ type: 'result', candidates });
    } catch (err) {
        self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
    }
};
