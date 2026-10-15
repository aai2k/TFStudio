/**
 * Approach-A table-lookup material resolver, shared by the compute workers.
 *
 * Materials cross the worker boundary as pre-sampled tables ({ lambdas, n, k })
 * so a worker does not resample a material at every grid wavelength.
 * `makeResolveMat` builds a memoized resolver that returns a `{ getNK(λ) }` stub
 * per material id, looking λ up in the pre-sampled map for an exact,
 * bit-identical hit.
 *
 * A λ the table does not hold is computed from the material's own dispersion
 * model, so it matches the main thread bit for bit as well: a built-in id from
 * the worker's built-in library, any other id from the definition its table
 * entry carries (`record`, sampling.js buildPresampledTable), through the same
 * makeGetNK the main thread's catalogs and embedded materials use. An entry
 * with neither falls back to the nearest sampled λ and posts a one-time 'warn'
 * message, since its results are then no longer bit-identical to the main
 * thread. The frequency responses the phase rows read are served from the
 * table only.
 *
 * @param {Object} materials  id → { lambdas, n, k, record?, mechanical? } pre-sampled table
 * @param {string} label      worker name, used in the fallback warning
 * @param {Function} post     where the warning goes: the worker's postMessage by
 *                            default, the job's own channel for a job run on the
 *                            calling thread (inThreadOptimizerWorker.js)
 */
import { getMaterialById } from '../materials/catalogManager.js';
import { makeGetNK } from '../materials/catalogManager/dispersion.js';
import { isBuiltinId } from '../materials/designMaterials.js';

// Index a pre-sampled table into an exact-hit map plus a λ-ascending parallel
// pair (sortedL / sortedNK) used by the nearest-λ fallback.
function indexTable(entry) {
    const map = new Map();
    if (!entry || !entry.lambdas) return { map, sortedL: null, sortedNK: null };
    const { lambdas, n, k, omegaResponses } = entry;
    for (let i = 0; i < lambdas.length; i++) {
        map.set(lambdas[i], { nk: [n[i], k[i]], omegaResponse: omegaResponses?.[i] || null });
    }
    const idx = lambdas.map((_, i) => i).sort((a, b) => lambdas[a] - lambdas[b]);
    return {
        map,
        sortedL:  idx.map(i => lambdas[i]),
        sortedNK: idx.map(i => ({ nk: [n[i], k[i]], omegaResponse: omegaResponses?.[i] || null })),
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

// The getNK the table entry for `id` was sampled from, or null when the entry
// carries no definition and the id is not built in.
function modelGetNK(id, entry) {
    if (entry?.record) return makeGetNK(entry.record);
    if (!isBuiltinId(id)) return null;
    return getMaterialById(id)?.getNK || null;
}

const workerPost = message => postMessage(message);

// Posts each kind of warning once per resolver: a run would otherwise post one
// per wavelength.
function onceWarner(post) {
    const reported = new Set();
    return (kind, message) => {
        if (reported.has(kind)) return;
        reported.add(kind);
        post({ type: 'warn', message });
    };
}

// The `{ getNK, getOmegaResponse }` stub for one id. An id the table lacks
// reads the Air entry, wavelengths off its grid included.
function tableStub(id, materials, label, warn) {
    const entryId = materials[id] ? id : 'Air';
    const entry = materials[entryId] || null;
    const { map, sortedL, sortedNK } = indexTable(entry);
    let model;
    const offGridNK = lam => {
        if (model === undefined) model = modelGetNK(entryId, entry);
        if (model) return model(lam);
        if (!sortedL || sortedL.length === 0) return [1, 0];
        warn('nk', `${label}: λ ${lam} not pre-sampled for "${id}", nearest-λ fallback, not bit-identical`);
        return nearestNK(sortedL, sortedNK, lam).nk;
    };
    return {
        _wkrMat: true,
        // Mechanical and thermal constants, carried across as they stand:
        // they are numbers, not a dispersion, and the stress operand reads
        // them off the stub exactly as it reads them off a material record.
        mechanical: entry?.mechanical,
        getNK(lam) {
            const v = map.get(lam);
            return v !== undefined ? v.nk : offGridNK(lam);
        },
        getOmegaResponse(lam) {
            const v = map.get(lam);
            if (v !== undefined) return v.omegaResponse;
            warn('omega', `${label}: exact omega response unavailable at lambda ${lam} for "${id}"`);
            return null;
        },
    };
}

export function makeResolveMat(materials, label = 'worker', post = workerPost) {
    const cache = new Map();
    const warn = onceWarner(post);
    const build = id => tableStub(id, materials, label, warn);

    return function resolveMat(id) {
        const key = (id == null || id === '') ? 'Air' : id;
        let stub = cache.get(key);
        if (!stub) { stub = build(key); cache.set(key, stub); }
        return stub;
    };
}
