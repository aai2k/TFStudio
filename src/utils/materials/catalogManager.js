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
 *
 * Implementation lives in ./catalogManager/ (builtin-catalog wrapping, the
 * dispersion/getNK builder, color derivation, the registry state, disk
 * persistence, catalog lifecycle, material lookup/search, and user-catalog
 * editing); this file re-exports the public API from a single stable path.
 */

export { initCatalogs, getCatalogs, getCatalog, addCatalog, removeCatalog } from './catalogManager/lifecycle.js';
export { getMaterialById, getNKById, searchMaterials, normalizeId, materialLabel } from './catalogManager/materialLookup.js';
export {
    createUserCatalog,
    renameUserCatalog,
    generateMaterialId,
    saveUserMaterial,
    copyMaterialToCatalog,
    duplicateCatalog,
    importMaterialsIntoCatalog,
    removeUserMaterial,
} from './catalogManager/userCatalogs.js';
export { catalogColor, ndColor, GROUP_COLORS, resolveColor, materialAutoColor } from './catalogManager/colors.js';
