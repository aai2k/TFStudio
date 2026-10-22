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

/**
 * The materials whose id or name holds the text given, in upper or lower case: the
 * built-in ones and those of the catalogs in the data folder.
 *
 * @param [query=''] The text to look for; empty finds every material.
 * @returns The materials found, a list, each with these fields.
 * @property id The id designs and calls name the material by: a built-in material's own name, or `catalog:key` for one of another catalog, where `key` is the key the catalog files the material under, not always its name; use the id this call returns.
 * @property name The name the app shows.
 * @property catalog The catalog it is in, `'builtin'` for a built-in material.
 * @example
 * for (const m of tf.findMaterials('TiO2')) console.log(m.id, m.name, m.catalog);
 */
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
 * The material `id` names in `design` (the catalogs first, then the design's
 * own copy, as resolveDesignMaterial decides), or an error naming the closest
 * catalog ids: a name that resolves to nothing is never read as n = 1.
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
 * n and k of a material at the wavelengths given, as the
 * [Material Dispersion](/analysis/material-dispersion/) window shows them.
 *
 * @param id The material, by id.
 * @param wavelengths The wavelengths, nm, a list.
 * @param [design=null] A design, so that its own copies of materials count as they do when it computes: the catalogs come first, and the design's copy is used where no catalog holds the material, or where the copy came from another catalog and has other n and k.
 * @returns The material's n and k.
 * @property id The material's id.
 * @property rangeNm The range its data cover, `[first, last]` in nm, or null when it states none.
 * @property nk One per wavelength, `{ wavelength, n, k }`, with `outside: true` where the wavelength is outside `rangeNm` and n and k are held at the edge value or extrapolated.
 * @throws a material id that resolves to nothing, naming the closest ids
 * @example
 * const { rangeNm, nk } = tf.materialNK('TiO2', [400, 550, 700]);
 * console.log('Data from', rangeNm);
 * for (const p of nk) console.log(p.wavelength, 'nm: n', p.n.toFixed(4), 'k', p.k);
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
