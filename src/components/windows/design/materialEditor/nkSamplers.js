/**
 * Material Editor — live n/k samplers built from a draft (for the preview chart).
 *
 * Pure functions, no React/DOM. A draft is either tabular (λ/n/k rows) or
 * formula-based (a Zemax dispersion formula + optional λ/k table); each type
 * gets its own sampler, unified behind buildNKFromDraft.
 */

import { evalN } from '../../../../utils/materials/dispersionFormulas.js';
import {
    createPchipInterpolator,
    createTabulatedNKSampler,
} from '../../../../utils/materials/pchip.js';
import { evaluateDispersionFit } from '../../../../utils/materials/dispersionFits.js';

// PCHIP interpolator over a [λ, n, k] table (λ in nm). Clamps to the
// endpoints outside the range. Returns null when there is no usable data.
function makeTabularSampler(rows) {
    const data = rows
        .map(r => [parseFloat(r.lam), parseFloat(r.n), parseFloat(r.k) || 0])
        .filter(r => isFinite(r[0]) && isFinite(r[1]) && r[0] > 0)
        .sort((a, b) => a[0] - b[0]);
    return createTabulatedNKSampler(data);
}

// PCHIP interpolator over a sorted {lam_um, k} table (λ in µm). Clamps outside.
function makeKInterpolator(kTable) {
    return createPchipInterpolator(kTable.map(row => [row.lam_um, row.k])) || (() => 0);
}

// Formula-mode sampler: dispersion formula for n + optional λ/k table for k.
// Returns null when the formula does not evaluate to a usable index at 0.55 µm.
function makeFormulaSampler(draft) {
    const coefficients = draft.coeffs.map(v => parseFloat(v) || 0);
    const kTable = draft.kRows
        .map(r => ({ lam_um: (parseFloat(r.lam) || 0) / 1000, k: parseFloat(r.k) || 0 }))
        .filter(r => r.lam_um > 0)
        .sort((a, b) => a.lam_um - b.lam_um);
    const interpK = makeKInterpolator(kTable);
    try {
        const testN = evalN(draft.formulaNum, coefficients, 0.55);
        if (!isFinite(testN) || testN <= 0) return null;
    } catch (_) { return null; }
    return (lam_nm) => {
        const lum = lam_nm / 1000;
        const n = evalN(draft.formulaNum, coefficients, lum);
        return [isFinite(n) ? Math.max(0, n) : 1.5, interpK(lum)];
    };
}

export function buildNKFromDraft(draft) {
    const base = draft.type === 'tabular'
        ? makeTabularSampler(draft.rows)
        : makeFormulaSampler(draft);
    if (!base || draft.type !== 'tabular' || !draft.dispersionFit?.active) return base;
    return wavelengthNm => {
        const [low, high] = draft.dispersionFit.rangeNm;
        return wavelengthNm >= low && wavelengthNm <= high
            ? evaluateDispersionFit(draft.dispersionFit, wavelengthNm)
            : base(wavelengthNm);
    };
}
