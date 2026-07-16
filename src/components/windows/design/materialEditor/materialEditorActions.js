/**
 * Material Editor — catalog-level actions (import, create, duplicate, remove).
 *
 * Each function takes its call-specific argument(s) plus a `ctx` bundle from
 * useMaterialEditor (state values + setters + notify/me). Kept as plain
 * functions rather than component methods so the hook itself stays a thin
 * wiring layer.
 */

import {
    addCatalog, removeCatalog, createUserCatalog, duplicateCatalog, importMaterialsIntoCatalog,
} from '../../../../utils/materials/catalogManager.js';
import { parseAGF } from '../../../../utils/materials/agfParser.js';
import { buildOptiLayerCatalog } from '../../../../utils/materials/optilayerParser.js';

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

// Parse the selected OptiLayer files and stash the result as pending import
// state — nothing is created until the user picks a destination catalog via
// commitOptiLayerImport.
export async function importOptiLayerFiles(ctx) {
    const { me, notify, setOlImport } = ctx;
    try {
        const result = await window.electronAPI.importCatalogOptiLayer();
        if (result.canceled) return;
        if (!result.success) { notify('error', me.importError(result.error || 'Unknown error')); return; }
        const { catalog, errors } = buildOptiLayerCatalog(result.files, {
            id: '__import__', name: 'OptiLayer', source: 'optilayer',
        });
        const count = Object.keys(catalog.materials).length;
        if (count === 0) {
            notify('error', me.importError(errors[0]?.error || 'No materials parsed'));
            return;
        }
        setOlImport({ materials: catalog.materials, count, errors });
    } catch (err) {
        notify('error', me.importError(err.message));
    }
}

// Commit a parsed OptiLayer import into the chosen catalog ('__new__' = create one).
export function commitOptiLayerImport(targetCatId, ctx) {
    const { olImport, catalogs, loadCatalogs, setCatFilter, setOlImport, notify, me } = ctx;
    const imp = olImport;
    if (!imp) return;
    try {
        let catId = targetCatId, catName;
        if (catId === '__new__') {
            const cat = createUserCatalog('Imported OptiLayer');
            catId = cat.id; catName = cat.name;
        } else {
            catName = catalogs.find(cat => cat.id === catId)?.name || catId;
        }
        const added = importMaterialsIntoCatalog(catId, imp.materials);
        loadCatalogs();
        setCatFilter(catId);
        setOlImport(null);
        notify('ok', imp.errors.length
            ? me.importOptiLayerErrors(added, imp.errors.length)
            : me.importOptiLayerSuccess(added, catName));
    } catch (err) {
        notify('error', me.importError(err.message));
        setOlImport(null);
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

export function createCatalog(ctx) {
    const { newCatalogName, loadCatalogs, setCatFilter, setShowNewCatalog, setNewCatalogName } = ctx;
    const name = newCatalogName.trim();
    if (!name) return;
    const cat = createUserCatalog(name);
    loadCatalogs();
    setCatFilter(cat.id);
    setShowNewCatalog(false);
    setNewCatalogName('');
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
