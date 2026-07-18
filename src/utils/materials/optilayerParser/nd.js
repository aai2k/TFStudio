import { evalN } from '../dispersionFormulas.js';
import { interp } from './interpolate.js';
import { D_LINE_NM } from './constants.js';

/** Refractive index at the d-line for colour/sorting; null if outside the data range. */
export function computeNd(mat) {
    try {
        if (mat.formulaNum === -1) {
            return interp(mat.tabData, D_LINE_NM, 1);
        }
        if (D_LINE_NM / 1000 < mat.lambdaMin || D_LINE_NM / 1000 > mat.lambdaMax) return null;
        const n = evalN(mat.formulaNum, mat.coefficients, D_LINE_NM / 1000);
        return isFinite(n) ? n : null;
    } catch (_) { return null; }
}
