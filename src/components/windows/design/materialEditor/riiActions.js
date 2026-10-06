/**
 * RIIBrowser — actions: offline-mirror update and add-to-catalog flow.
 *
 * Plain functions taking a `ctx` bundle from useRIIBrowser (state values +
 * setters), kept out of the hook so its own function stays a thin wiring layer.
 */

import {
    loadCatalog, getDatabaseStatus, updateDatabase, clearCatalogCache, riiToMaterialEntry,
} from '../../../../utils/materials/riiDatabase.js';
import {
    getCatalog, getCatalogs, createUserCatalog, saveUserMaterial, generateMaterialId, materialIdTaken,
} from '../../../../utils/materials/catalogManager.js';
import { freeMaterialName } from '../../../../utils/materials/catalogManager/userCatalogs.js';
import { dispersionFingerprint } from '../../../../utils/materials/catalogStamps.js';
import { sampleErrorText } from './riiRightPanel.js';

export async function updateRiiDatabase(ctx) {
    const { rii, setUpdating, setUpdateMsg, setDbStatus, setCatalogLoading, setCatalogTree } = ctx;
    setUpdating(true);
    setUpdateMsg(rii.updateDownloading);
    try {
        const res = await updateDatabase();
        if (res.success) {
            setUpdateMsg('');
            setDbStatus(await getDatabaseStatus());
            // Reload the (now refreshed) catalog tree.
            clearCatalogCache();
            setCatalogLoading(true);
            setCatalogTree(await loadCatalog());
            setCatalogLoading(false);
        } else {
            setUpdateMsg(res.unavailable ? rii.updateUnavailable : rii.updateError(res.error || ''));
        }
    } catch (err) {
        setUpdateMsg(rii.updateError(err.message));
    } finally {
        setUpdating(false);
    }
}

// The id under which the catalog already holds this page: the entry's own id,
// else a material added from the same page under the id an earlier build gave
// it. Null when the page is not there.
function heldPageId(cat, entry) {
    if (cat.materials[entry.id]) return entry.id;
    return Object.keys(cat.materials).find(id => entry.dataPath && cat.materials[id]?.dataPath === entry.dataPath) ?? null;
}

// True when the held material is the page as an add would store it now.
const samePage = (held, entry) => held.dataPath === entry.dataPath && held.name === entry.name
    && dispersionFingerprint(held) === dispersionFingerprint(entry);

// What an add stores. Replace keeps the id designs already use; Keep both adds
// the page under an id and a name of its own. A page the catalog held and
// deleted comes back under a new id (see materialIdTaken).
function storedEntry(cat, entry, heldId, choice) {
    if (!heldId) return materialIdTaken(cat, entry.id) ? { ...entry, id: generateMaterialId(cat.id, entry.id) } : entry;
    if (choice === 'replace') return { ...entry, id: heldId };
    return { ...entry, id: generateMaterialId(cat.id, entry.id), name: freeMaterialName(cat, entry.name) };
}

/**
 * Save the currently-fetched material into a catalog ('__new__' = create one).
 *
 * A catalog that already holds the page is never changed silently: an
 * unchanged copy is reported as already there, an edited one (or another
 * material under the same id) asks first. `choice` is the answer, 'replace' or
 * 'keep', given on the second call.
 */
export function addRiiMaterial(catId, ctx, choice = null) {
    const { mat, selected, rii, onAdded, setPhase, setAddMsg, setConflict } = ctx;
    try {
        const entry = riiToMaterialEntry(mat, selected.pageName, selected.bookName);
        if (!entry) throw new Error(rii.noNkData);
        const resolvedId = catId === '__new__' ? createUserCatalog('RefractiveIndex.info').id : catId;
        const cat = getCatalog(resolvedId);
        const heldId = heldPageId(cat, entry);
        if (heldId && !choice) {
            const held = cat.materials[heldId];
            if (!samePage(held, entry)) {
                setConflict({ catId: resolvedId });
                setPhase('conflict');
                setAddMsg(rii.addConflict(held.name || heldId));
                return;
            }
            setPhase('ok');
            setAddMsg(rii.alreadyInCatalog(held.name || heldId, cat.name));
            if (onAdded) onAdded(resolvedId, held.name);
            return;
        }
        const stored = saveUserMaterial(resolvedId, storedEntry(cat, entry, heldId, choice));
        setPhase('ok');
        setAddMsg(rii.addSuccess(stored.name));
        window.dispatchEvent(new CustomEvent('catalogs-loaded'));
        if (onAdded) onAdded(resolvedId, stored.name);
    } catch (err) {
        setPhase('error');
        setAddMsg(rii.addError(sampleErrorText(err, rii)));
    }
}

// "Add to catalog" click: skip the picker when there's exactly one (or zero)
// user catalogs, otherwise open it.
export function startAddFlow(ctx) {
    const { mat, selected, setTargetCatId, setPhase, doAdd } = ctx;
    if (!mat || !selected) return;
    const userCats = getCatalogs().filter(cat => cat.source === 'user');
    if (userCats.length === 0) {
        doAdd('__new__');
    } else {
        setTargetCatId(userCats[0].id);
        setPhase('picking');
    }
}
