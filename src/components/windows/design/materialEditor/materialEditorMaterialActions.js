/**
 * Material Editor — material-level actions (select, save, copy, delete).
 *
 * Each function takes its call-specific argument(s) plus a `ctx` bundle from
 * useMaterialEditor (state values + setters + notify/me). Kept as plain
 * functions rather than component methods so the hook itself stays a thin
 * wiring layer.
 */

import {
    getCatalogs, saveUserMaterial, removeUserMaterial, generateMaterialId, copyMaterialToCatalog,
    createUserCatalog,
} from '../../../../utils/materials/catalogManager.js';
import { countDesignsUsing } from '../../../../utils/materials/designsUsing.js';
import { emptyDraft, materialToDraft, draftToMaterial, validateDraft } from './materialDraft.js';

// A blank material goes into the selected catalog when that is one of the
// user's own. Otherwise it goes into one of theirs: the only one straight
// away, the one picked when there are several, and a new one, under the
// default name, when there is none.
export function newMaterial(ctx) {
    const { catFilter, me, loadCatalogs, setNewMaterialPicker } = ctx;
    // Decided from the registry rather than the editor's copy of it, which
    // another window making a catalog leaves behind; the reload brings the
    // copy, and so the picker's rows, up to date.
    loadCatalogs();
    const userCats = getCatalogs().filter(cat => cat.source === 'user');
    if (userCats.some(cat => cat.id === catFilter)) { startBlankMaterial(catFilter, ctx); return; }
    if (userCats.length === 1) { startBlankMaterial(userCats[0].id, ctx); return; }
    if (userCats.length > 1) { setNewMaterialPicker(true); return; }
    const created = createUserCatalog(me.newCatalogDefault);
    loadCatalogs();
    startBlankMaterial(created.id, ctx);
}

// Open an empty form for a material in `catalogId`, with that catalog selected
// so the list shows where it will be saved.
export function startBlankMaterial(catalogId, ctx) {
    const { setNewMaterialPicker, setCatFilter, setSelectedId, setEditDraft } = ctx;
    setNewMaterialPicker(false);
    setCatFilter(catalogId);
    setSelectedId(null);
    setEditDraft(emptyDraft(catalogId));
}

/**
 * Run `action`, which replaces the open draft (another material, another
 * catalog, a new one), after asking when the draft has unsaved changes, rather
 * than throwing them away.
 */
export function confirmLeavingDraft({ isDirty, editDraft, setInputDialog, me }, action) {
    if (!isDirty || !setInputDialog) { action(); return; }
    setInputDialog({
        confirm: true, danger: true,
        title: me.unsavedChanges,
        message: me.discardDraftConfirm(editDraft.name || editDraft.id),
        confirmLabel: me.discardDraft,
        onConfirm: () => { setInputDialog(null); action(); },
        onCancel: () => setInputDialog(null),
    });
}

export function selectMaterial(compId, catalogId, mat, ctx) {
    const { catalogs, setCopyPickerFor, setEditDraft, setSelectedId } = ctx;
    setCopyPickerFor(null);
    const cat = catalogs.find(cc => cc.id === catalogId);
    if (cat?.source === 'user') {
        setEditDraft(materialToDraft(catalogId, mat));
        setSelectedId(null);
    } else {
        setEditDraft(null);
        setSelectedId(compId);
    }
}

/**
 * The ID a draft is saved under. A new material takes one made from its name
 * and unique in its catalog; a saved one keeps its own, since designs refer to
 * the material by it.
 */
export function draftSaveId(draft) {
    return draft.isNew ? generateMaterialId(draft.catalogId, draft.name) : draft.id;
}

export function saveMaterial(ctx) {
    const { editDraft, catalogs, me, notify, loadCatalogs, setEditDraft } = ctx;
    if (!editDraft) return;
    const draft = { ...editDraft, id: draftSaveId(editDraft) };
    const err = validateDraft(draft, catalogs, me);
    if (err) { notify('error', err); return; }
    try {
        const mat = draftToMaterial(draft);
        saveUserMaterial(draft.catalogId, mat);
        loadCatalogs();
        // Refresh draft with saved data (marks isNew=false)
        const cat = getCatalogs().find(cc => cc.id === draft.catalogId);
        if (cat?.materials?.[mat.id]) {
            setEditDraft({
                ...materialToDraft(draft.catalogId, { ...cat.materials[mat.id] }),
                // Only a fit stores a band, so a band typed before one was made
                // would be thrown away by the refresh that follows a save.
                fitRangeMinNm: draft.fitRangeMinNm,
                fitRangeMaxNm: draft.fitRangeMaxNm,
            });
        }
        notify('ok', me.saveSuccess(mat.name));
    } catch (err) {
        notify('error', err.message);
    }
}

// Copy a material into another (user) catalog. Works for any source material —
// builtin/AGF/RII (passed in directly) or a user material reconstructed from
// the edit draft (see copyUserMaterialDraft). Auto-copies when there is exactly
// one user catalog; otherwise defers to the destination-catalog modal.
export function openCopyPicker(srcMat, ctx) {
    const { catalogs, notify, me, setCopyPickerFor } = ctx;
    if (!srcMat) return;
    const userCats = catalogs.filter(cat => cat.source === 'user');
    if (userCats.length === 0) { notify('error', me.copyToCatalogNoTarget); return; }
    if (userCats.length === 1) { copyToCatalog(srcMat, userCats[0].id, ctx); return; }
    setCopyPickerFor(srcMat);
}

export function copyUserMaterialDraft(ctx) {
    const { editDraft } = ctx;
    if (!editDraft) return;
    openCopyPicker(draftToMaterial(editDraft), ctx);
}

export function copyToCatalog(srcMat, targetCatId, ctx) {
    const { loadCatalogs, setSelectedId, setCatFilter, setEditDraft, notify, me, setCopyPickerFor } = ctx;
    setCopyPickerFor(null);
    const saved = copyMaterialToCatalog(srcMat, targetCatId);
    if (!saved) { notify('error', me.duplicateError || 'Copy failed'); return; }
    loadCatalogs();
    setSelectedId(null);
    setCatFilter(targetCatId);
    const cat = getCatalogs().find(cc => cc.id === targetCatId);
    if (cat?.materials?.[saved.id]) setEditDraft(materialToDraft(targetCatId, { ...cat.materials[saved.id] }));
    notify('ok', me.copyMaterialDone(saved.name, cat?.name || targetCatId));
}

export function deleteMaterialWithConfirm(ctx) {
    const { editDraft, setInputDialog, me, loadCatalogs, setEditDraft, designs } = ctx;
    if (!editDraft || editDraft.isNew) return;
    // The designs that use it keep it as their own copy (see
    // keepRemovedMaterials); the confirm says how many.
    const used = countDesignsUsing(designs, [`${editDraft.catalogId}:${editDraft.originalId || editDraft.id}`]);
    const message = [me.deleteConfirm(editDraft.name || editDraft.id), used ? me.usedByDesigns(used) : ''].join(' ').trim();
    const doDelete = () => {
        removeUserMaterial(editDraft.catalogId, editDraft.originalId || editDraft.id);
        loadCatalogs();
        setEditDraft(null);
    };
    if (setInputDialog) {
        setInputDialog({
            confirm: true, danger: true,
            title: me.deleteMaterial,
            message,
            confirmLabel: me.deleteMaterial,
            onConfirm: () => { doDelete(); setInputDialog(null); },
            onCancel:  () => setInputDialog(null),
        });
    } else if (window.confirm(message)) {
        doDelete();
    }
}
