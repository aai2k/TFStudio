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
 *
 * Implementation lives in ./optilayerParser/ (id sanitizing, table interpolation,
 * k-table building, nd lookup, doc-metadata resolution, and dispersion-model
 * routing); this file re-exports the public API from a single stable path.
 */

import { sanitizeId } from './optilayerParser/idUtils.js';
import { resolveDocMeta } from './optilayerParser/docMeta.js';
import { buildDispersionEntry } from './optilayerParser/dispersionEntry.js';
import { computeNd } from './optilayerParser/nd.js';

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

    const nType = d.nType;
    const wl = Array.isArray(d.wavelength) ? d.wavelength : null;       // nm
    const nArr = Array.isArray(d.n) ? d.n : null;
    const kArr = Array.isArray(d.k) ? d.k : null;
    const hasTable = !!(wl && wl.length > 1 && nArr && nArr.length === wl.length);

    const { name, group, comment, lambdaMin, lambdaMax } = resolveDocMeta(d, opts);

    let base = {
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

    base = buildDispersionEntry(base, { d, nType, name, wl, nArr, kArr, hasTable });
    base.nd = computeNd(base);
    return base;
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
