import { buildBuiltinCatalog } from './builtinCatalog.js';
import { getRegistry, replaceRegistry } from './state.js';
import { normalizeCatalogMaterials, persistCatalog, deleteCatalogFile } from './persistence.js';

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
            .sort((a, b) => a.name.localeCompare(b.name))
    ].filter(Boolean);
}

/** Get a catalog by id. */
export function getCatalog(id) {
    const catalogs = getRegistry();
    return catalogs[id] ?? null;
}

/**
 * Register an imported AGF catalog (from parseAGF).
 * Overwrites any existing catalog with the same id.
 */
export function addCatalog(catalogData) {
    const catalogs = getRegistry();
    if (catalogData.id === 'builtin') throw new Error('Cannot override builtin catalog');
    const cat = normalizeCatalogMaterials({ ...catalogData, source: catalogData.source || 'agf' });
    const existing = catalogs[cat.id];
    if (existing && existing.source && existing.source !== cat.source) {
        console.warn(`Catalog id "${cat.id}" collides across sources (existing ${existing.source} → new ${cat.source}); replacing. Ids should be unique across sources.`);
    }
    catalogs[cat.id] = cat;
    persistCatalog(cat);
    return cat;
}

/** Remove an imported catalog. Builtin cannot be removed. */
export function removeCatalog(catalogId) {
    if (catalogId === 'builtin') return;
    const catalogs = getRegistry();
    const cat = catalogs[catalogId];
    delete catalogs[catalogId];
    deleteCatalogFile(catalogId, cat?.source);
}
