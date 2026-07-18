/**
 * riiDatabase.js — RefractiveIndex.info database browser (JavaScript side).
 *
 * Fetches from github.com/polyanskiy/refractiveindex.info-database via HTTPS
 * (main process does the actual request via rii:fetch-yaml IPC).
 *
 * Public API:
 *   loadCatalog()                    → Promise<parsed catalog tree>
 *   fetchMaterial(dataPath)          → Promise<RiiMaterial>
 *   riiMaterialToCatalogEntry(m)     → catalog-manager compatible material entry
 *   searchCatalog(catalog, query)    → [{shelf,book,page,name,dataPath}, ...]
 *
 * Implementation is split across src/utils/materials/riiDatabase/: fetch.js
 * (network/offline-mirror access), cache.js (session catalog/material cache),
 * catalog.js (catalog tree + status/update), materialParser.js (material YAML
 * decoding), formulas.js (dispersion formula evaluation), sampling.js (n,k
 * grid sampling), search.js (catalog search), catalogEntry.js (catalogManager
 * conversion).
 */

export { loadCatalog, clearCatalogCache, getDatabaseStatus, updateDatabase } from './riiDatabase/catalog.js';
export { fetchMaterial } from './riiDatabase/materialParser.js';
export { evalFormulaN } from './riiDatabase/formulas.js';
export { sampleMaterial } from './riiDatabase/sampling.js';
export { searchCatalog } from './riiDatabase/search.js';
export { riiToMaterialEntry } from './riiDatabase/catalogEntry.js';
