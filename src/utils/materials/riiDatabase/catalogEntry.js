/**
 * Conversion of a fetched RII material to a catalogManager-compatible entry.
 */

import { RII_RAW_BASE } from './fetch.js';
import { sampleMaterial } from './sampling.js';

/**
 * Convert a fetched RII material to a catalogManager-compatible entry.
 * The entry can be added to a catalog with source='refractiveindex'.
 *
 * Returns a material entry object (not a full catalog — caller adds it to a catalog).
 */
export function riiToMaterialEntry(mat, pageName, bookName) {
    // Wide range so IR-only materials aren't rejected and NIR/IR tails aren't
    // truncated; the material's wavelengthRange still bounds the actual samples.
    const samples = sampleMaterial(mat, 200, 20000, 10);
    if (samples.length === 0) throw new Error('No data in wavelength range 200-20000 nm');

    const lmin_um = samples[0][0] / 1000;
    const lmax_um = samples[samples.length - 1][0] / 1000;

    const id = (bookName + '_' + pageName).replace(/\s+/g, '_').replace(/[^\w-]/g, '');

    return {
        id,
        name: bookName + ' (' + pageName + ')',
        formulaNum: -1,       // tabulated in catalogManager convention
        coefficients: [],
        lambdaMin: lmin_um,
        lambdaMax: lmax_um,
        kTable: [],
        nd: null, vd: null, density: null,
        comment: (mat.comments ? mat.comments + '\n' : '') + mat.references.slice(0, 200),
        color: null,
        group: null,
        tabData: samples,     // [[lam_nm, n, k], ...]
        sourceUrl: RII_RAW_BASE + '/data/' + mat.dataPath,
        dataPath: mat.dataPath,
        fetchedDate: new Date().toISOString().slice(0, 10),
    };
}
