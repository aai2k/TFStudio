/**
 * Material Editor — catalog-level actions (import, create, duplicate, remove).
 *
 * Each function takes its call-specific argument(s) plus a `ctx` bundle from
 * useMaterialEditor (state values + setters + notify/me). Kept as plain
 * functions rather than component methods so the hook itself stays a thin
 * wiring layer.
 */

import {
    addCatalog, removeCatalog, createUserCatalog, renameUserCatalog, duplicateCatalog,
    importMaterialsIntoCatalog,
} from '../../../../utils/materials/catalogManager.js';
import { parseAGF } from '../../../../utils/materials/agfParser.js';
import { DEFAULT_IMPORT_UNITS } from '../../../../utils/materials/materialFileImport.js';

export async function importAgfCatalog(ctx) {
    const { me, notify, loadCatalogs, setCatFilter } = ctx;
    try {
        const result = await window.electronAPI.importCatalogAgf();
        if (result.canceled) return;
        if (!result.success) { notify('error', me.importError(result.error || 'Unknown error')); return; }
        const catalog = parseAGF(result.text, result.fileName.toLowerCase().replace(/[^a-z0-9]/g, '_'));
        addCatalog(catalog);
        loadCatalogs();
        setCatFilter(catalog.id);
        notify('ok', me.importSuccess(catalog.name) + ` (${Object.keys(catalog.materials).length} materials)`);
    } catch (err) {
        notify('error', me.importError(err.message));
    }
}

// Pick material files (TFCalc, Essential Macleod, OptiLayer) and hand them to
// the import dialog. Nothing is parsed or created here: the dialog parses the
// batch under the unit settings the user picks and commits through
// commitFileImport.
export async function importMaterialFiles(ctx) {
    const { me, notify, setFileImport } = ctx;
    try {
        const result = await window.electronAPI.importMaterialFiles();
        if (result.canceled) return;
        if (!result.success) { notify('error', me.importError(result.error || 'Unknown error')); return; }
        setFileImport({ files: result.files, units: { ...DEFAULT_IMPORT_UNITS } });
    } catch (err) {
        notify('error', me.importError(err.message));
    }
}

// Commit the dialog's ticked entries into the chosen catalog ('__new__' =
// create one under `newCatalogName`).
export function commitFileImport(targetCatId, entries, ctx, newCatalogName) {
    const { catalogs, loadCatalogs, setCatFilter, setFileImport, notify, me } = ctx;
    try {
        let catId = targetCatId, catName;
        if (catId === '__new__') {
            const cat = createUserCatalog(newCatalogName || me.importedCatalogDefault);
            catId = cat.id; catName = cat.name;
        } else {
            catName = catalogs.find(cat => cat.id === catId)?.name || catId;
        }
        const materials = Object.fromEntries(entries.map(entry => [entry.id, entry]));
        const added = importMaterialsIntoCatalog(catId, materials);
        loadCatalogs();
        setCatFilter(catId);
        setFileImport(null);
        notify('ok', me.importFilesSuccess(added, catName));
    } catch (err) {
        notify('error', me.importError(err.message));
        setFileImport(null);
    }
}

export function removeCatalogWithConfirm(catId, ctx) {
    const { catalogs, setInputDialog, me, loadCatalogs, catFilter, setCatFilter,
            selectedId, setSelectedId, editDraft, setEditDraft } = ctx;
    const cat = catalogs.find(cc => cc.id === catId);
    if (!cat) return;
    const doDelete = () => {
        removeCatalog(catId);
        loadCatalogs();
        if (catFilter === catId) setCatFilter('all');
        if (selectedId?.startsWith(catId + ':')) setSelectedId(null);
        if (editDraft?.catalogId === catId) setEditDraft(null);
    };
    if (setInputDialog) {
        setInputDialog({
            confirm: true, danger: true,
            title: me.removeCatalog,
            message: me.deleteCatalogConfirm(cat.name),
            confirmLabel: me.deleteMaterial,
            onConfirm: () => { doDelete(); setInputDialog(null); },
            onCancel:  () => setInputDialog(null),
        });
    } else if (window.confirm(me.deleteCatalogConfirm(cat.name))) {
        doDelete();
    }
}

// Create an empty user catalog (prompts for the name) and switch to it.
export function createCatalogWithPrompt(ctx) {
    const { setInputDialog, me, loadCatalogs, setCatFilter, setEditDraft } = ctx;
    const doCreate = (name) => {
        const cat = createUserCatalog(name);
        loadCatalogs();
        setCatFilter(cat.id);
        setEditDraft(null);
    };
    const defName = me.newCatalogDefault;
    if (setInputDialog) {
        setInputDialog({
            title: me.newCatalogPrompt,
            defaultValue: defName,
            confirmLabel: me.newCatalog,
            onConfirm: (val) => { doCreate((val || '').trim() || defName); setInputDialog(null); },
            onCancel: () => setInputDialog(null),
        });
    } else {
        doCreate(defName);
    }
}

// Rename a user catalog (prompts for the new name). Only user catalogs can be
// renamed — built-in and imported catalogs take their name from their source.
export function renameCatalogWithPrompt(catId, ctx) {
    const { catalogs, setInputDialog, me, loadCatalogs, notify } = ctx;
    const cat = catalogs.find(cc => cc.id === catId);
    if (!cat || cat.source !== 'user') return;
    const doRename = (name) => {
        renameUserCatalog(catId, name);
        loadCatalogs();
        notify('ok', me.renameSuccess(name));
    };
    if (setInputDialog) {
        setInputDialog({
            title: me.renameCatalogPrompt(cat.name),
            defaultValue: cat.name,
            confirmLabel: me.renameCatalog,
            onConfirm: (val) => {
                const name = (val || '').trim();
                if (name && name !== cat.name) doRename(name);
                setInputDialog(null);
            },
            onCancel: () => setInputDialog(null),
        });
    }
}

// Duplicate a whole catalog into a new user catalog (prompts for the new name).
export function duplicateCatalogWithPrompt(srcId, ctx) {
    const { catalogs, setInputDialog, me, loadCatalogs, setCatFilter, setEditDraft, notify } = ctx;
    const src = catalogs.find(cc => cc.id === srcId);
    if (!src) return;
    const doDup = (name) => {
        const cat = duplicateCatalog(srcId, name);
        if (!cat) { notify('error', me.duplicateError || 'Duplicate failed'); return; }
        loadCatalogs();
        setCatFilter(cat.id);
        setEditDraft(null);
        notify('ok', me.duplicateSuccess(cat.name, Object.keys(cat.materials).length));
    };
    const defName = src.name + ' copy';
    if (setInputDialog) {
        setInputDialog({
            title: me.duplicateCatalogPrompt(src.name),
            defaultValue: defName,
            confirmLabel: me.duplicateCatalog,
            onConfirm: (val) => { doDup((val || '').trim() || defName); setInputDialog(null); },
            onCancel: () => setInputDialog(null),
        });
    } else {
        doDup(defName);
    }
}
