import { getRegistry, peekRegistry } from './state.js';
import { newCatalogUid, persistCatalog, removedRecord } from './persistence.js';
import { randomHex } from './randomHex.js';
import { hasTabulatedComponent, interpolationRuleOf, TABULATED_INTERPOLATION } from '../pchip.js';
import { builtinMaterialRows } from './builtinCatalog.js';

/**
 * True when a catalog other than `exceptId` already has this name. Case and
 * surrounding spaces are ignored: the catalog selector lists catalogs by name,
 * and two that read the same cannot be told apart there.
 */
export function catalogNameTaken(name, exceptId = null) {
    const wanted = (name || '').trim().toLowerCase();
    return Object.values(getRegistry())
        .some(cat => cat.id !== exceptId && (cat.name || '').trim().toLowerCase() === wanted);
}

/** `name` itself, or the first of `name 2`, `name 3`, … that no catalog has. */
export function freeCatalogName(name) {
    let candidate = name, n = 2;
    while (catalogNameTaken(candidate)) candidate = `${name} ${n++}`;
    return candidate;
}

/**
 * Create a new empty user-defined catalog.
 *
 * Designs refer to a material by catalog id and material id, and a design that
 * travels is computed with the material of that id wherever a catalog holds it.
 * The id is therefore the name's slug plus a random part: two people who both
 * name a catalog "My catalog" get different ids, so a design from one is never
 * computed with the other's material of the same name. On one computer the
 * name is kept distinct as well: a name another catalog has gets a number.
 */
export function createUserCatalog(name) {
    const catalogs = getRegistry();
    let base = 'user_' + (name || 'catalog').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base || base === 'user_') base = 'user_catalog';
    let id;
    do id = `${base}_${randomHex(4)}`; while (catalogs[id]);
    const cat = {
        id, uid: newCatalogUid(), name: freeCatalogName(name || 'User Catalog'), source: 'user', materials: {},
    };
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
 * Whether `cat` holds a material under `id`, or held one and deleted it.
 *
 * A design that used a deleted material keeps it as its own copy, stamped with
 * this catalog (see designMaterials.js), and so does every file saved with it.
 * A new material under the same id would take its place in all of them, so a
 * catalog never gives an id out twice: `retiredIds` lists the deleted ones.
 */
export function materialIdTaken(cat, id) {
    return !!cat?.materials?.[id] || (Array.isArray(cat?.retiredIds) && cat.retiredIds.includes(id));
}

/**
 * Generate a unique material ID within a user catalog, derived from name.
 * Safe for use as the key in cat.materials.
 */
export function generateMaterialId(catalogId, name) {
    const cat = peekRegistry()[catalogId] || {};
    let base = (name || 'material').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'material';
    let id = base, n = 2;
    while (materialIdTaken(cat, id)) id = base + '_' + n++;
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
    if (hasTabulatedComponent(rest)) rest.interp = interpolationRuleOf(rest);
    cat.materials[rest.id] = rest;
    persistCatalog(cat);
    return rest;
}

/**
 * Convert any catalog material into a self-contained, serializable form
 * suitable for storing in a USER catalog:
 *   • builtin function materials (formulaNum === 0) become a tabular
 *     [λ_nm, n, k] table (the getNK function can't be persisted to JSON);
 *   • tabular / formula materials are copied as-is (minus the cached getNK).
 */
function materialToUserCopy(mat) {
    // The stamp of the catalog a design's copy came from (see designMaterials.js)
    // says nothing about the catalog the copy goes into.
    // eslint-disable-next-line no-unused-vars
    const { getNK, catalogUid, ...rest } = mat;
    if (mat.formulaNum === 0 && typeof getNK === 'function') {
        return {
            ...rest,
            formulaNum: -1,
            interp: TABULATED_INTERPOLATION,
            tabData: builtinMaterialRows(mat),
            coefficients: [],
            kTable: [],
            group: 'User',
        };
    }
    return {
        ...rest,
        ...(hasTabulatedComponent(rest) ? { interp: interpolationRuleOf(rest) } : {}),
        group: rest.group || 'User',
    };
}

/**
 * `name` itself, or the first of `name (2)`, `name (3)`, … that no material of
 * `cat` has. Case and surrounding spaces are ignored: the picker lists
 * materials by name, and two that read the same cannot be told apart there.
 */
export function freeMaterialName(cat, name) {
    const taken = new Set(Object.values(cat?.materials || {})
        .map(material => String(material?.name ?? '').trim().toLowerCase()));
    let candidate = name, n = 2;
    while (taken.has(String(candidate ?? '').trim().toLowerCase())) candidate = `${name} (${n++})`;
    return candidate;
}

/**
 * Copy a single material (from any catalog) into a target USER catalog under a
 * fresh, unique id, and a name no material there has. Returns the stored
 * material, or null on failure.
 */
export function copyMaterialToCatalog(srcMaterial, targetCatalogId) {
    const catalogs = getRegistry();
    const cat = catalogs[targetCatalogId];
    if (!cat || cat.source !== 'user' || !srcMaterial) return null;
    const copy = materialToUserCopy(srcMaterial);
    copy.id = generateMaterialId(targetCatalogId, copy.name || copy.id || 'material');
    if (copy.name) copy.name = freeMaterialName(cat, copy.name);
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
 * Merge a set of materials into an existing USER catalog, giving each a unique
 * id within the target and a name no material there has, then persist. Used by
 * importers (e.g. OptiLayer .lm/.sub) so the user can add to an existing
 * catalog instead of always creating a new one. Returns the number of materials
 * added.
 *
 * Only a user catalog takes them: the Material Editor edits and deletes
 * materials of user catalogs only, and an AGF catalog is rebuilt from its file.
 *
 * @param {string} catalogId
 * @param {Object} materials  id → material entry (getNK stripped if present)
 */
export function importMaterialsIntoCatalog(catalogId, materials) {
    const catalogs = getRegistry();
    const cat = catalogs[catalogId];
    if (!cat || cat.source !== 'user') return 0;
    let added = 0;
    for (const m of Object.values(materials || {})) {
        // eslint-disable-next-line no-unused-vars
        const { getNK, ...rest } = m;
        if (hasTabulatedComponent(rest)) rest.interp = interpolationRuleOf(rest);
        let id = rest.id || 'material', n = 2;
        while (materialIdTaken(cat, id)) id = (rest.id || 'material') + '_' + n++;
        rest.id = id;
        if (rest.name) rest.name = freeMaterialName(cat, rest.name);
        cat.materials[id] = rest;
        added++;
    }
    if (added) persistCatalog(cat);
    return added;
}

/**
 * Remove a material from a user catalog. The change notice carries it, so an
 * open design using it keeps it as its own copy, and its id is retired (see
 * materialIdTaken).
 */
export function removeUserMaterial(catalogId, materialId) {
    const catalogs = getRegistry();
    const cat = catalogs[catalogId];
    if (!cat || cat.source !== 'user') return;
    const material = cat.materials[materialId];
    delete cat.materials[materialId];
    if (material && !materialIdTaken(cat, materialId)) {
        cat.retiredIds = [...(Array.isArray(cat.retiredIds) ? cat.retiredIds : []), materialId];
    }
    persistCatalog(cat, material ? { [`${catalogId}:${materialId}`]: removedRecord(cat, material) } : null);
}
