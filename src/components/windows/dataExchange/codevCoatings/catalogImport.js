/**
 * Where the materials of an imported CODE V coating go: a user catalog named
 * after the file, made on the first import and merged into on every later one.
 */

import { addCatalog, getCatalogs, materialIdTaken } from '../../../../utils/materials/catalogManager.js';
import { randomHex } from '../../../../utils/materials/catalogManager/randomHex.js';

const baseName = (fileName) => String(fileName || 'coating').replace(/\.[^.]*$/, '');
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'coating';
const nameKey = (material) => String(material?.name ?? '').trim().toUpperCase();

/**
 * The catalog an import from this file goes into.
 *
 * A file imported before (the same path) goes back into its own catalog. A new
 * one gets the file's base name plus a random part as its id, as a new user
 * catalog does: two files of one name, on one computer or on two, would
 * otherwise share an id, and a design made with one would be computed with the
 * other's material of the same name.
 *
 * @param {string} fileName  base name shown to the user, e.g. `AR4.seq`
 * @param {string} [filePath]  full path, used to recognise a re-import
 * @param {Object[]} [catalogs]  the catalogs to look in
 * @returns {{ id: string, name: string, existing: Object|null }}
 */
export function catalogIdFor(fileName, filePath, catalogs = getCatalogs()) {
    const own = filePath && catalogs.find(cat => cat.id.startsWith('codev_') && cat.sourceFile === filePath);
    if (own) return { id: own.id, name: own.name, existing: own };

    const base = baseName(fileName);
    const taken = new Set(catalogs.map(cat => cat.id));
    let id;
    do id = `codev_${slug(base)}_${randomHex(4)}`; while (taken.has(id));
    return { id, name: `CODE V ${base}`, existing: null };
}

// `base`, or the first of `base_2`, `base_3`, … that `taken` says is free.
function freeId(taken, base) {
    let id = base;
    let suffix = 2;
    while (taken(id)) id = `${base}_${suffix++}`;
    return id;
}

// The id under which the catalog held a material of this name before the
// import, or null.
function heldId(existing, material) {
    const held = existing?.materials || {};
    return Object.keys(held).find(id => nameKey(held[id]) === nameKey(material)) || null;
}

/**
 * Put the materials of one import into the file's catalog.
 *
 * A material the catalog already holds under the same name is kept as it is,
 * edits made in the Material Editor included, and the coating is built with
 * it; any other is added under an id the catalog never gave out (see
 * materialIdTaken). Nothing else of the catalog is touched.
 *
 * @param {Array<{ key: string, material: Object }>} materials  as codevStackToDesign returns them
 * @param {string} fileName
 * @param {string} [filePath]
 * @returns {{ catName: string, idOf: Object<string, string> }}  each key's `catalogId:materialId`
 */
export function registerCodevMaterials(materials, fileName, filePath) {
    const { id: catId, name, existing } = catalogIdFor(fileName, filePath);
    const held = { ...(existing?.materials || {}) };
    const idOf = {};
    for (const { key, material } of materials) {
        let id = heldId(existing, material);
        if (!id) {
            id = freeId(candidate => !!held[candidate] || materialIdTaken(existing, candidate), material.id || 'material');
            held[id] = { ...material, id };
        }
        idOf[key] = `${catId}:${id}`;
    }
    const cat = existing
        ? { ...existing, materials: held }
        : { id: catId, name, source: 'user', sourceFile: filePath || null, materials: held };
    return { catName: addCatalog(cat).name, idOf };
}
