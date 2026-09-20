/**
 * Material Editor — draft model and pure converters.
 *
 * A "draft" is the editable form state for a user-catalog material. These
 * helpers convert between a stored material object and a draft, and validate
 * a draft. All functions here are pure (no React, no DOM) and unit-tested.
 * The live getNK(λ) sampler used for the preview chart lives in nkSamplers.js
 * (re-exported here since callers import it alongside the draft converters).
 *
 * A user material is one of two mutually-exclusive types:
 *   tabular   — wavelength / n / k table (formulaNum === -1)
 *   formula   — one of the Zemax dispersion formulas + optional k table
 */

import { anchoredFitRange } from '../../../../utils/materials/dispersionFitRange.js';
import { interpolationRuleOf, TABULATED_INTERPOLATION } from '../../../../utils/materials/pchip.js';
import { FORMULA_LATEX } from '../../../../utils/materials/dispersionFormulas.js';
import {
    emptyMechanicalDraft, mechanicalFromDraft, mechanicalToDraft, validateMechanical,
} from './mechanicalDraft.js';
import { parseNumber, parseNumberStrict } from '../../../../utils/misc/numberParsing.js';

export { buildNKFromDraft } from './nkSamplers.js';

/**
 * Fit models worth offering for a table.
 *
 * The metal models describe free carriers and interband absorption. A table with
 * no absorption in it gives them nothing to fit, and a Lorentz oscillator asked
 * to explain k = 0 only finds a resonance between two samples.
 */
export function fitModelsForRows(rows) {
    const absorbing = (rows || []).some(row => parseNumberStrict(row.k) > 0);
    return absorbing
        ? ['cauchy', 'sellmeier', 'drude', 'drude-lorentz']
        : ['cauchy', 'sellmeier'];
}

/** The chosen fit model, or the first one still on offer for this table. */
export function effectiveFitModel(draft) {
    const models = fitModelsForRows(draft.rows);
    return models.includes(draft.fitModel) ? draft.fitModel : models[0];
}

/** The table as the fitter reads it: [λ nm, n, k] rows, half-typed ones dropped. */
export function fitRows(draft) {
    return (draft.rows || [])
        .map(row => [parseNumberStrict(row.lam), parseNumberStrict(row.n), parseNumber(row.k)])
        .filter(row => row.every(Number.isFinite));
}

/**
 * The wavelengths a draft's table covers, in nm, or null while it has none.
 *
 * Walked rather than spread into Math.min: a table with more rows than the
 * engine takes arguments is a stack overflow, and some published tables are
 * already thousands of rows long.
 */
export function tableRangeNm(rows) {
    let low = Infinity;
    let high = -Infinity;
    for (const row of rows || []) {
        const wavelength = parseNumberStrict(row.lam);
        if (!Number.isFinite(wavelength)) continue;
        low = Math.min(low, wavelength);
        high = Math.max(high, wavelength);
    }
    return low <= high ? [low, high] : null;
}

/**
 * The band the fit covers, which is not the material's stated validity range.
 *
 * A table can hold far more than any one dispersion model describes, so the fit
 * gets its own band and keeps it: `rangeNm` travels with the fit and comes back
 * on the next load. Until one is set, the band offered is the one the design is
 * evaluated over, where the table reaches that far, since that is where the fit
 * has to be right; the whole table is the fallback and the worst case.
 *
 * Each edge is taken on its own, so filling one box keeps the other's offer
 * rather than throwing the typed edge away, and both are held inside the table:
 * a model asked for wavelengths its data never covered is worth less than the
 * last row of the table, which is what is read there instead.
 */
export function fitRangeNm(draft, workingNm) {
    const table = tableRangeNm(draft.rows);
    if (!table) return null;
    const offered = (workingNm
        && anchoredFitRange(fitRows(draft).map(row => row[0]), workingNm)) || table;
    const typed = [parseNumberStrict(draft.fitRangeMinNm), parseNumberStrict(draft.fitRangeMaxNm)];
    const low = Math.max(table[0], Number.isFinite(typed[0]) ? typed[0] : offered[0]);
    const high = Math.min(table[1], Number.isFinite(typed[1]) ? typed[1] : offered[1]);
    return [Math.min(low, high), Math.max(low, high)];
}

// ── Preset dot colors for user materials ──────────────────────────────────────

// Saturated and widely spaced in hue so two materials never read as the same
// dot. The first eight are the row offered in the editor.
export const PRESET_COLORS = [
    '#e6194b','#f58231','#e8a600','#2fa84f','#00968a',
    '#00a5c8','#2c7be5','#8e2fc0','#d6289b','#a0522d',
    '#7f9c00','#c0392b','#0f6fd1','#12a150','#5c6b7a',
];

export function nextPresetColor(current) {
    const idx = PRESET_COLORS.indexOf(current);
    return PRESET_COLORS[(idx + 1) % PRESET_COLORS.length];
}

/**
 * Stable fingerprint of a draft's user-visible content, used to tell an edited
 * draft from the one that was loaded. Row identity keys and the key counter are
 * excluded: they are React bookkeeping, not data the user typed.
 */
export function draftFingerprint(draft) {
    if (!draft) return '';
    return JSON.stringify(draft, (key, value) =>
        (key === '_key' || key === '_rowSeq') ? undefined : value);
}

// ── Draft ↔ material converters ───────────────────────────────────────────────

export function emptyDraft(catalogId) {
    return {
        catalogId,
        isNew: true,
        idAuto: true,
        id: '',
        name: '',
        color: 'auto',
        lambdaMinNm: '300',
        lambdaMaxNm: '2500',
        type: 'tabular',
        interp: TABULATED_INTERPOLATION,
        rows: [],
        formulaNum: 2,
        coeffs: Array(10).fill(''),
        coeffSlots: seriesSlotCount(2, []),
        kRows: [],
        dispersionFit: null,
        fitModel: 'cauchy',
        fitTerms: 3,
        fitRangeMinNm: '',
        fitRangeMaxNm: '',
        mechanical: emptyMechanicalDraft(),
        _rowSeq: 0,
    };
}

function padCoeffs(arr) {
    const r = arr.map(String);
    while (r.length < 10) r.push('');
    return r;
}

// An open-ended series (Cauchy, general Sellmeier) has as many terms as it
// carries, so the empty fields after the last filled one are not terms. Whole
// terms only: a Sellmeier pair with one zero half stays a pair.
export function trimSeriesCoefficients(formulaNum, coefficients) {
    const info = FORMULA_LATEX[formulaNum];
    if (!info?.termSize) return coefficients;
    const base = info.coeffNames.length;
    let end = coefficients.length;
    while (end > base && !(Math.abs(coefficients[end - 1]) > 0)) end--;
    end = base + Math.ceil((end - base) / info.termSize) * info.termSize;
    return coefficients.slice(0, end);
}

// Coefficient fields a formula shows: a fixed formula its own list, an
// open-ended series its base terms plus every whole term the values carry.
export function seriesSlotCount(formulaNum, coefficients) {
    const info = FORMULA_LATEX[formulaNum];
    if (!info) return 6;
    const base = info.coeffNames.length;
    if (!info.termSize) return base;
    return Math.max(base, trimSeriesCoefficients(formulaNum, coefficients || []).length);
}

// Fields the form shows for a draft. The draft's own count survives a field
// being emptied for retyping; a value beyond it is never hidden.
export function coefficientSlots(draft) {
    return Math.max(draft.coeffSlots ?? 0, seriesSlotCount(draft.formulaNum, (draft.coeffs || []).map(parseNumber)));
}

// Switch a formula draft to another formula. Slots beyond the new formula's
// own list are cleared, so values typed for one formula never become extra
// terms of an open-ended series.
export function withFormula(draft, formulaNum) {
    const info = FORMULA_LATEX[formulaNum];
    const base = info ? info.coeffNames.length : 6;
    return { ...draft, formulaNum, coeffSlots: base, coeffs: padCoeffs(draft.coeffs.slice(0, base)) };
}

// One more term of an open-ended series (a pair for Sellmeier), shown empty.
export function withAddedTerm(draft) {
    const info = FORMULA_LATEX[draft.formulaNum];
    if (!info?.termSize) return draft;
    const coeffSlots = coefficientSlots(draft) + info.termSize;
    const coeffs = draft.coeffs.slice();
    while (coeffs.length < coeffSlots) coeffs.push('');
    return { ...draft, coeffSlots, coeffs };
}

// Sample a built-in getNK function into draft rows over the material's range.
// formulaNum === 0 means "built-in JS function" — no stored formula/tabular data,
// so we must sample getNK to produce tabular data when copying to a user catalog.
function sampleBuiltinRows(mat, startSeq) {
    const rows = [];
    let seq = startSeq;
    const smin = Math.max(100, Math.round((mat.lambdaMin || 0.2) * 1000));
    const smax = Math.min(25000, Math.round((mat.lambdaMax || 2.5) * 1000));
    const N = 200;
    for (let i = 0; i < N; i++) {
        const lam = Math.round(smin + (i / (N - 1)) * (smax - smin));
        try {
            const [n, k] = mat.getNK(lam);
            if (isFinite(n)) rows.push({ _key: seq++, lam: String(lam), n: String(+n.toFixed(6)), k: String(+(k || 0).toFixed(8)) });
        } catch (_) { /* skip invalid points */ }
    }
    return { rows, seq };
}

export function materialToDraft(catalogId, mat) {
    const isTab = mat.formulaNum === -1;
    const isBuiltin = mat.formulaNum === 0 && typeof mat.getNK === 'function';

    // Sanitize legacy RII IDs that contain colons (old separator before the fix).
    // originalId tracks the stored key so save/delete can find and remove the old entry.
    // A catalog material's id should always be set (the registry backfills it
    // from the map key), but guard anyway so a malformed entry can never crash
    // the click handler — fall back to originalId / name / 'material'.
    const rawId = mat.id || mat.originalId || mat.name || 'material';
    const safeId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, '_');

    const sampled = isBuiltin ? sampleBuiltinRows(mat, 0) : { rows: [], seq: 0 };
    let seq = sampled.seq;
    const tabRows = isTab
        ? (mat.tabData || []).map(r => ({ _key: seq++, lam: String(r[0]), n: String(r[1]), k: String(r[2] || 0) }))
        : sampled.rows;
    const kRows = (!isTab && !isBuiltin && mat.kTable)
        ? mat.kTable.map(r => ({ _key: seq++, lam: String(Number((r.lam_um * 1000).toFixed(3))), k: String(r.k) }))
        : [];
    const formulaNum = (isTab || isBuiltin) ? 2 : (mat.formulaNum || 2);
    const fitRange = mat.dispersionFit?.rangeNm || [];

    return {
        catalogId,
        isNew: false,
        idAuto: false,
        id: safeId,
        originalId: mat.id,         // actual key in catalog.materials (may differ from safeId)
        dataPath:  mat.dataPath  || null,
        sourceUrl: mat.sourceUrl || null,
        name: mat.name || mat.id,
        color: mat.color || 'auto',   // no stored color → automatic (index-derived)
        // Kept to the picometre so a stated 361.2 nm limit stays 361.2 in the form.
        lambdaMinNm: String(Number(((mat.lambdaMin || 0.3) * 1000).toFixed(3))),
        lambdaMaxNm: String(Number(((mat.lambdaMax || 2.5) * 1000).toFixed(3))),
        type: (isTab || isBuiltin) ? 'tabular' : 'formula',
        interp: interpolationRuleOf(mat),
        isRii: !!mat.dataPath,   // true for refractiveindex.info imports — hides Zemax formula UI
        rows: tabRows,
        formulaNum,
        coeffs: (isTab || isBuiltin) ? Array(10).fill('') : padCoeffs(mat.coefficients || []),
        coeffSlots: seriesSlotCount(formulaNum, (isTab || isBuiltin) ? [] : (mat.coefficients || [])),
        kRows,
        dispersionFit: mat.dispersionFit ? structuredClone(mat.dispersionFit) : null,
        fitModel: mat.dispersionFit?.complex?.kind
            || mat.dispersionFit?.n?.kind
            || 'cauchy',
        // The band the stored fit covers, so a fit narrower than the table comes
        // back as it was made rather than widening to the table on the next Refit.
        fitRangeMinNm: fitRange[0] == null ? '' : String(fitRange[0]),
        fitRangeMaxNm: fitRange[1] == null ? '' : String(fitRange[1]),
        mechanical: mechanicalToDraft(mat.mechanical),
        _rowSeq: seq,
    };
}

// The stated validity range in µm, the fallback for a material whose own data
// does not say where it starts and ends.
function draftRangeUm(draft) {
    const lambdaMin = Math.max(0.1, (parseNumber(draft.lambdaMinNm) || 300) / 1000);
    return [lambdaMin, Math.max(lambdaMin + 0.1, (parseNumber(draft.lambdaMaxNm) || 2500) / 1000)];
}

// A table material. Its range comes from the data rather than from the stated
// one, since the table is the material.
function tabularFromDraft(draft, [lambdaMin, lambdaMax]) {
    const tabData = draft.rows
        .map(r => [parseNumberStrict(r.lam), parseNumberStrict(r.n), parseNumber(r.k)])
        .filter(r => isFinite(r[0]) && isFinite(r[1]) && r[0] > 0)
        .sort((a, b) => a[0] - b[0]);
    return {
        formulaNum: -1,
        interp: interpolationRuleOf(draft),
        tabData, coefficients: [], kTable: [],
        lambdaMin: tabData.length > 0 ? tabData[0][0] / 1000 : lambdaMin,
        lambdaMax: tabData.length > 1 ? tabData[tabData.length - 1][0] / 1000 : lambdaMax,
        ...(draft.dispersionFit ? { dispersionFit: draft.dispersionFit } : {}),
        ...(draft.dataPath  ? { dataPath:  draft.dataPath  } : {}),
        ...(draft.sourceUrl ? { sourceUrl: draft.sourceUrl } : {}),
    };
}

// A dispersion-formula material, with the k table it may carry beside it.
function formulaFromDraft(draft, [lambdaMin, lambdaMax]) {
    const kTable = draft.kRows
        .map(r => ({ lam_um: parseNumber(r.lam) / 1000, k: parseNumber(r.k) }))
        .filter(r => r.lam_um > 0)
        .sort((a, b) => a.lam_um - b.lam_um);
    return {
        formulaNum: draft.formulaNum,
        coefficients: trimSeriesCoefficients(draft.formulaNum, draft.coeffs.map(parseNumber)),
        kTable, tabData: [],
        ...(kTable.length ? { interp: interpolationRuleOf(draft) } : {}),
        lambdaMin, lambdaMax,
    };
}

export function draftToMaterial(draft) {
    const id = draft.id.trim() || 'material';
    const range = draftRangeUm(draft);
    const mechanical = mechanicalFromDraft(draft.mechanical);
    return {
        id, name: draft.name.trim() || id,
        color: draft.color, group: 'User', comment: '',
        nd: null, vd: null, density: null,
        ...(mechanical ? { mechanical } : {}),
        ...(draft.type === 'tabular' ? tabularFromDraft(draft, range) : formulaFromDraft(draft, range)),
    };
}

export function validateDraft(draft, catalogs, me) {
    if (!draft.name.trim()) return me.validationNoName;
    const idTrimmed = draft.id.trim();
    if (!idTrimmed || !/^[a-zA-Z0-9_-]+$/.test(idTrimmed)) return me.validationBadId;
    if (draft.isNew) {
        const cat = catalogs.find(c => c.id === draft.catalogId);
        if (cat?.materials?.[idTrimmed]) return me.validationDuplicateId(idTrimmed);
    }
    return validateMechanical(draft.mechanical, me);
}
