/**
 * n,k samples of a parsed RII material, for the browser and the importer.
 *
 * A tabulated page is taken whole, every row as the page gives it. A formula
 * page is evaluated over the range it states, on a logarithmic grid with each
 * point 1% past the last: the same relative resolution from the ultraviolet to
 * the far infrared, so a page stated from 1 nm to 1 mm is under 1,400 points.
 * The browser's plot and table show these samples. A table page is stored as
 * them; a formula page is stored as its formula, over the range it states.
 */

import { evalFormulaN } from './formulas.js';
import { createKInterpolator, createPchipInterpolator } from '../pchip.js';

const LOG_STEP = 1.01;

// k from the page's separate k table where it has one, PCHIP between its rows.
// Beside a table, each sample takes the k the page's table gives, a negative
// one included, as a table row of negative k is imported. Beside a formula the
// k table is stored as it is and read never below zero, so the samples read it
// that way too.
function kSampler(mat, read = createPchipInterpolator) {
    return mat.tableK?.length ? read(mat.tableK) : null;
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
//
// A few pages state a range with a pole of their formula inside it, and over
// the band beside the pole n² is negative. A grid point where the formula gives
// no real, positive n is left out, and each run of such points is kept as
// [from, to] in nm so the browser can say where. A page with no real n anywhere
// fails whole.
function _sampleFromFormula(mat) {
    const [lo, hi] = mat.wavelengthRange;
    if (!(lo > 0)) return { rows: [], leftOut: [] };
    const kAt = kSampler(mat, createKInterpolator);
    const grid = [];
    for (let lam = lo; Number(lam.toPrecision(6)) < hi; lam *= LOG_STEP) grid.push(Number(lam.toPrecision(6)));
    grid.push(hi);
    const rows = [], leftOut = [];
    let run = null;
    for (const lam of grid) {
        const n = evalFormulaN(mat, lam);
        if (Number.isFinite(n)) {
            rows.push([lam, n, kAt?.(lam) ?? 0]);
            run = null;
        } else if (run) {
            run[1] = lam;
        } else {
            leftOut.push(run = [lam, lam]);
        }
    }
    if (!rows.length) {
        throw Object.assign(
            new Error(`RII formula ${mat.riiFormulaNum} gives no real n anywhere from ${lo} to ${hi} nm.`),
            { riiFormula: mat.riiFormulaNum, riiNoRealN: [lo, hi] },
        );
    }
    return { rows, leftOut };
}

function _sample(mat) {
    if (mat.tableNK) return { rows: _sampleFromTable(mat), leftOut: [] };
    if (mat.riiFormulaNum && mat.formulaCoeffs && mat.wavelengthRange) return _sampleFromFormula(mat);
    return { rows: [], leftOut: [] };
}

// Sorting a page of tens of thousands of rows takes tens of milliseconds, and
// the browser reads the samples on every render, so each parsed material is
// sampled once.
const samplesOf = new WeakMap();

function _sampled(mat) {
    if (!samplesOf.has(mat)) samplesOf.set(mat, _sample(mat));
    return samplesOf.get(mat);
}

/**
 * Every n,k sample of the material as [[lam_nm, n, k], ...], or an empty list
 * for a page with neither a table nor a formula over a stated range above zero.
 * A formula page's grid points with no real n are not in it; `leftOutRanges`
 * says where they were. The list is shared between calls for the same
 * material: read it, do not change it.
 */
export function sampleMaterial(mat) {
    return _sampled(mat).rows;
}

/**
 * The runs of grid points `sampleMaterial` left out of a formula page because
 * the formula gives no real n there, as [[from_nm, to_nm], ...]; empty for a
 * table and for a formula that is real over its whole range.
 */
export function leftOutRanges(mat) {
    return _sampled(mat).leftOut;
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
        return null;   // the browser shows the error in place of the chart
    }
    return pts.length ? [pts[0][0], pts[pts.length - 1][0]] : null;
}
