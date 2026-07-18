import { nReal } from './nReal.js';

// An "index function" maps λ(nm) → [n, k] (real, imag parts of refractive index).

/** Constant (non-dispersive) index. */
export function constIndex(n, k = 0) {
    return () => [n, k];
}

/**
 * Index function backed by a catalog material id (e.g. 'user:n2_35').
 * Imported lazily so the engine stays Node-safe when catalogs aren't loaded.
 */
export function materialIndexFn(materialId, getMaterialById) {
    const mat = getMaterialById ? getMaterialById(materialId) : null;
    if (!mat || !mat.getNK) return () => [1, 0];
    return (lam) => mat.getNK(lam);
}

/** Quarter-wave physical thickness (nm) at λ₀ for the given index function. */
export function qwThickness(idxFn, lambda0_nm) {
    const n = nReal(idxFn, lambda0_nm);
    return n > 0 ? lambda0_nm / (4 * n) : 0;
}
