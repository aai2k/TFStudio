/**
 * Conversion of a fetched RII material to a catalogManager-compatible entry.
 */

import { RII_RAW_BASE } from './fetch.js';
import { riiCatalogFormula } from './formulas.js';
import { sampleMaterial } from './sampling.js';
import { TABULATED_INTERPOLATION } from '../pchip.js';

/**
 * The comment a material from a refractiveindex.info page carries: the page's
 * comment and its reference, each in full, on separate lines.
 */
export function riiMaterialComment(mat) {
    return [mat.comments, mat.references].filter(Boolean).join('\n');
}

// A table page is stored as its rows, over the span they cover.
function tableData(samples) {
    return {
        formulaNum: -1,       // tabulated in catalogManager convention
        interp: TABULATED_INTERPOLATION,
        coefficients: [],
        lambdaMin: samples[0][0] / 1000,
        lambdaMax: samples[samples.length - 1][0] / 1000,
        kTable: [],
        tabData: samples,     // [[lam_nm, n, k], ...]
    };
}

// A formula page is stored as its formula: the page's coefficients under the
// catalog's number for that formula, over the range the page states, with the
// page's k table beside it in µm. A k table of zeros only is left out: k is 0
// either way, and its ends would give the material a range the table says
// nothing about.
function formulaData(mat) {
    const [lowNm, highNm] = mat.wavelengthRange;
    const kTable = mat.tableK?.some(([, k]) => k !== 0)
        ? mat.tableK.map(([lamNm, k]) => ({ lam_um: lamNm / 1000, k }))
        : [];
    return {
        formulaNum: riiCatalogFormula(mat.riiFormulaNum),
        ...(kTable.length ? { interp: TABULATED_INTERPOLATION } : {}),
        coefficients: [...mat.formulaCoeffs],
        lambdaMin: lowNm / 1000,
        lambdaMax: highNm / 1000,
        kTable,
        tabData: [],
    };
}

/**
 * Convert a fetched RII material to a catalogManager-compatible entry.
 * The entry can be added to a catalog with source='refractiveindex'.
 *
 * Returns a material entry object (not a full catalog; the caller adds it to
 * one), or null for a page with no n,k samples. Sampling the page first
 * also raises the sampler's errors, for a formula the database does not define
 * and for one with no real n anywhere in its range.
 */
export function riiToMaterialEntry(mat, pageName, bookName) {
    const samples = sampleMaterial(mat);
    if (samples.length === 0) return null;

    const id = (bookName + '_' + pageName).replace(/\s+/g, '_').replace(/[^\w-]/g, '');

    return {
        id,
        name: bookName + ' (' + pageName + ')',
        ...(mat.tableNK ? tableData(samples) : formulaData(mat)),
        rangeDeclared: true,    // the page's own range, not a fallback
        nd: null, vd: null, density: null,
        comment: riiMaterialComment(mat),
        color: null,
        group: null,
        sourceUrl: RII_RAW_BASE + '/data/' + mat.dataPath,
        dataPath: mat.dataPath,
        fetchedDate: new Date().toISOString().slice(0, 10),
    };
}
