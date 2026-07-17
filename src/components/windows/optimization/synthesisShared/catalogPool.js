import { getCatalogs, getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { matDisplayName } from './materialNames.js';

// Above this many candidate materials the pool panel warns that scans may be slow.
export const POOL_WARN_COUNT = 200;
// Hard ceiling for single-threaded scans (Needle Manual): past this the profile
// scan runs long enough on the UI thread to freeze/crash the renderer, so it is
// refused rather than attempted.
export const POOL_MAX_SYNC = 400;

// Full material id for a catalog key (builtin catalog keys are unprefixed).
const fullMatId = (cat, matKey) => (cat.id === 'builtin' ? matKey : `${cat.id}:${matKey}`);

// Count of eligible candidate materials in the selected catalogs (Air/Vacuum and
// user-excluded ids removed). Deliberately skips the getNK(n<1.05) filter that
// getPoolMaterials applies — an upper-bound estimate is all the size guards need,
// and it stays cheap enough to run on every selection change.
function countCatMaterials(cat, excluded) {
    let n = 0;
    for (const key of Object.keys(cat.materials || {})) {
        if (key === 'Air' || key === 'Vacuum') continue;
        if (excluded && excluded.has(fullMatId(cat, key))) continue;
        n++;
    }
    return n;
}

export function countPoolMaterials(selectedCatalogIds, excluded = null) {
    let n = 0;
    for (const cat of getCatalogs()) {
        if (selectedCatalogIds.has(cat.id)) n += countCatMaterials(cat, excluded);
    }
    return n;
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
// film: Air/Vacuum, user-excluded, unknown id, or n < 1.05 at 550 nm.
function poolMaterialEntry(cat, matKey, excluded, verbose) {
    if (matKey === 'Air' || matKey === 'Vacuum') return null;
    const fullId = fullMatId(cat, matKey);
    if (excluded && excluded.has(fullId)) return null;   // user deselected this material in the pool panel
    const mat = getMaterialById(fullId);
    if (!mat || !isFilmMaterial(mat, fullId, verbose)) return null;
    return { id: fullId, mat, name: matDisplayName(fullId) };
}

// ── Candidate material pool from the selected catalogs ───────────────────────────
// Skips Air/Vacuum and anything with n < 1.05 at 550 nm (can't act as a film).
// `verbose` mirrors NeedleVariation's original pool diagnostics; GE passes false.
export function getPoolMaterials(selectedCatalogIds, { verbose = false, excluded = null } = {}) {
    const result = [];
    const allCats = getCatalogs();
    if (verbose) {
        console.log(`[NeedlePool] selected IDs: [${[...selectedCatalogIds].join(', ')}]`,
            '  available:', allCats.map(c => `${c.id}(${Object.keys(c.materials || {}).length})`).join(', '));
    }
    for (const cat of allCats) {
        if (!selectedCatalogIds.has(cat.id)) continue;
        for (const [matKey] of Object.entries(cat.materials || {})) {
            const entry = poolMaterialEntry(cat, matKey, excluded, verbose);
            if (entry) result.push(entry);
        }
    }
    return result;
}
