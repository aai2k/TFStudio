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
} from '../../../../utils/materials/catalogManager.js';
import { emptyDraft, materialToDraft, draftToMaterial, validateDraft } from './materialDraft.js';

export function newMaterial(ctx) {
    const { catFilter, setSelectedId, setEditDraft } = ctx;
    setSelectedId(null);
    setEditDraft(emptyDraft(catFilter));
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

export function saveMaterial(ctx) {
    const { editDraft, catalogs, me, notify, loadCatalogs, setEditDraft } = ctx;
    if (!editDraft) return;
    const err = validateDraft(editDraft, catalogs, me);
    if (err) { notify('error', err); return; }
    try {
        // Auto-generate ID from name if still empty
        let draft = editDraft;
        if (!draft.id.trim()) {
            draft = { ...draft, id: generateMaterialId(draft.catalogId, draft.name) };
        }
        const mat = draftToMaterial(draft);
        saveUserMaterial(draft.catalogId, mat);
        // If the ID was sanitized from a legacy colon ID, remove the old entry
        if (draft.originalId && draft.originalId !== mat.id) {
            removeUserMaterial(draft.catalogId, draft.originalId);
        }
        loadCatalogs();
        // Refresh draft with saved data (marks isNew=false)
        const cat = getCatalogs().find(cc => cc.id === draft.catalogId);
        if (cat?.materials?.[mat.id]) {
            setEditDraft(materialToDraft(draft.catalogId, { ...cat.materials[mat.id] }));
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
    const { editDraft, setInputDialog, me, loadCatalogs, setEditDraft } = ctx;
    if (!editDraft || editDraft.isNew) return;
    const doDelete = () => {
        // Use originalId if the ID was sanitized from a legacy colon ID
        removeUserMaterial(editDraft.catalogId, editDraft.originalId || editDraft.id);
        loadCatalogs();
        setEditDraft(null);
    };
    if (setInputDialog) {
        setInputDialog({
            confirm: true, danger: true,
            title: me.deleteMaterial,
            message: me.deleteConfirm(editDraft.name || editDraft.id),
            confirmLabel: me.deleteMaterial,
            onConfirm: () => { doDelete(); setInputDialog(null); },
            onCancel:  () => setInputDialog(null),
        });
    } else if (window.confirm(me.deleteConfirm(editDraft.name || editDraft.id))) {
        doDelete();
    }
}
