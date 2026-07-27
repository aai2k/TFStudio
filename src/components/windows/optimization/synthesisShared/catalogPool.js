import { getCatalogs, getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { DESIGN_CATALOG_ID, buildDesignCatalog } from '../../../../utils/materials/designCatalog.js';
import { matDisplayName } from './materialNames.js';

// Above this many candidate materials the pool panel warns that scans may be slow.
export const POOL_WARN_COUNT = 200;
// Hard ceiling for single-threaded scans (Needle Manual): past this the profile
// scan runs long enough on the UI thread to freeze/crash the renderer, so it is
// refused rather than attempted.
export const POOL_MAX_SYNC = 400;

// Full material id for a catalog key. Builtin keys are unprefixed; design-catalog
// keys are already the id the design references, so a layer built from one of
// them carries an id that resolves outside the pool.
const fullMatId = (cat, matKey) =>
    (cat.id === 'builtin' || cat.id === DESIGN_CATALOG_ID) ? matKey : `${cat.id}:${matKey}`;

// Air and vacuum cannot act as a film. Matched on the material rather than the
// full id, since the same material arrives bare from the builtin catalog and
// prefixed from the design catalog.
const isAirLike = (matKey) => {
    const tail = matKey.slice(matKey.indexOf(':') + 1);
    return tail === 'Air' || tail === 'Vacuum';
};

// Built-in materials are referenced both bare ('SiO2', from the builtin catalog)
// and compound ('builtin:SiO2', how a design usually stores them). Both resolve
// to the same material, so identity for pool purposes is the compound form —
// otherwise one film is offered, scanned and counted twice.
const canonicalId = (fullId) => fullId.includes(':') ? fullId : `builtin:${fullId}`;

/**
 * Catalogs the pool draws from, with the active design's own materials first so
 * "use what this design already uses" is the first thing offered.
 *
 * @param {Object} design      active design, or null for the registry alone
 * @param {string} designName  display label (t.pool.designCatalog); only the
 *                             panel shows it, so the pool builders omit it
 */
export function poolCatalogs(design, designName = '') {
    const designCatalog = design ? buildDesignCatalog(design, designName) : null;
    return designCatalog ? [designCatalog, ...getCatalogs()] : getCatalogs();
}

/** Materials of a catalog eligible for the pool, as { key, fullId, name } rows. */
export function poolMatEntries(cat) {
    return Object.entries(cat.materials || {})
        .filter(([key]) => !isAirLike(key))
        .map(([key, mat]) => ({
            key,
            fullId: fullMatId(cat, key),
            name: (mat && mat.name) || key,
        }));
}

// Count of eligible candidate materials in the selected catalogs (Air/Vacuum and
// user-excluded ids removed). Deliberately skips the getNK(n<1.05) filter that
// getPoolMaterials applies — an upper-bound estimate is all the size guards need,
// and it stays cheap enough to run on every selection change.
export function countPoolMaterials(selectedCatalogIds, excluded = null, design = null) {
    const seen = new Set();
    for (const cat of poolCatalogs(design)) {
        if (!selectedCatalogIds.has(cat.id)) continue;
        for (const { fullId } of poolMatEntries(cat)) {
            if (excluded && excluded.has(fullId)) continue;
            seen.add(canonicalId(fullId));
        }
    }
    return seen.size;
}

// A material can act as a film only if n ≥ 1.05 at 550 nm (and getNK resolves).
function isFilmMaterial(mat, fullId, verbose) {
    try {
        const nk = mat.getNK(550);
        const n  = Array.isArray(nk) ? nk[0] : (nk?.n ?? 1);
        if (typeof n === 'number' && n < 1.05) {
            if (verbose) console.warn(`[NeedlePool] Skipping ${fullId}: n=${n} < 1.05 at 550 nm`);
            return false;
        }
    } catch (err) {
        if (verbose) console.warn(`[NeedlePool] Skipping ${fullId}: getNK threw`, err);
        return false;
    }
    return true;
}

// Resolve one catalog material to a pool entry, or null if it can't act as a
// film: user-excluded, unknown id, or n < 1.05 at 550 nm. The design catalog
// already holds resolved material objects, including embedded definitions that
// no local catalog can serve.
function poolMaterialEntry(cat, matKey, fullId, excluded, verbose) {
    if (excluded && excluded.has(fullId)) return null;   // user deselected this material in the pool panel
    const mat = cat.id === DESIGN_CATALOG_ID ? cat.materials[matKey] : getMaterialById(fullId);
    if (!mat || !isFilmMaterial(mat, fullId, verbose)) return null;
    return { id: fullId, mat, name: matDisplayName(fullId) };
}

// ── Candidate material pool from the selected catalogs ───────────────────────────
// Skips Air/Vacuum and anything with n < 1.05 at 550 nm (can't act as a film).
// A material reachable through both the design catalog and its own catalog is
// one candidate, not two, so a scan never evaluates the same film twice.
// `verbose` mirrors NeedleVariation's original pool diagnostics; GE passes false.
export function getPoolMaterials(selectedCatalogIds,
                                 { verbose = false, excluded = null, design = null } = {}) {
    const result = [];
    const seen = new Set();
    const allCats = poolCatalogs(design);
    if (verbose) {
        console.log(`[NeedlePool] selected IDs: [${[...selectedCatalogIds].join(', ')}]`,
            '  available:', allCats.map(c => `${c.id}(${Object.keys(c.materials || {}).length})`).join(', '));
    }
    for (const cat of allCats) {
        if (!selectedCatalogIds.has(cat.id)) continue;
        for (const { key, fullId } of poolMatEntries(cat)) {
            const canonical = canonicalId(fullId);
            if (seen.has(canonical)) continue;
            const entry = poolMaterialEntry(cat, key, fullId, excluded, verbose);
            if (entry) { seen.add(canonical); result.push(entry); }
        }
    }
    return result;
}
