// Materials as the API sees them: searching the catalogs, n and k at chosen
// wavelengths, and the check that every name a design or a call uses resolves.

import { getCatalogs } from '../utils/materials/catalogManager.js';
import { materialRangeNm } from '../utils/materials/materialRange.js';
import { resolveDesignMaterial, unresolvedMaterials, designMaterialName } from '../utils/materials/designMaterials.js';

// Every material of every catalog, as { id, name, catalog }. A built-in
// material's id is its key; another catalog's is `catalog:key`, the id a
// design names it by.
function allMaterials() {
    const out = [];
    for (const catalog of getCatalogs()) {
        for (const [key, material] of Object.entries(catalog.materials || {})) {
            const id = catalog.id === 'builtin' ? key : `${catalog.id}:${key}`;
            out.push({ id, name: material?.name || key, catalog: catalog.id });
        }
    }
    return out;
}

/** The catalog materials whose id or name holds `query`, any case. */
export function findMaterials(query = '') {
    const q = String(query).toLowerCase();
    return allMaterials().filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
}

// Up to five catalog ids near `id`, for a refusal to name.
function closeMatches(id) {
    const q = String(id).toLowerCase();
    const scored = allMaterials().map(m => {
        const key = m.id.toLowerCase();
        const shared = [...q].filter((ch, i) => key[i] === ch).length;
        return { id: m.id, score: (key.includes(q) || q.includes(key) ? 100 : 0) + shared };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, 5).map(m => m.id);
}

/**
 * The material `id` names in `design` (a design's own copy first, then the
 * catalogs), or an error naming the closest catalog ids: a name that resolves
 * to nothing is never read as n = 1.
 */
export function requireMaterial(design, id) {
    const { material, status } = resolveDesignMaterial(design || {}, id);
    if (status === 'missing' || status === 'unset') {
        throw new Error(`Unknown material '${id}'. Close matches: ${closeMatches(id).join(', ') || 'none'}`);
    }
    return material;
}

/** Throws when a material `design` names resolves to nothing, listing them. */
export function requireResolved(design) {
    const missing = unresolvedMaterials(design);
    if (missing.length) throw new Error(`The design names materials that resolve to nothing: ${missing.join(', ')}`);
}

/**
 * n and k of `id` at each wavelength in nm: { id, rangeNm, nk: [{ wavelength,
 * n, k, outside }] }. rangeNm is the range the material's data cover, null
 * when it declares none; a wavelength outside it is marked `outside`, its n
 * and k held at the edge value or extrapolated, as the Material Dispersion
 * window shows them.
 */
export function materialNK(id, wavelengths, design = null) {
    if (!Array.isArray(wavelengths) || !wavelengths.length || !wavelengths.every(w => Number.isFinite(w) && w > 0)) {
        throw new Error('materialNK: wavelengths is a list of wavelengths in nm above 0');
    }
    const material = requireMaterial(design, id);
    const rangeNm = materialRangeNm(material);
    return {
        id, rangeNm,
        nk: wavelengths.map(wavelength => {
            const [n, k] = material.getNK(wavelength);
            const outside = !!rangeNm && (wavelength < rangeNm[0] || wavelength > rangeNm[1]);
            return { wavelength, n, k, ...(outside ? { outside } : {}) };
        }),
    };
}

/** The display name of `id` in `design`. */
export const materialName = (design, id) => designMaterialName(design, id);
