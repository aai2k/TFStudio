// Drop the getNK closure that getMaterialById attaches lazily, leaving the
// plain dispersion record. Anything written to disk goes through here.
import { hasTabulatedComponent, interpolationRuleOf } from '../pchip.js';
import { randomHex } from './randomHex.js';
import { getRegistry } from './state.js';

export function stripGetNK(material) {
    // eslint-disable-next-line no-unused-vars
    const { getNK, ...rest } = material;
    return rest;
}

function serializeCatalog(cat) {
    const mats = {};
    for (const [id, m] of Object.entries(cat.materials)) mats[id] = stripGetNK(m);
    return { ...cat, materials: mats };
}

/**
 * Fired on `window` after any edit to a catalog: a material saved, deleted,
 * copied or imported, a catalog renamed or duplicated.
 *
 * A window that read a material before the edit is now showing a stale number,
 * and it has no other way to know. `useCatalogRevision` turns this into a
 * dependency a memo can take.
 */
export const CATALOGS_CHANGED = 'catalogs-changed';

/**
 * Send CATALOGS_CHANGED. `removed` maps the compound id of every material an
 * edit took away (`catalog:material`) to the record it had, so an open design
 * that uses one can keep it as its own copy.
 */
export function notifyCatalogsChanged(removed = null) {
    try {
        window.dispatchEvent(new CustomEvent(CATALOGS_CHANGED, { detail: removed ? { removed } : {} }));
    } catch (_) { /* no window */ }
}

/**
 * A new catalog stamp: random, so no two catalogs anywhere share one. A design
 * records the stamp of the catalog each material came from, which is how it
 * tells "the catalog I was made with" from another computer's catalog that
 * happens to have the same id (see designMaterials.js).
 */
export function newCatalogUid() {
    return randomHex(8);
}

/** A material taken out of `cat`, in the form a design keeps as its own copy. */
export function removedRecord(cat, material) {
    return { ...stripGetNK(material), ...(cat?.uid ? { catalogUid: cat.uid } : {}) };
}

/**
 * Fired on `window` when a catalog file could not be written or deleted, with
 * `{ id, name, action: 'save' | 'delete', error }`. The registry already holds
 * the edit, so the program goes on as if it were saved; without this nobody
 * would learn that a restart loses it. The next edit of the catalog writes the
 * whole catalog again.
 */
export const CATALOG_SAVE_FAILED = 'catalog-save-failed';

function reportWriteFailure(id, name, action, error) {
    try {
        window.dispatchEvent(new CustomEvent(CATALOG_SAVE_FAILED, {
            detail: { id, name: name || id, action, error: String(error ?? '') },
        }));
    } catch (_) { /* no window */ }
}

// Watch one IPC write: a result of success:false, or a call that fails, is
// reported as CATALOG_SAVE_FAILED. Resolves to the IPC result either way. A
// delete the Recycle Bin refused ('no-bin') is not reported: the file is still
// there, and the caller asks whether to delete it for good.
function watchWrite(call, id, name, action) {
    return Promise.resolve(call).then(
        (result) => {
            if (result && result.success === false && result.error !== 'no-bin') reportWriteFailure(id, name, action, result.error);
            return result;
        },
        (err) => {
            reportWriteFailure(id, name, action, err?.message ?? err);
            return { success: false, error: err?.message ?? String(err) };
        });
}

/**
 * Fired on `window` when a catalog save finds that another copy of TFStudio
 * changed a material this edit changes too, with `{ name, answer }`: the
 * material's name, and the function to call with true to replace the other
 * copy's version with this one, or false to keep it.
 */
export const CATALOG_EDIT_CLASH = 'catalog-edit-clash';

// The modification time each catalog's file had when this copy last read or
// wrote it, by catalog id. Two copies of TFStudio can run on one data folder,
// and each saves a catalog whole from its own registry; the time tells a file
// the other copy wrote since (see persistCatalog).
const fileTimes = new Map();

/** Start over from the file times a load of every catalog answered with. */
export function setCatalogFileTimes(times = {}) {
    fileTimes.clear();
    for (const [id, mtime] of Object.entries(times)) fileTimes.set(id, mtime);
}

// Persist one catalog to Documents\TFStudio\Materials\ via IPC. Every catalog
// edit ends here, which is why the change notice goes here too; `removed` is
// passed on to it (see notifyCatalogsChanged). Callers need not wait for the
// returned promise: a failure is reported through CATALOG_SAVE_FAILED.
//
// `edit` names the one edit this save carries: `materials` maps each material
// it added, changed or deleted to the record it had before (undefined for a new
// one), and `name` is true for a rename. Such a save is refused when another
// copy wrote the file since this one read it, and the edit is applied to the
// catalog on disk instead (see saveMerged). A save without `edit`, such as of
// a new catalog, writes the whole catalog unchecked.
export function persistCatalog(cat, removed = null, edit = null) {
    if (!cat || cat.source === 'builtin') return Promise.resolve(null);
    const api = window.electronAPI;
    const pending = api?.saveCatalog
        ? watchWrite(saveCatalogFile(api, cat, edit), cat.id, cat.name, 'save')
        : Promise.resolve(null);
    notifyCatalogsChanged(removed);
    return pending;
}

async function saveCatalogFile(api, cat, edit) {
    const result = await api.saveCatalog(serializeCatalog(cat), edit ? fileTimes.get(cat.id) : undefined);
    if (result?.error === 'changed-on-disk') return saveMerged(api, cat, edit, result);
    if (result?.success) fileTimes.set(cat.id, result.mtime);
    return result;
}

const recordText = (material) => JSON.stringify(material ? stripGetNK(material) : null);
const idList = (ids) => (Array.isArray(ids) ? ids : []);

// This copy's edit of `cat`, made in `onDisk`: each material it touched as
// this copy has it, or gone when this copy deleted it, the name after a
// rename, and the ids either copy retired.
function applyEdit(onDisk, cat, edit) {
    for (const id of Object.keys(edit.materials || {})) {
        if (cat.materials[id]) onDisk.materials[id] = cat.materials[id];
        else delete onDisk.materials[id];
    }
    if (edit.name) onDisk.name = cat.name;
    const retired = [...new Set([...idList(onDisk.retiredIds), ...idList(cat.retiredIds)])];
    if (retired.length) onDisk.retiredIds = retired;
}

// Apply this copy's edit of `cat` to `catalog`, the one another copy wrote,
// and save that. When the other copy changed a material this edit changes
// too, the user is asked first, and Cancel leaves the file as the other copy
// wrote it. Either way the registry then holds what is on disk.
async function saveMerged(api, cat, edit, { catalog, mtime }) {
    const onDisk = normalizeCatalogMaterials(catalog);
    const clash = Object.keys(edit.materials || {})
        .find(id => recordText(onDisk.materials[id]) !== recordText(edit.materials[id]));
    if (clash && !(await askReplace(cat.materials[clash]?.name || onDisk.materials[clash]?.name || clash))) {
        adoptFromDisk(cat.id, onDisk, mtime);
        return { canceled: true };
    }
    applyEdit(onDisk, cat, edit);
    const result = await api.saveCatalog(serializeCatalog(onDisk), mtime);
    if (result?.error === 'changed-on-disk') return saveMerged(api, cat, edit, result);
    if (result?.success) adoptFromDisk(cat.id, onDisk, result.mtime);
    return result;
}

function askReplace(name) {
    return new Promise(answer => window.dispatchEvent(new CustomEvent(CATALOG_EDIT_CLASH, { detail: { name, answer } })));
}

// The registry takes `onDisk` in place of its catalog `id`, unless that was
// removed here meanwhile. A material it no longer holds was deleted in the
// other copy, and goes out with the change notice so an open design that uses
// it keeps its own copy.
function adoptFromDisk(id, onDisk, mtime) {
    fileTimes.set(id, mtime);
    const registry = getRegistry();
    const held = registry[id];
    if (!held) return;
    const removed = {};
    for (const [key, material] of Object.entries(held.materials)) {
        if (material && !onDisk.materials[key]) removed[`${id}:${key}`] = removedRecord(held, material);
    }
    registry[id] = onDisk;
    notifyCatalogsChanged(Object.keys(removed).length ? removed : null);
}

// Delete a catalog file via IPC; a failure is reported like a failed save.
// `options.permanent` deletes it for good rather than to the Recycle Bin.
export function deleteCatalogFile(catalogId, source, name = catalogId, options) {
    const api = window.electronAPI;
    return api?.deleteCatalog
        ? watchWrite(api.deleteCatalog(catalogId, source, options), catalogId, name, 'delete')
        : Promise.resolve(null);
}

// Backfill a missing/blank material `id` from its map key. A catalog material's
// key in `cat.materials` IS its id by contract, but some sources persisted
// entries without an explicit `id` field (e.g. the legacy multipassband sample
// catalog) — those rendered as dead grey rows that sorted to the top (empty id)
// and crashed materialToDraft (`mat.id.replace`). Normalising here, at the one
// registration boundary, heals existing AND future catalogs in place.
//
// A tabulated material also gets an explicit interpolation rule: the one it
// names, or PCHIP for a catalog saved before the field existed.
//
// A catalog file edited by hand or written by another tool can lack a name or a
// materials object, and every list and search reads both. It is listed under
// its id with no materials rather than taking those lists down. Nothing is
// written back until the user edits that catalog.
export function normalizeCatalogMaterials(cat) {
    if (!cat) return cat;
    if (typeof cat.name !== 'string' || !cat.name.trim()) cat.name = String(cat.id);
    const materials = cat.materials;
    if (!materials || typeof materials !== 'object' || Array.isArray(materials)) cat.materials = {};
    for (const [key, m] of Object.entries(cat.materials)) {
        if (!m) continue;
        if (m.id == null || m.id === '') m.id = key;
        if (hasTabulatedComponent(m)) m.interp = interpolationRuleOf(m);
    }
    return cat;
}
