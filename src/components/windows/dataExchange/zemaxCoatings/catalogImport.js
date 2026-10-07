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

// `name (n)`, or the first number up from `n` that names no record of the
// file; the name it returns is taken from then on.
function freeName(taken, name, n) {
    let candidate;
    do candidate = `${name} (${n++})`; while (taken.has(candidate.toUpperCase()));
    taken.add(candidate.toUpperCase());
    return candidate;
}

/**
 * How the import tells the file's MATE records apart, in file order.
 *
 * Zemax names are case-insensitive, and a file can define one name more than
 * once. Each record is imported on its own: the first of a name keeps it, and
 * every later one gets ` (2)`, ` (3)`, … after it, as a material copied into a
 * catalog that already holds its name does (freeMaterialName). `repeat` says
 * which record of a repeated name a row is, 1-based, and how many the file has.
 *
 * @param {Array<{name: string}>} materials  the file's MATE records
 * @returns {Array<{ name: string, repeat: { index: number, count: number } | null }>}
 */
export function fileMaterialNames(materials) {
    const names = materials.map(material => String(material.name ?? '').trim());
    const keys = names.map(name => name.toUpperCase());
    const count = {};
    for (const key of keys) count[key] = (count[key] || 0) + 1;
    const taken = new Set(keys);
    const seen = {};
    return names.map((name, row) => {
        const key = keys[row];
        seen[key] = (seen[key] || 0) + 1;
        if (count[key] === 1) return { name, repeat: null };
        const repeat = { index: seen[key], count: count[key] };
        return { name: repeat.index === 1 ? name : freeName(taken, name, repeat.index), repeat };
    });
}

/** The rows of the file whose MATE name, in any case, is in `upperNames`. */
export function rowsNamed(materials, upperNames) {
    return new Set(materials.flatMap((material, row) => (upperNames.has(material.name.toUpperCase()) ? [row] : [])));
}

// The file's materials to import, each as the record a new catalog stores, with
// the id it gets there: its sanitised name, numbered when two names sanitise
// alike. `rows` picks records by their position in the file; null takes all.
// `zemaxName` is the name a COAT layer looks the record up by.
function incomingMaterials(materials, fileName, rows) {
    const names = fileMaterialNames(materials);
    const usedIds = {};
    const incoming = [];
    materials.forEach((material, row) => {
        if (rows && !rows.has(row)) return;
        const record = { ...mateToTfMaterial(material, { comment: `Imported from ${fileName}` }), name: names[row].name };
        const id = freeId(candidate => usedIds[candidate], record.id || 'material');
        usedIds[id] = true;
        incoming.push({ zemaxName: material.name.toUpperCase(), record: { ...record, id } });
    });
    return incoming;
}

const nameKey = material => String(material?.name ?? '').trim().toUpperCase();

// The id under which a catalog made from this file holds the record named
// `wanted` (upper-case): the material still named so (the one at the file's
// own id first), else the one at the file's id, which an edit in the Material
// Editor may have renamed, unless that one is named after another record of
// the file.
function heldId(held, wanted, fileId, fileNames) {
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
    const targets = incoming.map(item => ({ ...item, id: heldId(existing.materials, nameKey(item.record), item.record.id, fileNames) }));
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
 * `rows` is the set of the file's MATE records to import, by their position in
 * `materials`, or null for all of them. `changed` names the materials the
 * target catalog holds in a form that differs from the file's (an edit in the
 * Material Editor, or a newer file): a coating import uses the held ones, a
 * materials import replaces them only with `replaceChanged`. `nameMap` maps
 * each imported Zemax name, upper-case, to its `catalogId:materialId`, and
 * `fileRecords` to the record built from the file, whose index is the one
 * Zemax used for the coating's relative thicknesses. For a name the file
 * defines more than once, both hold the last of its records in `rows`.
 */
export function buildMaterialRegistration(materials, fileName, rows, filePath, { replaceChanged = false } = {}) {
    const { id: catId, name: catName, existing } = catalogIdFor(fileName, filePath);
    const incoming = incomingMaterials(materials, fileName, rows);
    const fileRecords = Object.fromEntries(incoming.map(({ zemaxName, record }) => [zemaxName, record]));

    if (existing) {
        const fileNames = new Set(fileMaterialNames(materials).map(({ name }) => name.toUpperCase()));
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
export function registerMaterials(materials, fileName, rows, filePath, options) {
    const registration = buildMaterialRegistration(materials, fileName, rows, filePath, options);
    const registered = addCatalog(registration.cat);
    return { ...registration, catName: registered.name };
}
