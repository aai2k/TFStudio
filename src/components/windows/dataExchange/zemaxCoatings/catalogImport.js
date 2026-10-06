/**
 * Where the materials of an imported COATING.DAT go: the catalog of that file,
 * made on the first import and merged into on every later one.
 */

import { addCatalog, getCatalogs, materialIdTaken } from '../../../../utils/materials/catalogManager.js';
import { randomHex } from '../../../../utils/materials/catalogManager/randomHex.js';
import { dispersionFingerprint } from '../../../../utils/materials/catalogStamps.js';
import { mateToTfMaterial, sanitizeZemaxName } from '../../../../utils/io/zemaxCoatingFile.js';

/**
 * The catalog an import from this coating file goes into.
 *
 * A file imported before (the same path) goes back into its own catalog. A new
 * one gets the file's base name plus a random part as its id, as a new user
 * catalog does: `COATING.DAT` is the standard name of these files, so two
 * vendors' libraries, on one computer or on two, would otherwise share an id,
 * and a design made with one would be computed with the other's material of
 * the same name. A catalog with no recorded origin (imported before paths were
 * tracked) is never taken over: a spare catalog is recoverable, an overwritten
 * one is not.
 *
 * @param {string} fileName  base name shown to the user, e.g. `COATING.DAT`
 * @param {string} [filePath]  full path, used to recognise a re-import
 * @param {Object[]} [catalogs]  the catalogs to look in
 * @returns {{ id: string, name: string, existing: Object|null }}
 */
export function catalogIdFor(fileName, filePath, catalogs = getCatalogs()) {
    const base = (fileName || 'coating').replace(/\.[^.]*$/, '');
    const own = filePath && catalogs.find(cat => cat.id.startsWith('zemax_') && cat.sourceFile === filePath);
    if (own) return { id: own.id, name: own.name, existing: own };

    const baseId = 'zemax_' + sanitizeZemaxName(base).toLowerCase();
    const taken = new Set(catalogs.map(cat => cat.id));
    let id;
    do id = `${baseId}_${randomHex(4)}`; while (taken.has(id));
    return { id, name: 'Zemax ' + base, existing: null };
}

// `base`, or the first of `base_2`, `base_3`, … that `taken` says is free.
function freeId(taken, base) {
    let id = base;
    let suffix = 2;
    while (taken(id)) id = `${base}_${suffix++}`;
    return id;
}

// The file's materials to import, each as the record a new catalog stores, with
// the id it gets there: its sanitised name, numbered when two names sanitise alike.
function incomingMaterials(materials, fileName, onlyNames) {
    const usedIds = {};
    const incoming = [];
    for (const material of materials) {
        if (onlyNames && !onlyNames.has(material.name.toUpperCase())) continue;
        const record = mateToTfMaterial(material, { comment: `Imported from ${fileName}` });
        const id = freeId(candidate => usedIds[candidate], record.id || 'material');
        usedIds[id] = true;
        incoming.push({ zemaxName: material.name.toUpperCase(), record: { ...record, id } });
    }
    return incoming;
}

const nameKey = material => String(material?.name ?? '').trim().toUpperCase();

// The id under which a catalog made from this file holds the file's material
// `zemaxName`: the material still named after it (the one at the file's own id
// first), else the one at the file's id, which an edit in the Material Editor
// may have renamed, unless that one is named after another material of the file.
function heldId(held, zemaxName, fileId, fileNames) {
    const wanted = zemaxName.trim();
    if (held[fileId] && nameKey(held[fileId]) === wanted) return fileId;
    const byName = Object.keys(held).find(id => nameKey(held[id]) === wanted);
    if (byName) return byName;
    return held[fileId] && !fileNames.has(nameKey(held[fileId])) ? fileId : null;
}

// Merge the incoming materials into the catalog this file made before. A
// material the catalog does not hold is added, under an id the catalog never
// gave out (see materialIdTaken); one it holds is kept as it is, so every
// design using it and every edit made to it stay, unless its data differs from
// the file's and `replaceChanged` is set. Nothing else of the catalog is
// touched.
function mergeIntoExisting(existing, incoming, fileNames, replaceChanged) {
    const held = { ...existing.materials };
    const nameMap = {};
    const changed = [];
    const targets = incoming.map(item => ({ ...item, id: heldId(existing.materials, item.zemaxName, item.record.id, fileNames) }));
    for (const { zemaxName, record, id: found } of targets) {
        let id = found;
        if (!id) {
            id = freeId(candidate => held[candidate] || materialIdTaken(existing, candidate), record.id);
            held[id] = { ...record, id };
        } else if (dispersionFingerprint(held[id]) !== dispersionFingerprint(record)) {
            changed.push(existing.materials[id].name || id);
            if (replaceChanged) held[id] = { ...record, id };
        }
        nameMap[zemaxName] = `${existing.id}:${id}`;
    }
    return { cat: { ...existing, materials: held }, nameMap, changed };
}

/**
 * What an import from a coating file writes, without writing it.
 *
 * `changed` names the materials the target catalog holds in a form that differs
 * from the file's (an edit in the Material Editor, or a newer file): a coating
 * import uses the held ones, a materials import replaces them only with
 * `replaceChanged`. `fileRecords` maps each imported Zemax name to the record
 * built from the file, whose index is the one Zemax used for the coating's
 * relative thicknesses.
 */
export function buildMaterialRegistration(materials, fileName, onlyNames, filePath, { replaceChanged = false } = {}) {
    const { id: catId, name: catName, existing } = catalogIdFor(fileName, filePath);
    const incoming = incomingMaterials(materials, fileName, onlyNames);
    const fileRecords = Object.fromEntries(incoming.map(({ zemaxName, record }) => [zemaxName, record]));

    if (existing) {
        const fileNames = new Set(materials.map(material => material.name.trim().toUpperCase()));
        const merged = mergeIntoExisting(existing, incoming, fileNames, replaceChanged);
        return { ...merged, catId, catName, fileRecords, count: incoming.length };
    }

    const cat = { id: catId, name: catName, source: 'user', sourceFile: filePath || null, materials: {} };
    const nameMap = {};
    for (const { zemaxName, record } of incoming) {
        cat.materials[record.id] = record;
        nameMap[zemaxName] = `${catId}:${record.id}`;
    }
    return { cat, catId, catName, nameMap, fileRecords, changed: [], count: incoming.length };
}

/** Write what buildMaterialRegistration describes; the catalog keeps its id and stamp. */
export function registerMaterials(materials, fileName, onlyNames, filePath, options) {
    const registration = buildMaterialRegistration(materials, fileName, onlyNames, filePath, options);
    const registered = addCatalog(registration.cat);
    return { ...registration, catName: registered.name };
}
