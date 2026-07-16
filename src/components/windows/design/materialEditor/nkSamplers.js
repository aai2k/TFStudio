/**
 * Material Editor — live n/k samplers built from a draft (for the preview chart).
 *
 * Pure functions, no React/DOM. A draft is either tabular (λ/n/k rows) or
 * formula-based (a Zemax dispersion formula + optional λ/k table); each type
 * gets its own sampler, unified behind buildNKFromDraft.
 */

import { evalN } from '../../../../utils/materials/dispersionFormulas.js';

// Linear interpolator over a sorted [λ, n, k] table (λ in nm). Clamps to the
// endpoints outside the range. Returns null when there is no usable data.
function makeTabularSampler(rows) {
    const data = rows
        .map(r => [parseFloat(r.lam), parseFloat(r.n), parseFloat(r.k) || 0])
        .filter(r => isFinite(r[0]) && isFinite(r[1]) && r[0] > 0)
        .sort((a, b) => a[0] - b[0]);
    if (data.length === 0) return null;
    if (data.length === 1) return () => [data[0][1], data[0][2]];
    return (lam) => {
        if (lam <= data[0][0]) return [data[0][1], data[0][2]];
        const last = data[data.length - 1];
        if (lam >= last[0]) return [last[1], last[2]];
        let lo = 0, hi = data.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (data[m][0] <= lam) lo = m; else hi = m; }
        const frac = (lam - data[lo][0]) / (data[hi][0] - data[lo][0]);
        return [data[lo][1] + frac * (data[hi][1] - data[lo][1]), data[lo][2] + frac * (data[hi][2] - data[lo][2])];
    };
}

// Linear interpolator over a sorted {lam_um, k} table (λ in µm). Clamps outside.
function makeKInterpolator(kTable) {
    return (lam_um) => {
        if (!kTable.length) return 0;
        if (lam_um <= kTable[0].lam_um) return kTable[0].k;
        const last = kTable[kTable.length - 1];
        if (lam_um >= last.lam_um) return last.k;
        let lo = 0, hi = kTable.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (kTable[m].lam_um <= lam_um) lo = m; else hi = m; }
        const frac = (lam_um - kTable[lo].lam_um) / (kTable[hi].lam_um - kTable[lo].lam_um);
        return kTable[lo].k + frac * (kTable[hi].k - kTable[lo].k);
    };
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
    return draft.type === 'tabular'
        ? makeTabularSampler(draft.rows)
        : makeFormulaSampler(draft);
}
