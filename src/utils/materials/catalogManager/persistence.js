// Drop the getNK closure that getMaterialById attaches lazily, leaving the
// plain dispersion record. Anything written to disk goes through here.
import { hasTabulatedComponent, interpolationRuleOf } from '../pchip.js';
import { randomHex } from './randomHex.js';

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
// reported as CATALOG_SAVE_FAILED. Resolves to the IPC result either way.
function watchWrite(call, id, name, action) {
    return Promise.resolve(call).then(
        (result) => {
            if (result && result.success === false) reportWriteFailure(id, name, action, result.error);
            return result;
        },
        (err) => {
            reportWriteFailure(id, name, action, err?.message ?? err);
            return { success: false, error: err?.message ?? String(err) };
        });
}

// Persist one catalog to Documents\TFStudio\Materials\ via IPC. Every catalog
// edit ends here, which is why the change notice goes here too; `removed` is
// passed on to it (see notifyCatalogsChanged). Callers need not wait for the
// returned promise: a failure is reported through CATALOG_SAVE_FAILED.
export function persistCatalog(cat, removed = null) {
    if (!cat || cat.source === 'builtin') return Promise.resolve(null);
    const api = window.electronAPI;
    const pending = api?.saveCatalog
        ? watchWrite(api.saveCatalog(serializeCatalog(cat)), cat.id, cat.name, 'save')
        : Promise.resolve(null);
    notifyCatalogsChanged(removed);
    return pending;
}

// Delete a catalog file via IPC; a failure is reported like a failed save.
export function deleteCatalogFile(catalogId, source, name = catalogId) {
    const api = window.electronAPI;
    return api?.deleteCatalog
        ? watchWrite(api.deleteCatalog(catalogId, source), catalogId, name, 'delete')
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
