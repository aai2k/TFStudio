/**
 * optilayerParser.js — OptiLayer layer-material (.lm) / substrate (.sub) importer.
 *
 * OptiLayer exports each material as a standalone JSON document:
 *   {
 *     nType, kType,                  // dispersion-model codes for n and k
 *     nInterMethod, kInterMethod,    // table interpolation modes (0 = linear)
 *     wavelength: [nm, …] | null,    // sampled grid (nm) — present for tables AND
 *                                    //   as a precomputed cache for some formulas
 *     n: [...], k: [...],            // sampled n,k on `wavelength`
 *     nFormulaCoef: [...],           // dispersion-formula coefficients (λ in µm)
 *     kFormulaCoef: [...],
 *     name, comment, metadata: { rtti, … }
 *   }
 *
 * nType codes (CONFIRMED by exact numerical agreement against each file's own
 * embedded n-table, Δn < 1e-6, and against the OptiLayer formula editor screenshot):
 *   0 → tabulated n,k vs wavelength (nm)
 *   4 → Sellmeier   n² = A₀ + Σ Bᵢλ²/(λ²−Cᵢ)   (Cᵢ in µm²)   → formulaNum 101
 *   5 → Cauchy      n  = A₀ + A₁/λ² + A₂/λ⁴                   → formulaNum 102
 *   7 → Schott      n² = A₀ + A₁λ² + A₂/λ² + A₃/λ⁴ + A₄/λ⁶ + A₅/λ⁸ + A₆λ⁴
 *                   (7-coefficient extended Schott)           → formulaNum 103
 *
 * OptiLayer also documents Hartmann, Hartmann-2, Drude and an Exponential k
 * model, but none occur in the shipped catalogs, so their integer codes are not
 * known. The evaluators exist (dispersionFormulas.js, 104/105/106) but the parser
 * does NOT route to them; an unrecognised nType is imported from the embedded
 * sampled table when one is present, otherwise it is rejected with a clear error.
 *
 * The output is a catalogManager-compatible material entry (see catalogManager.js).
 * λ conventions: tabData in nm; coefficients/lambdaMin/lambdaMax/kTable in µm.
 */

import { evalN } from './dispersionFormulas.js';

// nType → TFStudio formulaNum for the analytic (formula) families.
const NTYPE_TO_FORMULA = {
    4: 101,  // OptiLayer Sellmeier
    5: 102,  // OptiLayer Cauchy
    7: 103,  // OptiLayer Schott (7-coefficient extended form)
};

const D_LINE_NM = 587.5618;  // helium d-line, for nd / colour assignment

function sanitizeId(name) {
    return (name || 'material')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'material';
}

/** Linear-interpolate a [[x, y], …] table (x ascending). */
function interp(table, x, yi) {
    if (!table.length) return null;
    if (x <= table[0][0]) return table[0][yi];
    if (x >= table[table.length - 1][0]) return table[table.length - 1][yi];
    let lo = 0, hi = table.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (table[mid][0] <= x) lo = mid; else hi = mid;
    }
    const t = (x - table[lo][0]) / (table[hi][0] - table[lo][0]);
    return table[lo][yi] + t * (table[hi][yi] - table[lo][yi]);
}

/**
 * Parse one already-JSON-parsed OptiLayer material document.
 *
 * @param {Object} d           parsed .lm/.sub JSON
 * @param {Object} [opts]
 * @param {string} [opts.fallbackName]  name to use when the document has none
 * @param {string} [opts.group]         catalog group label (e.g. 'Substrate')
 * @returns {Object} catalogManager material entry
 * @throws {Error} when the dispersion model is unsupported and no table is present
 */
export function parseOptiLayerDoc(d, opts = {}) {
    if (!d || typeof d !== 'object') throw new Error('Not an OptiLayer material document');

    const name = (d.name && String(d.name).trim()) || opts.fallbackName || 'material';
    const nType = d.nType;
    const wl = Array.isArray(d.wavelength) ? d.wavelength : null;       // nm
    const nArr = Array.isArray(d.n) ? d.n : null;
    const kArr = Array.isArray(d.k) ? d.k : null;
    const hasTable = !!(wl && wl.length > 1 && nArr && nArr.length === wl.length);

    const meta = d.metadata || {};
    // rtti 12 = substrate-class, 13 = layer-class in the shipped catalogs.
    const group = opts.group || (meta.rtti === 12 ? 'Substrate' : 'Imported');
    const comment = (d.comment ? String(d.comment).replace(/\s+/g, ' ').trim() : '');

    // λ range (µm). Prefer the sampled grid; fall back to a broad visible–NIR span.
    let lambdaMin = 0.3, lambdaMax = 2.5;
    if (wl && wl.length >= 1) {
        lambdaMin = Math.min(...wl) / 1000;
        lambdaMax = Math.max(...wl) / 1000;
    }

    const base = {
        id: sanitizeId(name),
        name,
        coefficients: [],
        lambdaMin, lambdaMax,
        kTable: [],
        tabData: undefined,
        nd: null, vd: null, density: null,
        comment,
        color: null,
        group,
        optilayer: { nType, kType: d.kType },
    };

    const formulaNum = NTYPE_TO_FORMULA[nType];

    if (nType === 0) {
        // Pure tabulated material → TFStudio tabular form (formulaNum -1).
        if (!nArr || !nArr.length) throw new Error(`OptiLayer table "${name}" has no n data`);
        if (wl && wl.length === nArr.length) {
            base.tabData = wl.map((w, i) => [w, nArr[i], kArr ? (kArr[i] || 0) : 0]);
        } else {
            // Non-dispersive single value.
            base.tabData = [[Math.round(D_LINE_NM), nArr[0], kArr ? (kArr[0] || 0) : 0]];
        }
        base.formulaNum = -1;
    } else if (formulaNum != null) {
        // Analytic dispersion family. n comes from the formula; k (which has no
        // formula in any shipped file) is taken from the embedded sampled table.
        const coef = Array.isArray(d.nFormulaCoef) ? d.nFormulaCoef.slice() : [];
        if (!coef.length) {
            if (hasTable) return tableFallback(base, wl, nArr, kArr);
            throw new Error(`OptiLayer material "${name}" (nType ${nType}) has no coefficients`);
        }
        base.formulaNum = formulaNum;
        base.coefficients = coef;
        base.kTable = buildKTable(wl, kArr);
    } else if (hasTable) {
        // Unknown / not-yet-wired family (e.g. Hartmann, Drude) but the file carries
        // a precomputed sample grid — import that, exactly as OptiLayer rendered it.
        return tableFallback(base, wl, nArr, kArr);
    } else {
        throw new Error(
            `Unsupported OptiLayer dispersion model (nType=${nType}) in "${name}" ` +
            `and no embedded data table to fall back on`);
    }

    base.nd = computeNd(base);
    return base;
}

/** Build kTable [{lam_um, k}] from a sampled k array, only if it carries absorption. */
function buildKTable(wl, kArr) {
    if (!wl || !kArr || kArr.length !== wl.length) return [];
    let maxk = 0;
    for (const k of kArr) if (k > maxk) maxk = k;
    if (maxk <= 0) return [];
    return wl.map((w, i) => ({ lam_um: w / 1000, k: kArr[i] || 0 }));
}

function tableFallback(base, wl, nArr, kArr) {
    base.formulaNum = -1;
    base.coefficients = [];
    base.kTable = [];
    base.tabData = wl.map((w, i) => [w, nArr[i], kArr ? (kArr[i] || 0) : 0]);
    base.nd = computeNd(base);
    return base;
}

/** Refractive index at the d-line for colour/sorting; null if outside the data range. */
function computeNd(mat) {
    try {
        if (mat.formulaNum === -1) {
            return interp(mat.tabData, D_LINE_NM, 1);
        }
        if (D_LINE_NM / 1000 < mat.lambdaMin || D_LINE_NM / 1000 > mat.lambdaMax) return null;
        const n = evalN(mat.formulaNum, mat.coefficients, D_LINE_NM / 1000);
        return isFinite(n) ? n : null;
    } catch (_) { return null; }
}

/**
 * Parse raw .lm/.sub file text.
 * @param {string} text       file contents (JSON)
 * @param {string} fileName   used as the material name fallback
 * @param {Object} [opts]     forwarded to parseOptiLayerDoc (e.g. { group })
 */
export function parseOptiLayerFile(text, fileName, opts = {}) {
    let doc;
    try { doc = JSON.parse(text); }
    catch (e) { throw new Error(`"${fileName}" is not valid OptiLayer JSON: ${e.message}`); }
    const baseName = String(fileName || '').replace(/\.(lm|sub)$/i, '');
    return parseOptiLayerDoc(doc, { fallbackName: baseName, ...opts });
}

/**
 * Build a catalogManager catalog object from a list of OptiLayer files.
 *
 * @param {Array<{name: string, text: string}>} files
 * @param {Object} cat   { id, name, source, group? }
 * @returns {{ catalog: Object, errors: Array<{file: string, error: string}> }}
 */
export function buildOptiLayerCatalog(files, cat) {
    const materials = {};
    const errors = [];
    for (const f of files) {
        try {
            const mat = parseOptiLayerFile(f.text, f.name, cat.group ? { group: cat.group } : {});
            // Ensure a unique key within this catalog.
            let id = sanitizeId(mat.name), n = 2;
            while (materials[id]) id = sanitizeId(mat.name) + '_' + n++;
            mat.id = id;
            materials[id] = mat;
        } catch (e) {
            errors.push({ file: f.name, error: e.message });
        }
    }
    return {
        catalog: { id: cat.id, name: cat.name, source: cat.source || 'optilayer', materials },
        errors,
    };
}
