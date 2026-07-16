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

export { buildNKFromDraft } from './nkSamplers.js';

// ── Preset dot colors for user materials ──────────────────────────────────────

export const PRESET_COLORS = [
    '#c39bd3','#85c1e9','#82e0aa','#f8c471','#f1948a',
    '#aab7b8','#5dade2','#58d68d','#eb984e','#ec7063',
    '#a569bd','#45b39d','#d4ac0d','#ba4a00','#148f77',
];

export function nextPresetColor(current) {
    const idx = PRESET_COLORS.indexOf(current);
    return PRESET_COLORS[(idx + 1) % PRESET_COLORS.length];
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
        rows: [],
        formulaNum: 2,
        coeffs: Array(10).fill(''),
        kRows: [],
        _rowSeq: 0,
    };
}

function padCoeffs(arr) {
    const r = arr.map(String);
    while (r.length < 10) r.push('');
    return r;
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
        ? mat.kTable.map(r => ({ _key: seq++, lam: String(Math.round(r.lam_um * 1000)), k: String(r.k) }))
        : [];

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
        lambdaMinNm: String(Math.round((mat.lambdaMin || 0.3) * 1000)),
        lambdaMaxNm: String(Math.round((mat.lambdaMax || 2.5) * 1000)),
        type: (isTab || isBuiltin) ? 'tabular' : 'formula',
        isRii: !!mat.dataPath,   // true for refractiveindex.info imports — hides Zemax formula UI
        rows: tabRows,
        formulaNum: (isTab || isBuiltin) ? 2 : (mat.formulaNum || 2),
        coeffs: (isTab || isBuiltin) ? Array(10).fill('') : padCoeffs(mat.coefficients || []),
        kRows,
        _rowSeq: seq,
    };
}

export function draftToMaterial(draft) {
    const id = draft.id.trim() || 'material';
    const lambdaMin = Math.max(0.1, (parseFloat(draft.lambdaMinNm) || 300) / 1000);
    const lambdaMax = Math.max(lambdaMin + 0.1, (parseFloat(draft.lambdaMaxNm) || 2500) / 1000);

    if (draft.type === 'tabular') {
        const tabData = draft.rows
            .map(r => [parseFloat(r.lam), parseFloat(r.n), parseFloat(r.k) || 0])
            .filter(r => isFinite(r[0]) && isFinite(r[1]) && r[0] > 0)
            .sort((a, b) => a[0] - b[0]);
        const lMin = tabData.length > 0 ? tabData[0][0] / 1000 : lambdaMin;
        const lMax = tabData.length > 1 ? tabData[tabData.length - 1][0] / 1000 : lambdaMax;
        return {
            id, name: draft.name.trim() || id, formulaNum: -1,
            tabData, lambdaMin: lMin, lambdaMax: lMax,
            coefficients: [], kTable: [],
            color: draft.color, group: 'User', comment: '',
            nd: null, vd: null, density: null,
            ...(draft.dataPath  ? { dataPath:  draft.dataPath  } : {}),
            ...(draft.sourceUrl ? { sourceUrl: draft.sourceUrl } : {}),
        };
    }
    const coefficients = draft.coeffs.map(v => parseFloat(v) || 0);
    const kTable = draft.kRows
        .map(r => ({ lam_um: (parseFloat(r.lam) || 0) / 1000, k: parseFloat(r.k) || 0 }))
        .filter(r => r.lam_um > 0)
        .sort((a, b) => a.lam_um - b.lam_um);
    return {
        id, name: draft.name.trim() || id, formulaNum: draft.formulaNum,
        coefficients, kTable, tabData: [],
        lambdaMin, lambdaMax,
        color: draft.color, group: 'User', comment: '',
        nd: null, vd: null, density: null,
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
    return null;
}
