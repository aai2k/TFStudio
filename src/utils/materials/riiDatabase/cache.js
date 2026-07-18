/**
 * Session-scoped in-memory cache for the parsed catalog tree and fetched
 * material documents. Shared by loadCatalog and fetchMaterial so a cleared
 * catalog also drops any materials fetched under it.
 */

export const cache = { catalog: null, materials: {} };

export function resetCache() {
    cache.catalog = null;
    cache.materials = {};
}
