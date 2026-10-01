/**
 * n,k samples of a parsed RII material, for the browser and the importer.
 *
 * A tabulated page is taken whole, every row as the page gives it. A formula
 * page is evaluated over the range it states, on a logarithmic grid with each
 * point 1% past the last: the same relative resolution from the ultraviolet to
 * the far infrared, so a page stated from 1 nm to 1 mm is under 1,400 points.
 * Everything that shows or stores an RII material reads these samples, so the
 * range on screen is the range that gets imported.
 */

import { evalFormulaN } from './formulas.js';
import { createPchipInterpolator } from '../pchip.js';

const LOG_STEP = 1.01;

// k from the page's separate k table where it has one, PCHIP between its rows.
function kSampler(mat) {
    return mat.tableK?.length ? createPchipInterpolator(mat.tableK) : null;
}

// In wavelength order. A few pages join datasets that overlap or repeat a
// wavelength; a repeated wavelength keeps its last row, the one the tabulated
// sampler in pchip.js computes with.
function _sampleFromTable(mat) {
    const kAt = kSampler(mat);
    const rows = mat.tableNK
        .map(([lam, n, k]) => [lam, n, kAt ? kAt(lam) : k])
        .sort((a, b) => a[0] - b[0]);
    return rows.filter((row, i) => i === rows.length - 1 || rows[i + 1][0] !== row[0]);
}

// Grid wavelengths are rounded to six significant figures, far finer than the
// 1% spacing, so the stored table reads 212.1 rather than 212.10000000000002.
// A logarithmic grid has no first point at or below zero, so a range that
// starts there gives no samples.
function _sampleFromFormula(mat) {
    const [lo, hi] = mat.wavelengthRange;
    if (!(lo > 0)) return [];
    const kAt = kSampler(mat);
    const grid = [];
    for (let lam = lo; Number(lam.toPrecision(6)) < hi; lam *= LOG_STEP) grid.push(Number(lam.toPrecision(6)));
    grid.push(hi);
    return grid.map(lam => {
        const n = evalFormulaN(mat, lam);
        if (n == null) throw new Error(`evalFormulaN returned null for formula ${mat.riiFormulaNum}`);
        return [lam, n, kAt?.(lam) ?? 0];
    });
}

function _sample(mat) {
    if (mat.tableNK) return _sampleFromTable(mat);
    if (mat.riiFormulaNum && mat.formulaCoeffs && mat.wavelengthRange) return _sampleFromFormula(mat);
    return [];
}

// Sorting a page of tens of thousands of rows takes tens of milliseconds, and
// the browser reads the samples on every render, so each parsed material is
// sampled once.
const samplesOf = new WeakMap();

/**
 * Every n,k sample of the material as [[lam_nm, n, k], ...], or an empty list
 * for a page with neither a table nor a formula over a stated range above zero.
 * The list is shared between calls for the same material: read it, do not
 * change it.
 */
export function sampleMaterial(mat) {
    if (!samplesOf.has(mat)) samplesOf.set(mat, _sample(mat));
    return samplesOf.get(mat);
}

/**
 * First and last wavelength `sampleMaterial` returns, in nm, or null when it
 * returns nothing. Taken from the samples themselves so what a caller displays
 * cannot drift from what it plots or stores: for a table, the range a record
 * declares is often wider than its rows.
 */
export function sampledRangeNm(mat) {
    let pts;
    try {
        pts = sampleMaterial(mat);
    } catch (_) {
        return null;   // an unevaluable formula; the chart reports it separately
    }
    return pts.length ? [pts[0][0], pts[pts.length - 1][0]] : null;
}
