import { getRegistry, peekRegistry } from './state.js';
import { persistCatalog } from './persistence.js';

/** Create a new empty user-defined catalog with a unique generated ID. */
export function createUserCatalog(name) {
    const catalogs = getRegistry();
    let base = 'user_' + (name || 'catalog').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base || base === 'user_') base = 'user_catalog';
    let id = base, n = 2;
    while (catalogs[id]) id = base + '_' + n++;
    const cat = { id, name: name || 'User Catalog', source: 'user', materials: {} };
    catalogs[id] = cat;
    persistCatalog(cat);
    return cat;
}

/** Rename a user catalog. */
export function renameUserCatalog(catalogId, newName) {
    const catalogs = getRegistry();
    const cat = catalogs[catalogId];
    if (!cat || cat.source !== 'user') return;
    cat.name = newName;
    persistCatalog(cat);
}

/**
 * Generate a unique material ID within a user catalog, derived from name.
 * Safe for use as the key in cat.materials.
 */
export function generateMaterialId(catalogId, name) {
    const cat = peekRegistry()[catalogId] || {};
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
    const catalogs = getRegistry();
    const cat = catalogs[catalogId];
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
    const catalogs = getRegistry();
    const cat = catalogs[targetCatalogId];
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
    const catalogs = getRegistry();
    const src = catalogs[srcCatalogId];
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
    const catalogs = getRegistry();
    const cat = catalogs[catalogId];
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
    const catalogs = getRegistry();
    const cat = catalogs[catalogId];
    if (!cat || cat.source !== 'user') return;
    delete cat.materials[materialId];
    persistCatalog(cat);
}
