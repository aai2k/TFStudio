/**
 * The Material Editor asks before it loses work or a design's material.
 *
 *   1. Clicking another material, another catalog or New with unsaved changes
 *      in the form asks before throwing them away; with nothing unsaved it
 *      goes straight on.
 *   2. Deleting a material or a catalog says how many designs use it; each of
 *      those keeps its own copy (tests/design_store_copies.mjs).
 *   3. The same holds for each of the editor's buttons that replaces the form:
 *      New catalog, Duplicate catalog, another catalog, New material.
 *   4. A deleted material's id is never given to a new one in its catalog, so
 *      a design that kept the deleted material keeps computing with it.
 *
 * Run: node tests/material_editor_guards.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const me = makeLocale().materialEditor;
const { initCatalogs, getCatalogs } = await import('../src/utils/materials/catalogManager.js');
const { confirmLeavingDraft, deleteMaterialWithConfirm } = await import(
    '../src/components/windows/design/materialEditor/materialEditorMaterialActions.js');
const { removeCatalogWithConfirm } = await import(
    '../src/components/windows/design/materialEditor/materialEditorActions.js');

// ── 1. Unsaved changes are not thrown away without asking ────────────────────
{
    let dialog = null;
    let ran = 0;
    const setInputDialog = d => { dialog = d; };
    const editDraft = { name: 'Ta2O5 run 7', id: 'Ta2O5_run_7' };

    confirmLeavingDraft({ isDirty: false, editDraft, setInputDialog, me }, () => { ran++; });
    assert.equal(ran, 1, 'with nothing unsaved the click goes straight through');
    assert.equal(dialog, null);

    confirmLeavingDraft({ isDirty: true, editDraft, setInputDialog, me }, () => { ran++; });
    assert.equal(ran, 1, 'with unsaved changes nothing happens yet');
    assert.equal(dialog.message, me.discardDraftConfirm('Ta2O5 run 7'), 'the editor asks, naming the material');
    dialog.onCancel();
    assert.equal(ran, 1, 'Cancel keeps the changes');

    confirmLeavingDraft({ isDirty: true, editDraft, setInputDialog, me }, () => { ran++; });
    dialog.onConfirm();
    assert.equal(ran, 2, 'Discard goes on');
}

// ── 2. A delete says how many designs use what it deletes ────────────────────
{
    const H = { id: 'H', name: 'H', formulaNum: -1, tabData: [[300, 2.3, 0], [2000, 2.3, 0]] };
    initCatalogs({ user_lab: { id: 'user_lab', name: 'Lab', source: 'user', materials: { H, L: { ...H, id: 'L', name: 'L' } } } });
    const layer = material => ({ id: material, material, thickness: 50 });
    const designs = {
        a: { id: 'a', frontLayers: [layer('user_lab:H')], backLayers: [] },
        b: { id: 'b', frontLayers: [layer('user_lab:L')], backLayers: [] },
        c: { id: 'c', frontLayers: [layer('builtin:SiO2')], backLayers: [] },
    };
    let dialog = null;
    const ctx = {
        me, designs, catalogs: getCatalogs(), setInputDialog: d => { dialog = d; }, loadCatalogs() {},
        editDraft: { catalogId: 'user_lab', id: 'H', name: 'H', isNew: false }, setEditDraft() {},
        catFilter: 'all', setCatFilter() {}, selectedId: null, setSelectedId() {},
    };
    deleteMaterialWithConfirm(ctx);
    assert.equal(dialog.message, `${me.deleteConfirm('H')} ${me.usedByDesigns(1)}`, 'deleting H names the one design using it');
    removeCatalogWithConfirm('user_lab', ctx);
    assert.equal(dialog.message, `${me.deleteCatalogConfirm('Lab')} ${me.usedByDesigns(2)}`, 'deleting the catalog counts both');
    deleteMaterialWithConfirm({ ...ctx, designs: { c: designs.c } });
    assert.equal(dialog.message, me.deleteConfirm('H'), 'and says nothing more when no design uses it');
}

// ── 3. Every button that replaces the form asks first ────────────────────────
// The editor itself, rendered once with an edited material in the form.
{
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { DesignContext } = await import('../src/state/DesignContext.js');
    const { useMaterialEditor } = await import('../src/components/windows/design/materialEditor/useMaterialEditor.js');
    const { materialEditorSession } = await import('../src/components/windows/design/materialEditor/sessionState.js');
    const { emptyDraft } = await import('../src/components/windows/design/materialEditor/materialDraft.js');
    initCatalogs({ user_lab: { id: 'user_lab', name: 'Lab', source: 'user', materials: {} } });
    const pristine = { ...emptyDraft('user_lab'), name: 'Ta2O5' };
    materialEditorSession.write(null, { editDraft: { ...pristine, name: 'Ta2O5 run 7' }, pristineDraft: pristine }, null);

    let editor = null;
    let dialog = null;
    function Probe() {
        editor = useMaterialEditor({ c: {}, t: makeLocale(), setInputDialog: d => { dialog = d; } });
        return null;
    }
    renderToStaticMarkup(React.createElement(DesignContext.Provider, { value: { design: null, designs: {} } },
        React.createElement(Probe)));
    assert.equal(editor.isDirty, true, 'the form holds unsaved changes');
    const buttons = {
        'New catalog': () => editor.handleCreateCatalog(),
        'Duplicate catalog': () => editor.handleDuplicateCatalog('user_lab'),
        'another catalog': () => editor.handleCatalogChange('all'),
        'New material': () => editor.handleNewMaterial(),
    };
    for (const [label, press] of Object.entries(buttons)) {
        dialog = null;
        press();
        assert.equal(dialog?.message, me.discardDraftConfirm('Ta2O5 run 7'), `${label} asks before the changes go`);
    }
}

// ── 4. A deleted material's id is never given out again ──────────────────────
// A design that used it keeps it as its own copy, and so does every file saved
// with it; a new material under the id would take its place in all of them.
{
    const { removeUserMaterial, generateMaterialId, saveUserMaterial, importMaterialsIntoCatalog, getCatalog } =
        await import('../src/utils/materials/catalogManager.js');
    const { embedDesignMaterials, resolveDesignMaterial } = await import('../src/utils/materials/designMaterials.js');
    const Ta = { id: 'Ta2O5', name: 'Ta2O5', formulaNum: -1, tabData: [[300, 2.1, 0], [2000, 2.1, 0]] };
    initCatalogs({ user_lab: { id: 'user_lab', uid: 'stamp-lab', name: 'Lab', source: 'user', materials: { Ta2O5: { ...Ta } } } });
    const saved = embedDesignMaterials({
        id: 'd', frontLayers: [{ id: 'l', material: 'user_lab:Ta2O5', thickness: 50 }], backLayers: [],
    });
    removeUserMaterial('user_lab', 'Ta2O5');
    const id = generateMaterialId('user_lab', 'Ta2O5');
    assert.notEqual(id, 'Ta2O5', 'a new material of the same name gets an id of its own');
    saveUserMaterial('user_lab', { ...Ta, id, tabData: [[300, 1.95, 0], [2000, 1.95, 0]] });
    const resolved = resolveDesignMaterial(saved, 'user_lab:Ta2O5');
    assert.equal(resolved.status, 'embedded', 'a file saved before the delete keeps its copy');
    assert.equal(resolved.material.getNK(550)[0], 2.1, 'and computes as before');
    importMaterialsIntoCatalog('user_lab', { x: { ...Ta } });
    assert.equal(getCatalog('user_lab').materials.Ta2O5, undefined, 'an import does not take the id either');
    assert.deepEqual(getCatalog('user_lab').retiredIds, ['Ta2O5'], 'the catalog keeps the retired id');
}

console.log('PASS: material_editor_guards');
