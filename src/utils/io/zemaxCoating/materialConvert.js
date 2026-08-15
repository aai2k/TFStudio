import { sanitizeZemaxName } from './names.js';
import {
    createPchipInterpolator,
    TABULATED_INTERPOLATION,
} from '../../materials/pchip.js';

/**
 * Build a TFStudio tabular catalog material from a parsed MATE entry.
 * Flips the extinction sign (Zemax imag ≤ 0  →  TFStudio k ≥ 0).
 * @returns {object} material object (formulaNum −1, tabData [[λ_nm,n,k],…]).
 */
export function mateToTfMaterial(mate, opts = {}) {
    const pts = (mate.points || []).slice().sort((a, b) => a[0] - b[0]);
    const tabData = (pts.length ? pts : [[0.55, 1.5, 0]]).map(([lamUm, n, imag]) => [
        lamUm * 1000,                 // µm → nm
        n,
        Math.max(0, -imag),           // Zemax imag is −k; clamp tiny positive noise to 0
    ]);
    const lamMinUm = tabData[0][0] / 1000;
    const lamMaxUm = tabData[tabData.length - 1][0] / 1000;
    const name = String(mate.name || 'material').trim();
    return {
        id: sanitizeZemaxName(name).toLowerCase() || 'material',
        name,
        formulaNum: -1,
        interp: TABULATED_INTERPOLATION,
        coefficients: [],
        kTable: [],
        tabData,
        lambdaMin: lamMinUm,
        lambdaMax: lamMaxUm,
        nd: nIndexFromTab(tabData, 587.5618),
        vd: null, density: null,
        comment: opts.comment || `Imported from Zemax COATING.DAT`,
        color: null,
        group: 'Imported',
    };
}

/** PCHIP-interpolate n from a [[λ_nm,n,k], ...] table (clamped at ends). */
function nIndexFromTab(tab, lamNm) {
    const interpolate = createPchipInterpolator((tab || []).map(row => [row[0], row[1]]));
    return interpolate ? interpolate(lamNm) : null;
}

/**
 * Sample a TFStudio material into a MATE record over a wavelength grid.
 * @param {string} name       Zemax material name (already sanitised by caller, or not)
 * @param {(lamNm:number)=>[number,number]} getNK  resolver → [n, k≥0]
 * @param {number[]} gridNm   ascending wavelengths in nm
 * @returns {{name:string, points:Array<[number,number,number]>}}
 */
export function tfMaterialToMate(name, getNK, gridNm) {
    const points = gridNm.map(lamNm => {
        const [n, k] = getNK(lamNm);
        return [lamNm / 1000, n, -Math.abs(k || 0)];   // nm → µm, k → −k (Zemax sign)
    });
    return { name: sanitizeZemaxName(name), points };
}
