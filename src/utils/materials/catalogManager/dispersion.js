import { evalN } from '../dispersionFormulas.js';
import {
    createPchipInterpolator,
    createTabulatedNKSampler,
    TABULATED_INTERPOLATION,
} from '../pchip.js';

const kInterpolatorCache = new WeakMap();

function makeKInterpolator(kTable) {
    if (!Array.isArray(kTable) || kTable.length === 0) return null;
    let interpolate = kInterpolatorCache.get(kTable);
    if (!interpolate) {
        interpolate = createPchipInterpolator(kTable.map(row => [row.lam_um, row.k]));
        kInterpolatorCache.set(kTable, interpolate);
    }
    return interpolate;
}

/** PCHIP-interpolate k from a [{lam_um, k}, ...] table. */
export function interpK(kTable, lambda_um) {
    return makeKInterpolator(kTable)?.(lambda_um) ?? 0;
}

/** Build a getNK(lambda_nm) function for a catalog material entry. */
export function makeGetNK(mat) {
    if (mat.getNK) return mat.getNK;
    // formulaNum === -1 → user tabular: tabData = [[lam_nm, n, k], ...]
    if (mat.formulaNum === -1) {
        return createTabulatedNKSampler(mat.tabData) || (() => [1.5, 0]);
    }
    const kAt = makeKInterpolator(mat.kTable);
    const getNK = (lambda_nm) => {
        const lum = lambda_nm / 1000;
        const n = evalN(mat.formulaNum, mat.coefficients, lum);
        return [n, kAt?.(lum) ?? 0];
    };
    if (kAt) getNK.interp = TABULATED_INTERPOLATION;
    return getNK;
}
