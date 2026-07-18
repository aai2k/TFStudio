import { getRegistry } from './state.js';
import { makeGetNK } from './dispersion.js';
import { getCatalogs } from './lifecycle.js';

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
    const catalogs = getRegistry();
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

    const cat = catalogs[catalogId];
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

/**
 * Search materials across all catalogs.
 * Returns array of { catalogId, catalogName, material } sorted by match quality.
 */
export function searchMaterials(query, catalogFilter) {
    const catalogs = getRegistry();
    const q = (query || '').toLowerCase().trim();
    const results = [];

    const cats = catalogFilter
        ? [catalogs[catalogFilter]].filter(Boolean)
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
