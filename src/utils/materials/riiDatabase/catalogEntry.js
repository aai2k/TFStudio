/**
 * Conversion of a fetched RII material to a catalogManager-compatible entry.
 */

import { RII_RAW_BASE } from './fetch.js';
import { sampleMaterial } from './sampling.js';
import { TABULATED_INTERPOLATION } from '../pchip.js';

/**
 * The comment a material from a refractiveindex.info page carries: the page's
 * comment and its reference, each in full, on separate lines.
 */
export function riiMaterialComment(mat) {
    return [mat.comments, mat.references].filter(Boolean).join('\n');
}

/**
 * Convert a fetched RII material to a catalogManager-compatible entry.
 * The entry can be added to a catalog with source='refractiveindex'.
 *
 * Returns a material entry object (not a full catalog — caller adds it to a
 * catalog), or null for a page with no n,k samples.
 */
export function riiToMaterialEntry(mat, pageName, bookName) {
    const samples = sampleMaterial(mat);
    if (samples.length === 0) return null;

    const lmin_um = samples[0][0] / 1000;
    const lmax_um = samples[samples.length - 1][0] / 1000;

    const id = (bookName + '_' + pageName).replace(/\s+/g, '_').replace(/[^\w-]/g, '');

    return {
        id,
        name: bookName + ' (' + pageName + ')',
        formulaNum: -1,       // tabulated in catalogManager convention
        interp: TABULATED_INTERPOLATION,
        coefficients: [],
        lambdaMin: lmin_um,
        lambdaMax: lmax_um,
        rangeDeclared: true,    // the extent of the fetched samples, not a fallback
        kTable: [],
        nd: null, vd: null, density: null,
        comment: riiMaterialComment(mat),
        color: null,
        group: null,
        tabData: samples,     // [[lam_nm, n, k], ...]
        sourceUrl: RII_RAW_BASE + '/data/' + mat.dataPath,
        dataPath: mat.dataPath,
        fetchedDate: new Date().toISOString().slice(0, 10),
    };
}
