/**
 * Material Editor — live n/k samplers built from a draft (for the preview chart).
 *
 * Pure functions, no React/DOM. A draft is either tabular (λ/n/k rows) or
 * formula-based (a Zemax dispersion formula + optional λ/k table); each type
 * gets its own sampler, unified behind buildNKFromDraft.
 */

import { evalN } from '../../../../utils/materials/dispersionFormulas.js';
import {
    createKInterpolator,
    createTabulatedNKSampler,
    interpolationRuleOf,
} from '../../../../utils/materials/pchip.js';
import { evaluateDispersionFit } from '../../../../utils/materials/dispersionFits.js';
import { parseNumber, parseNumberStrict } from '../../../../utils/misc/numberParsing.js';

// The form reads a draft's table on every keystroke anywhere in it, and a
// table of tens of thousands of rows takes a tenth of a second to read, so what
// is read off it is kept per rows array and read again only when the rows
// change. A draft's rows are replaced, never edited in place.
const tableReads = new WeakMap();

/** `read(rows)`, computed once for each rows array and `key`. */
export function readOnce(rows, key, read) {
    if (!Array.isArray(rows)) return read([]);
    if (!tableReads.has(rows)) tableReads.set(rows, new Map());
    const kept = tableReads.get(rows);
    if (!kept.has(key)) kept.set(key, read(rows));
    return kept.get(key);
}

/** A table's cells as numbers, [λ nm, n, k] per row, NaN where a cell does not parse. */
export function parsedRows(rows) {
    return readOnce(rows, 'parsed', table =>
        table.map(r => [parseNumberStrict(r.lam), parseNumberStrict(r.n), parseNumber(r.k)]));
}

function readTable(rows, rule) {
    const data = parsedRows(rows)
        .filter(r => isFinite(r[0]) && isFinite(r[1]) && r[0] > 0)
        .sort((a, b) => a[0] - b[0]);
    return createTabulatedNKSampler(data, rule);
}

// Interpolator over a [λ, n, k] table (λ in nm) under the draft's rule.
// Clamps to the endpoints outside the range. Returns null when there is no
// usable data.
function makeTabularSampler(draft) {
    const rule = interpolationRuleOf(draft);
    return readOnce(draft.rows, `sampler:${rule}`, rows => readTable(rows, rule));
}

// Interpolator over a sorted {lam_um, k} table (λ in µm) under the draft's
// rule. Clamps outside, and never goes below zero.
function makeKInterpolator(kTable, draft) {
    return createKInterpolator(kTable.map(row => [row.lam_um, row.k]), interpolationRuleOf(draft)) || (() => 0);
}

// Formula-mode sampler: dispersion formula for n + optional λ/k table for k.
// Returns null when the formula does not evaluate to a usable index at 0.55 µm.
function makeFormulaSampler(draft) {
    const coefficients = draft.coeffs.map(parseNumber);
    const kTable = draft.kRows
        .map(r => ({ lam_um: parseNumber(r.lam) / 1000, k: parseNumber(r.k) }))
        .filter(r => r.lam_um > 0)
        .sort((a, b) => a.lam_um - b.lam_um);
    const interpK = makeKInterpolator(kTable, draft);
    try {
        const testN = evalN(draft.formulaNum, coefficients, 0.55);
        if (!isFinite(testN) || testN <= 0) return null;
    } catch (_) { return null; }
    // A wavelength where the formula has no finite value is left without one,
    // so the chart and the preview table leave it out.
    return (lam_nm) => {
        const lum = lam_nm / 1000;
        const n = evalN(draft.formulaNum, coefficients, lum);
        return [isFinite(n) ? Math.max(0, n) : NaN, interpK(lum)];
    };
}

export function buildNKFromDraft(draft) {
    const base = draft.type === 'tabular'
        ? makeTabularSampler(draft)
        : makeFormulaSampler(draft);
    if (!base || draft.type !== 'tabular' || !draft.dispersionFit?.active) return base;
    return wavelengthNm => {
        const [low, high] = draft.dispersionFit.rangeNm;
        return wavelengthNm >= low && wavelengthNm <= high
            ? evaluateDispersionFit(draft.dispersionFit, wavelengthNm)
            : base(wavelengthNm);
    };
}
