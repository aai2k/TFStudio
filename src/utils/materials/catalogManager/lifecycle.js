import { buildBuiltinCatalog } from './builtinCatalog.js';
import { getRegistry, replaceRegistry } from './state.js';
import {
    normalizeCatalogMaterials, persistCatalog, deleteCatalogFile, newCatalogUid, notifyCatalogsChanged, removedRecord,
} from './persistence.js';
import { freeCatalogName } from './userCatalogs.js';

/**
 * Initialize the registry with catalogs already loaded from disk.
 * Must be called once at app start, after window.electronAPI.loadCatalogs() resolves.
 *
 * @param {Object} persistedCatalogs  id → raw catalog object from disk (may be empty)
 */
export function initCatalogs(persistedCatalogs = {}) {
    const catalogs = { builtin: buildBuiltinCatalog() };
    for (const cat of Object.values(persistedCatalogs)) {
        if (cat.id && cat.id !== 'builtin') {
            // The registry is keyed by id only (materials are referenced as
            // `<catalogId>:<matId>`), so two catalogs that share an id across
            // sources collide — last-loaded silently wins. Warn rather than
            // hiding it; ids are expected to be unique across sources.
            const prev = catalogs[cat.id];
            if (prev && prev.source !== cat.source) {
                console.warn(`Catalog id "${cat.id}" collides across sources on load (${prev.source} vs ${cat.source}) — last wins.`);
            }
            catalogs[cat.id] = normalizeCatalogMaterials(cat);
        }
    }
    replaceRegistry(catalogs);
}

/** All catalogs as an ordered array (builtin first, then alphabetically). */
export function getCatalogs() {
    const catalogs = getRegistry();
    return [
        catalogs['builtin'],
        ...Object.values(catalogs)
            .filter(c => c.id !== 'builtin')
            .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
    ].filter(Boolean);
}

/** Get a catalog by id. */
export function getCatalog(id) {
    const catalogs = getRegistry();
    return catalogs[id] ?? null;
}

// Catalogs whose contents can differ between two computers that give them the
// same id: the user's own, and those made from files the user put in. The
// bundled library catalogs are the same everywhere and read-only, so they need
// no stamp (see newCatalogUid).
const STAMPED_SOURCES = new Set(['user', 'refractiveindex', 'agf']);

/**
 * Give every catalog that should carry a stamp and has none a new one, and save
 * it. Run once the catalogs are loaded: a stamp has to be on disk before any
 * design records it, or the next start would not match it.
 */
export function stampCatalogs() {
    for (const cat of Object.values(getRegistry())) {
        if (!cat.uid && STAMPED_SOURCES.has(cat.source)) {
            cat.uid = newCatalogUid();
            persistCatalog(cat);
        }
    }
}

/**
 * Register an imported catalog (AGF, Zemax COATING.DAT, a tutorial's).
 * Overwrites any existing catalog with the same id, keeping its stamp: it is
 * the same catalog, refreshed. A new catalog whose name another catalog has
 * gets a number, as a new user catalog does: the selector lists catalogs by
 * name, and two that read the same cannot be told apart there.
 */
export function addCatalog(catalogData) {
    const catalogs = getRegistry();
    if (catalogData.id === 'builtin') throw new Error('Cannot override builtin catalog');
    const cat = normalizeCatalogMaterials({ ...catalogData, source: catalogData.source || 'agf' });
    const existing = catalogs[cat.id];
    if (!existing) cat.name = freeCatalogName(cat.name);
    if (existing && existing.source && existing.source !== cat.source) {
        console.warn(`Catalog id "${cat.id}" collides across sources (existing ${existing.source} → new ${cat.source}); replacing. Ids should be unique across sources.`);
    }
    const uid = cat.uid || existing?.uid || (STAMPED_SOURCES.has(cat.source) ? newCatalogUid() : null);
    if (uid) cat.uid = uid;
    catalogs[cat.id] = cat;
    persistCatalog(cat);
    return cat;
}

/**
 * Remove a catalog. Builtin cannot be removed. The change notice carries every
 * material it held, so an open design using one keeps it as its own copy.
 */
export function removeCatalog(catalogId) {
    if (catalogId === 'builtin') return;
    const catalogs = getRegistry();
    const cat = catalogs[catalogId];
    delete catalogs[catalogId];
    deleteCatalogFile(catalogId, cat?.source, cat?.name);
    const removed = {};
    for (const [key, material] of Object.entries(cat?.materials || {})) {
        if (material) removed[`${catalogId}:${key}`] = removedRecord(cat, material);
    }
    notifyCatalogsChanged(removed);
}
