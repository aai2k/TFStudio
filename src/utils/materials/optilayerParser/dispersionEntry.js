import { NTYPE_TO_FORMULA, D_LINE_NM } from './constants.js';
import { buildKTable } from './kTable.js';

// Pure tabulated material → TFStudio tabular form (formulaNum -1).
function buildTabulatedEntry(base, { name, wl, nArr, kArr }) {
    if (!nArr || !nArr.length) throw new Error(`OptiLayer table "${name}" has no n data`);
    if (wl && wl.length === nArr.length) {
        base.tabData = wl.map((w, i) => [w, nArr[i], kArr ? (kArr[i] || 0) : 0]);
    } else {
        // Non-dispersive single value.
        base.tabData = [[Math.round(D_LINE_NM), nArr[0], kArr ? (kArr[0] || 0) : 0]];
    }
    base.formulaNum = -1;
    return base;
}

/** Embed the OptiLayer sampled table verbatim (unknown/unrouted dispersion family). */
export function tableFallback(base, wl, nArr, kArr) {
    base.formulaNum = -1;
    base.coefficients = [];
    base.kTable = [];
    base.tabData = wl.map((w, i) => [w, nArr[i], kArr ? (kArr[i] || 0) : 0]);
    return base;
}

// Analytic dispersion family. n comes from the formula; k (which has no
// formula in any shipped file) is taken from the embedded sampled table.
function buildFormulaEntry(base, formulaNum, { d, nType, name, wl, nArr, kArr, hasTable }) {
    const coef = Array.isArray(d.nFormulaCoef) ? d.nFormulaCoef.slice() : [];
    if (!coef.length) {
        if (hasTable) return tableFallback(base, wl, nArr, kArr);
        throw new Error(`OptiLayer material "${name}" (nType ${nType}) has no coefficients`);
    }
    base.formulaNum = formulaNum;
    base.coefficients = coef;
    base.kTable = buildKTable(wl, kArr);
    return base;
}

/**
 * Route an OptiLayer document to its dispersion representation and fill in
 * `base` accordingly (tabulated / analytic-formula / embedded-table fallback).
 * @throws {Error} when the dispersion model is unsupported and no table is present
 */
export function buildDispersionEntry(base, ctx) {
    const { nType, name, wl, nArr, kArr, hasTable } = ctx;
    const formulaNum = NTYPE_TO_FORMULA[nType];

    if (nType === 0) return buildTabulatedEntry(base, { name, wl, nArr, kArr });
    if (formulaNum != null) return buildFormulaEntry(base, formulaNum, ctx);
    if (hasTable) return tableFallback(base, wl, nArr, kArr);

    throw new Error(
        `Unsupported OptiLayer dispersion model (nType=${nType}) in "${name}" ` +
        `and no embedded data table to fall back on`);
}
