/**
 * RIIBrowser — actions: offline-mirror update and add-to-catalog flow.
 *
 * Plain functions taking a `ctx` bundle from useRIIBrowser (state values +
 * setters), kept out of the hook so its own function stays a thin wiring layer.
 */

import {
    loadCatalog, getDatabaseStatus, updateDatabase, clearCatalogCache, riiToMaterialEntry,
} from '../../../../utils/materials/riiDatabase.js';
import { getCatalogs, createUserCatalog, saveUserMaterial } from '../../../../utils/materials/catalogManager.js';

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
            setUpdateMsg(rii.updateError(res.error || ''));
        }
    } catch (err) {
        setUpdateMsg(rii.updateError(err.message));
    } finally {
        setUpdating(false);
    }
}

// Save the currently-fetched material into a catalog ('__new__' = create one).
export function addRiiMaterial(catId, ctx) {
    const { mat, selected, rii, onAdded, setPhase, setAddMsg } = ctx;
    try {
        const entry = riiToMaterialEntry(mat, selected.pageName, selected.bookName);
        let resolvedId = catId;
        if (catId === '__new__') {
            resolvedId = createUserCatalog('RefractiveIndex.info').id;
        }
        saveUserMaterial(resolvedId, entry);
        setPhase('ok');
        setAddMsg(rii.addSuccess(entry.name));
        window.dispatchEvent(new CustomEvent('catalogs-loaded'));
        if (onAdded) onAdded(resolvedId, entry.name);
    } catch (err) {
        setPhase('error');
        setAddMsg(rii.addError(err.message));
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
