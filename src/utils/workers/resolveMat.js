/**
 * Approach-A table-lookup material resolver, shared by the compute workers.
 *
 * Materials cross the worker boundary as pre-sampled tables ({ lambdas, n, k })
 * so a worker never runs dispersion math itself. `makeResolveMat` builds a
 * memoized resolver that returns a `{ getNK(λ) }` stub per material id, looking
 * λ up in the pre-sampled map for an exact, bit-identical hit.
 *
 * If a λ was NOT pre-sampled (the centralized-λ grid in operandSampleLambdas is
 * the single source of truth — see optimizer.js), the resolver falls back to the
 * nearest sampled λ and posts a one-time 'warn' message. That path means results
 * are no longer bit-identical to the main thread, so it should never fire in
 * normal operation; it exists only as a guard.
 *
 * @param {Object} materials  id → { lambdas, n, k } pre-sampled table
 * @param {string} label      worker name, used in the fallback warning
 */
// Index a pre-sampled table into an exact-hit map plus a λ-ascending parallel
// pair (sortedL / sortedNK) used by the nearest-λ fallback.
function indexTable(entry) {
    const map = new Map();
    if (!entry || !entry.lambdas) return { map, sortedL: null, sortedNK: null };
    const { lambdas, n, k } = entry;
    for (let i = 0; i < lambdas.length; i++) map.set(lambdas[i], [n[i], k[i]]);
    const idx = lambdas.map((_, i) => i).sort((a, b) => lambdas[a] - lambdas[b]);
    return {
        map,
        sortedL:  idx.map(i => lambdas[i]),
        sortedNK: idx.map(i => [n[i], k[i]]),
    };
}

// Nearest-λ [n,k] via binary search over the ascending sortedL grid.
function nearestNK(sortedL, sortedNK, lam) {
    let lo = 0, hi = sortedL.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (sortedL[mid] < lam) lo = mid; else hi = mid;
    }
    return (Math.abs(sortedL[lo] - lam) <= Math.abs(sortedL[hi] - lam)) ? sortedNK[lo] : sortedNK[hi];
}

export function makeResolveMat(materials, label = 'worker') {
    const cache = new Map();
    let missReported = false;

    function build(id) {
        const { map, sortedL, sortedNK } = indexTable(materials[id] || materials['Air'] || null);
        return {
            _wkrMat: true,
            getNK(lam) {
                const v = map.get(lam);
                if (v !== undefined) return v;
                if (!sortedL || sortedL.length === 0) return [1, 0];
                if (!missReported) {
                    missReported = true;
                    postMessage({ type: 'warn', message:
                        `${label}: λ ${lam} not pre-sampled for "${id}" — nearest-λ fallback (not bit-identical)` });
                }
                return nearestNK(sortedL, sortedNK, lam);
            },
        };
    }

    return function resolveMat(id) {
        const key = (id == null || id === '') ? 'Air' : id;
        let stub = cache.get(key);
        if (!stub) { stub = build(key); cache.set(key, stub); }
        return stub;
    };
}
