/**
 * Evenly-spaced n,k sampling of a parsed RII material, for display/import.
 */

import { evalFormulaN } from './formulas.js';
import { createPchipInterpolator } from '../pchip.js';

// Subsample tabulated (lam,n,k) rows to at least `step` nm apart, keeping the
// last row so the range's upper edge is always represented.
function _sampleFromTable(mat, lmin, lmax, step) {
    const rows = mat.tableNK.filter(r => r[0] >= lmin && r[0] <= lmax);
    if (rows.length === 0) return [];
    const pts = [];
    let last = -Infinity;
    for (const r of rows) {
        if (r[0] - last >= step) { pts.push(r); last = r[0]; }
    }
    if (pts[pts.length - 1] !== rows[rows.length - 1]) pts.push(rows[rows.length - 1]);
    // Merge k from separate table if present
    if (mat.tableK && mat.tableK.length > 0) {
        const kAt = createPchipInterpolator(mat.tableK);
        for (const pt of pts) {
            pt[2] = kAt(pt[0]);
        }
    }
    return pts;
}

// Evaluate a dispersion formula on an even `step`-nm grid, clipped to the
// material's declared wavelength range.
function _sampleFromFormula(mat, lmin, lmax, step) {
    const pts = [];
    const kAt = mat.tableK ? createPchipInterpolator(mat.tableK) : null;
    const [fl0, fl1] = mat.wavelengthRange || [lmin, lmax];
    const l0 = Math.max(lmin, fl0), l1 = Math.min(lmax, fl1);
    for (let lam = l0; lam <= l1 + 0.01; lam += step) {
        const n = evalFormulaN(mat, lam);
        if (n == null) throw new Error(`evalFormulaN returned null for formula ${mat.riiFormulaNum}`);
        const k = kAt?.(lam) ?? 0;
        pts.push([Math.round(lam * 10) / 10, n, k]);
    }
    return pts;
}

/**
 * Get n,k array at evenly-spaced wavelengths for display/import.
 * Returns [[lam_nm, n, k], ...] trimmed to [lmin, lmax].
 */
export function sampleMaterial(mat, lmin = 300, lmax = 2500, step = 10) {
    if (mat.tableNK) return _sampleFromTable(mat, lmin, lmax, step);
    if (mat.riiFormulaNum && mat.formulaCoeffs) return _sampleFromFormula(mat, lmin, lmax, step);
    return [];
}
