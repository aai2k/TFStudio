/**
 * Catalog manager — unified material registry.
 *
 * Material IDs:
 *   Legacy (built-in):   'BK7', 'SiO2', 'Air', ...   (backward-compat with saved designs)
 *   New compound:        'catalogId:materialName'      (e.g. 'schott:N-BK7')
 *
 * Catalog sources:
 *   'builtin'          — wrapped materialDatabase.js materials (not persisted to disk)
 *   'agf'              — imported from a Zemax .AGF file
 *   'user'             — user-defined
 *   'refractiveindex'  — downloaded from refractiveindex.info
 *
 * Persistence: each non-builtin catalog is stored as its own JSON file in
 *   Documents\TFStudio\Materials\<source>\<id>.catalog.json
 *   via the Electron main process (catalog:save / catalog:delete IPC channels).
 *
 * Initialisation: call initCatalogs(loadedData) once at app startup, after
 *   window.electronAPI.loadCatalogs() has resolved.  All subsequent calls to
 *   getCatalogs() / getMaterialById() etc. are synchronous.
 */

import { MATERIALS } from './materialDatabase.js';
import { evalN } from './dispersionFormulas.js';

// ── Builtin catalog ───────────────────────────────────────────────────────────

function buildBuiltinCatalog() {
    const mats = {};
    for (const m of MATERIALS) {
        // Real validity range (nm) attached to getNK by materialDatabase.js — the
        // exact tabulated extent for table materials, the literature range for the
        // Sellmeier fits. Fall back to a broad span for range-less entries (Air,
        // Custom). Stored in µm to match the rest of the material schema.
        const r = (typeof m.getNK === 'function' && m.getNK.rangeNm) || null;
        mats[m.id] = {
            id: m.id,
            name: m.name,
            formulaNum: 0,          // 0 = built-in JS function
            coefficients: [],
            lambdaMin: r ? r[0] / 1000 : 0.2,
            lambdaMax: r ? r[1] / 1000 : 20.0,
            kTable: [],
            nd: null,
            vd: null,
            density: null,
            comment: m.description || '',
            color: m.color,
            group: m.group,
            getNK: m.getNK,         // direct function reference
        };
    }
    return {
        id: 'builtin',
        name: 'Built-in',
        source: 'builtin',
        materials: mats,
    };
}

// ── k interpolation from IT table ─────────────────────────────────────────────

function interpK(kTable, lambda_um) {
    if (!kTable || kTable.length === 0) return 0;
    if (lambda_um <= kTable[0].lam_um) return kTable[0].k;
    if (lambda_um >= kTable[kTable.length - 1].lam_um) return kTable[kTable.length - 1].k;
    let lo = 0, hi = kTable.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (kTable[mid].lam_um <= lambda_um) lo = mid; else hi = mid;
    }
    const t = (lambda_um - kTable[lo].lam_um) / (kTable[hi].lam_um - kTable[lo].lam_um);
    return kTable[lo].k + t * (kTable[hi].k - kTable[lo].k);
}

// ── getNK builder for catalog materials ──────────────────────────────────────

function makeGetNK(mat) {
    if (mat.getNK) return mat.getNK;
    // formulaNum === -1 → user tabular: tabData = [[lam_nm, n, k], ...]
    if (mat.formulaNum === -1) {
        const data = (mat.tabData || []).slice().sort((a, b) => a[0] - b[0]);
        if (data.length === 0) return () => [1.5, 0];
        if (data.length === 1) return () => [data[0][1], data[0][2] || 0];
        return (lambda_nm) => {
            if (lambda_nm <= data[0][0]) return [data[0][1], data[0][2] || 0];
            const last = data[data.length - 1];
            if (lambda_nm >= last[0]) return [last[1], last[2] || 0];
            let lo = 0, hi = data.length - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (data[mid][0] <= lambda_nm) lo = mid; else hi = mid;
            }
            const frac = (lambda_nm - data[lo][0]) / (data[hi][0] - data[lo][0]);
            return [
                data[lo][1] + frac * (data[hi][1] - data[lo][1]),
                (data[lo][2] || 0) + frac * ((data[hi][2] || 0) - (data[lo][2] || 0))
            ];
        };
    }
    return (lambda_nm) => {
        const lum = lambda_nm / 1000;
        const n = evalN(mat.formulaNum, mat.coefficients, lum);
        const k = interpK(mat.kTable, lum);
        return [n, k];
    };
}

// ── Color assignment ──────────────────────────────────────────────────────────

const GROUP_COLORS = {
    'Ambient':      '#87CEEB',
    'Substrate':    '#d6eaf8',
    'Dielectric':   '#d5f5e3',
    'Semiconductor':'#bdc3c7',
    'Metal':        '#f1c40f',
    'TCO':          '#a9cce3',
    'Custom':       '#c39bd3',
};

function catalogColor(catalogId) {
    let hash = 0;
    for (let i = 0; i < catalogId.length; i++) hash = (hash * 31 + catalogId.charCodeAt(i)) >>> 0;
    const hue = ((hash >> 4) & 0xfff) % 360;
    // Richer + a touch darker than the old (55%, 78%) pastel so the dot reads
    // clearly on dark themes (very pale chips washed out against dark panels)
    // while staying legible on light. Hue (the identity) is unchanged.
    return `hsl(${hue}, 60%, 66%)`;
}

/**
 * Derive a material dot color from nd (refractive index at d-line).
 * Follows the thin-film convention: low-n = blue, high-n = orange/red.
 */
function ndColor(nd) {
    if (!nd || nd <= 0) return '#aaa';
    // Map nd 1.3..3.5 → hue 220..0 (blue→red)
    const t = Math.max(0, Math.min(1, (nd - 1.3) / (3.5 - 1.3)));
    const hue = Math.round(220 * (1 - t));
    // Saturation rises with index; lightness lowered from 65%→58% and saturation
    // floor raised (55→63) so low-index (blue) dots stop looking dull/pale on
    // dark themes. Hue mapping (the n→colour identity) is unchanged.
    const sat = 63 + Math.round(17 * t);
    return `hsl(${hue}, ${sat}%, 58%)`;
}

// Reference wavelength for deriving an automatic color when a material has no
// stored `nd` (RII/AGF/library/user materials) — uses the refractive index at
// this λ so every material gets a meaningful color from its own dispersion.
const AUTOCOLOR_REF_NM = 550;

// The index-derived ("automatic") color for a material: ndColor of its `nd`,
// or — when nd is absent — of n sampled from getNK at the reference wavelength.
function materialAutoColor(mat) {
    if (!mat) return ndColor(null);
    let nd = mat.nd;
    if (!(nd > 0)) {
        const fn = mat.getNK || makeGetNK(mat);
        try {
            const nk = typeof fn === 'function' ? fn(AUTOCOLOR_REF_NM) : null;
            nd = Array.isArray(nk) ? nk[0] : (nk && nk.n);
        } catch (_) { nd = null; }
    }
    return ndColor(nd);
}

// THE display color for a material. An explicit `color` (a preset/picked hex)
// wins; otherwise — no color, or the explicit `'auto'` sentinel — the color is
// derived from the refractive index. Imported materials (RII/library/AGF)
// carry no color and so are automatic by default; user materials may store
// 'auto' to opt in. This is the single source of truth for material color
// across the app (Material Editor, Design Editor, analysis windows, synthesis).
function resolveColor(mat) {
    if (mat && mat.color && mat.color !== 'auto') return mat.color;
    return materialAutoColor(mat);
}

// ── Registry ──────────────────────────────────────────────────────────────────

let _catalogs = {};        // id → catalog object
let _initialized = false;

function ensureInit() {
    if (_initialized) return;
    _catalogs = { builtin: buildBuiltinCatalog() };
    _initialized = true;
}

// Persist one catalog to Documents\TFStudio\Materials\ via IPC (fire-and-forget).
function persistCatalog(cat) {
    if (!cat || cat.source === 'builtin') return;
    window.electronAPI?.saveCatalog(serializeCatalog(cat));
}

// Delete a catalog file via IPC (fire-and-forget).
function deleteCatalogFile(catalogId, source) {
    window.electronAPI?.deleteCatalog(catalogId, source);
}

// Backfill a missing/blank material `id` from its map key. A catalog material's
// key in `cat.materials` IS its id by contract, but some sources persisted
// entries without an explicit `id` field (e.g. the legacy multipassband sample
// catalog) — those rendered as dead grey rows that sorted to the top (empty id)
// and crashed materialToDraft (`mat.id.replace`). Normalising here, at the one
// registration boundary, heals existing AND future catalogs in place.
function normalizeCatalogMaterials(cat) {
    if (!cat || !cat.materials) return cat;
    for (const [key, m] of Object.entries(cat.materials)) {
        if (m && (m.id == null || m.id === '')) m.id = key;
    }
    return cat;
}

function serializeCatalog(cat) {
    // Strip non-serializable function references
    const mats = {};
    for (const [id, m] of Object.entries(cat.materials)) {
        // eslint-disable-next-line no-unused-vars
        const { getNK, ...rest } = m;
        mats[id] = rest;
    }
    return { ...cat, materials: mats };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialize the registry with catalogs already loaded from disk.
 * Must be called once at app start, after window.electronAPI.loadCatalogs() resolves.
 *
 * @param {Object} persistedCatalogs  id → raw catalog object from disk (may be empty)
 */
export function initCatalogs(persistedCatalogs = {}) {
    _catalogs = { builtin: buildBuiltinCatalog() };
    for (const cat of Object.values(persistedCatalogs)) {
        if (cat.id && cat.id !== 'builtin') {
            // The registry is keyed by id only (materials are referenced as
            // `<catalogId>:<matId>`), so two catalogs that share an id across
            // sources collide — last-loaded silently wins. Warn rather than
            // hiding it; ids are expected to be unique across sources.
            const prev = _catalogs[cat.id];
            if (prev && prev.source !== cat.source) {
                console.warn(`Catalog id "${cat.id}" collides across sources on load (${prev.source} vs ${cat.source}) — last wins.`);
            }
            _catalogs[cat.id] = normalizeCatalogMaterials(cat);
        }
    }
    _initialized = true;
}

/** All catalogs as an ordered array (builtin first, then alphabetically). */
export function getCatalogs() {
    ensureInit();
    return [
        _catalogs['builtin'],
        ...Object.values(_catalogs)
            .filter(c => c.id !== 'builtin')
            .sort((a, b) => a.name.localeCompare(b.name))
    ].filter(Boolean);
}

/** Get a catalog by id. */
export function getCatalog(id) {
    ensureInit();
    return _catalogs[id] ?? null;
}

/**
 * Register an imported AGF catalog (from parseAGF).
 * Overwrites any existing catalog with the same id.
 */
export function addCatalog(catalogData) {
    ensureInit();
    if (catalogData.id === 'builtin') throw new Error('Cannot override builtin catalog');
    const cat = normalizeCatalogMaterials({ ...catalogData, source: catalogData.source || 'agf' });
    const existing = _catalogs[cat.id];
    if (existing && existing.source && existing.source !== cat.source) {
        console.warn(`Catalog id "${cat.id}" collides across sources (existing ${existing.source} → new ${cat.source}); replacing. Ids should be unique across sources.`);
    }
    _catalogs[cat.id] = cat;
    persistCatalog(cat);
    return cat;
}

/** Remove an imported catalog. Builtin cannot be removed. */
export function removeCatalog(catalogId) {
    if (catalogId === 'builtin') return;
    ensureInit();
    const cat = _catalogs[catalogId];
    delete _catalogs[catalogId];
    deleteCatalogFile(catalogId, cat?.source);
}

/**
 * Resolve a material ID to a material object with a getNK function.
 *
 * Supports:
 *   'BK7'          → builtin:BK7  (legacy backward-compat)
 *   'builtin:BK7'  → builtin catalog
 *   'schott:N-BK7' → schott catalog
 *
 * Returns null if not found.
 */
export function getMaterialById(id) {
    ensureInit();
    if (!id) return null;

    let catalogId, matId;

    if (id.includes(':')) {
        const sep = id.indexOf(':');
        catalogId = id.slice(0, sep);
        matId = id.slice(sep + 1);
    } else {
        // Legacy: look up in builtin first
        catalogId = 'builtin';
        matId = id;
    }

    const cat = _catalogs[catalogId];
    if (!cat) return null;

    const mat = cat.materials[matId];
    if (!mat) return null;

    if (!mat.getNK) {
        mat.getNK = makeGetNK(mat);
        // NOTE: color is intentionally NOT baked here. A material's stored color
        // stays null/'auto' (= automatic) so the Material Editor can show it as
        // automatic and renames/edits stay live; resolveColor(mat) derives the
        // display color on demand.
    }

    return mat;
}

// Ids already warned about — so a missing material logs ONCE, not once per
// wavelength sample (which would flood the console during a spectrum scan).
const _warnedMissingMat = new Set();

/**
 * Get [n, k] for a material ID at a given wavelength.
 * Falls back to Air (n=1, k=0) if the material is not found — but WARNS (once
 * per id) so a design silently referencing a missing/deleted material (which
 * would otherwise compute that layer as vacuum) is visible, not silent.
 */
export function getNKById(id, lambda_nm) {
    const mat = getMaterialById(id);
    if (!mat || !mat.getNK) {
        if (id != null && id !== '' && !_warnedMissingMat.has(id)) {
            _warnedMissingMat.add(id);
            console.warn(`[TFStudio] Material '${id}' not found — falling back to Air (n=1, k=0); any layer using it is computed as vacuum.`);
        }
        return [1.0, 0];
    }
    return mat.getNK(lambda_nm);
}

/**
 * Search materials across all catalogs.
 * Returns array of { catalogId, catalogName, material } sorted by match quality.
 */
// Score a single material against a lowercased query. Returns the sort score
// (id-prefix 0 < name-substring 1 < id-substring 2 < no-query 3) or null when
// the material is malformed or does not match. Falls back to the material key
// for a missing id/name so a bad entry can't crash the picker.
function scoreMaterialMatch(mat, matKey, q) {
    if (!mat) return null;
    const id   = (mat.id   || matKey || '').toLowerCase();
    const name = (mat.name || matKey || '').toLowerCase();
    const nameMatch = name.includes(q);
    const idMatch = id.includes(q);
    if (q && !nameMatch && !idMatch) return null;
    return q ? (id.startsWith(q) ? 0 : nameMatch ? 1 : 2) : 3;
}

export function searchMaterials(query, catalogFilter) {
    ensureInit();
    const q = (query || '').toLowerCase().trim();
    const results = [];

    const cats = catalogFilter
        ? [_catalogs[catalogFilter]].filter(Boolean)
        : getCatalogs();

    for (const cat of cats) {
        if (!cat) continue;
        for (const [matKey, mat] of Object.entries(cat.materials)) {
            const score = scoreMaterialMatch(mat, matKey, q);
            if (score !== null) {
                results.push({ catalogId: cat.id, catalogName: cat.name, material: mat, score });
            }
        }
    }

    results.sort((a, b) => a.score - b.score || (a.material.id || '').localeCompare(b.material.id || ''));
    return results;
}

/**
 * Convert a legacy material id (e.g. 'BK7') to compound form ('builtin:BK7').
 * If already compound, returns as-is. If not found anywhere, returns 'builtin:Air'.
 */
export function normalizeId(id) {
    if (!id) return 'builtin:Air';
    if (id.includes(':')) return id;
    // Check builtin
    const mat = getMaterialById(id);
    if (mat) return `builtin:${id}`;
    return 'builtin:Air';
}

/**
 * Short display label for a material ID.
 * 'schott:N-BK7' → 'N-BK7'
 * 'builtin:BK7' → 'BK7'
 * 'BK7' → 'BK7'
 */
export function materialLabel(id) {
    if (!id) return '';
    if (id.includes(':')) return id.slice(id.indexOf(':') + 1);
    return id;
}

// ── User catalog management ───────────────────────────────────────────────────

/** Create a new empty user-defined catalog with a unique generated ID. */
export function createUserCatalog(name) {
    ensureInit();
    let base = 'user_' + (name || 'catalog').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base || base === 'user_') base = 'user_catalog';
    let id = base, n = 2;
    while (_catalogs[id]) id = base + '_' + n++;
    const cat = { id, name: name || 'User Catalog', source: 'user', materials: {} };
    _catalogs[id] = cat;
    persistCatalog(cat);
    return cat;
}

/** Rename a user catalog. */
export function renameUserCatalog(catalogId, newName) {
    ensureInit();
    const cat = _catalogs[catalogId];
    if (!cat || cat.source !== 'user') return;
    cat.name = newName;
    persistCatalog(cat);
}

/**
 * Generate a unique material ID within a user catalog, derived from name.
 * Safe for use as the key in cat.materials.
 */
export function generateMaterialId(catalogId, name) {
    const cat = _catalogs[catalogId] || {};
    let base = (name || 'material').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'material';
    let id = base, n = 2;
    while ((cat.materials || {})[id]) id = base + '_' + n++;
    return id;
}

/**
 * Save (add or replace) a material in a user catalog.
 * mat must have at minimum { id, name, formulaNum }.
 *   formulaNum === -1  → user tabular:  mat.tabData = [[lam_nm, n, k], ...]
 *   formulaNum >= 1    → formula:       mat.coefficients = [...], mat.kTable = [{lam_um, k}, ...]
 */
export function saveUserMaterial(catalogId, mat) {
    ensureInit();
    const cat = _catalogs[catalogId];
    if (!cat || cat.source !== 'user') throw new Error('Not a user catalog: ' + catalogId);
    // Strip cached getNK so it gets rebuilt from stored data
    const { getNK, ...rest } = mat;
    cat.materials[rest.id] = rest;
    persistCatalog(cat);
    return rest;
}

/**
 * Convert any catalog material into a self-contained, serializable form
 * suitable for storing in a USER catalog:
 *   • builtin function materials (formulaNum === 0) are sampled into a tabular
 *     [λ_nm, n, k] table (the getNK function can't be persisted to JSON);
 *   • tabular / formula materials are copied as-is (minus the cached getNK).
 */
function materialToUserCopy(mat) {
    // eslint-disable-next-line no-unused-vars
    const { getNK, ...rest } = mat;
    if (mat.formulaNum === 0 && typeof getNK === 'function') {
        const smin = Math.max(100, Math.round((mat.lambdaMin || 0.2) * 1000));
        const smax = Math.min(25000, Math.round((mat.lambdaMax || 2.5) * 1000));
        const N = 200;
        const tabData = [];
        for (let i = 0; i < N; i++) {
            const lam = Math.round(smin + (i / (N - 1)) * (smax - smin));
            try { const [n, k] = getNK(lam); if (isFinite(n)) tabData.push([lam, +n, +(k || 0)]); }
            catch (_) { /* skip bad points */ }
        }
        return { ...rest, formulaNum: -1, tabData, coefficients: [], kTable: [], group: 'User' };
    }
    return { ...rest, group: rest.group || 'User' };
}

/**
 * Copy a single material (from any catalog) into a target USER catalog under a
 * fresh, unique id. Returns the stored material, or null on failure.
 */
export function copyMaterialToCatalog(srcMaterial, targetCatalogId) {
    ensureInit();
    const cat = _catalogs[targetCatalogId];
    if (!cat || cat.source !== 'user' || !srcMaterial) return null;
    const copy = materialToUserCopy(srcMaterial);
    copy.id = generateMaterialId(targetCatalogId, copy.name || copy.id || 'material');
    cat.materials[copy.id] = copy;
    persistCatalog(cat);
    return copy;
}

/**
 * Duplicate an entire catalog into a NEW user catalog. Works for any source
 * (builtin/agf/user/refractiveindex); builtin function materials are sampled to
 * tabular so the copy is fully self-contained and editable.
 */
export function duplicateCatalog(srcCatalogId, newName) {
    ensureInit();
    const src = _catalogs[srcCatalogId];
    if (!src) return null;
    const cat = createUserCatalog(newName || (src.name + ' copy'));
    for (const m of Object.values(src.materials)) {
        const copy = materialToUserCopy(m);
        // Preserve original ids where possible (unique within the fresh catalog).
        copy.id = (cat.materials[m.id]) ? generateMaterialId(cat.id, m.name || m.id) : m.id;
        cat.materials[copy.id] = copy;
    }
    persistCatalog(cat);
    return cat;
}

/**
 * Merge a set of materials into an existing catalog (any source except builtin),
 * giving each a unique id within the target, then persist. Used by importers
 * (e.g. OptiLayer .lm/.sub) so the user can add to an existing catalog instead of
 * always creating a new one. Returns the number of materials added.
 *
 * @param {string} catalogId
 * @param {Object} materials  id → material entry (getNK stripped if present)
 */
export function importMaterialsIntoCatalog(catalogId, materials) {
    ensureInit();
    const cat = _catalogs[catalogId];
    if (!cat || cat.source === 'builtin') return 0;
    let added = 0;
    for (const m of Object.values(materials || {})) {
        // eslint-disable-next-line no-unused-vars
        const { getNK, ...rest } = m;
        let id = rest.id || 'material', n = 2;
        while (cat.materials[id]) id = (rest.id || 'material') + '_' + n++;
        rest.id = id;
        cat.materials[id] = rest;
        added++;
    }
    if (added) persistCatalog(cat);
    return added;
}

/** Remove a material from a user catalog. */
export function removeUserMaterial(catalogId, materialId) {
    ensureInit();
    const cat = _catalogs[catalogId];
    if (!cat || cat.source !== 'user') return;
    delete cat.materials[materialId];
    persistCatalog(cat);
}

export { catalogColor, ndColor, GROUP_COLORS, resolveColor, materialAutoColor };
