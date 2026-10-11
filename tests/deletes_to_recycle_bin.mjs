/**
 * Deleting a design, a catalog, a library coating, a merit preset or a spec
 * preset moves the file to the Recycle Bin, as deleting a project folder does,
 * so one confirmed by mistake can be restored.
 *
 *   1. Where the bin refuses a file, it is kept and the answer is 'no-bin'; a
 *      delete sent again with permanent: true deletes it for good. With no
 *      shell at all, the file is deleted as before.
 *   2. Each window that deletes them asks, on 'no-bin', whether to delete for
 *      good, once per delete the user made, and sends the delete again with
 *      permanent: true only on yes.
 *
 * Run: node tests/deletes_to_recycle_bin.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadApp, makeDesignCtx, makeLocale, makeSampleDesign, shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

const require = createRequire(import.meta.url);
const paths = require('../src/main/paths.js');
const projects = require('../src/main/ipc/projects.js');
const catalogs = require('../src/main/ipc/catalogs.js');
const meritPresets = require('../src/main/ipc/meritPresets.js');
const qualifiers = require('../src/main/ipc/qualifiers.js');
const coatings = require('../src/main/ipc/coatings.js');

const design = (id, name) => JSON.stringify({
    id, name, substrate: { material: 'BK7' }, frontLayers: [], backLayers: [],
});

// One data folder holding one of each kind of file, with every handler that
// deletes them registered on it. `shell` is what the Electron shell would be.
function makeData(root, shell) {
    const dir = (...parts) => path.join(root, ...parts);
    const files = {
        designA: dir('Projects', 'Customer', 'AR.tfs'),
        designB: dir('Projects', 'Customer', 'HR.tfs'),
        designC: dir('Projects', 'Customer', 'BP.tfs'),
        catalog: dir('Materials', 'user', 'user_lab.catalog.json'),
        merit: dir('MeritFunctions', 'AR MF.tfsm'),
        spec: dir('Qualifiers', 'AR spec.tfsq'),
        coating: dir('Coatings', 'BBAR vis.tfsc'),
    };
    const contents = {
        designA: design('design-a', 'AR'),
        designB: design('design-b', 'HR'),
        designC: design('design-c', 'BP'),
        catalog: JSON.stringify({ id: 'user_lab', name: 'Lab', source: 'user', materials: {} }),
        merit: JSON.stringify({ ver: 1, name: 'AR MF', operands: [] }),
        spec: JSON.stringify({ ver: 1, name: 'AR spec', qualifiers: [] }),
        coating: JSON.stringify({ ver: 1, name: 'BBAR vis', layers: [] }),
    };
    for (const [key, file] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents[key]);
    }
    for (const sub of ['agf', 'refractiveindex', 'library', 'optilayer']) {
        fs.mkdirSync(dir('Materials', sub), { recursive: true });
    }

    const unlinked = [];
    const logs = [];
    const trackedFs = { ...fs, unlinkSync: (file) => { unlinked.push(file); fs.unlinkSync(file); } };
    const handlers = new Map();
    const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
    const ctx = {
        ...paths, fs: trackedFs, path, log: (message) => logs.push(message),
        projectsDir: dir('Projects'), materialsDir: dir('Materials'),
        meritFunctionsDir: dir('MeritFunctions'), qualifiersDir: dir('Qualifiers'), coatingsDir: dir('Coatings'),
        ...(shell ? { shell } : {}),
    };
    for (const module of [projects, catalogs, meritPresets, qualifiers, coatings]) module.register(ipcMain, ctx);
    const call = (channel, ...args) => handlers.get(channel)(null, ...args);

    // What the Design Editor's delete, the explorer's multi-select delete, the
    // Material Editor, the Coating Library, the Merit Function Editor and the
    // Specification window send, with `options` when the user has said to
    // delete for good.
    const deleteAll = async (...options) => [
        await call('delete-item', 'Customer', 'AR', 'design-a', ...options),
        await call('delete-item', 'Customer', 'HR', 'design-b', ...options),
        await call('delete-item', 'Customer', 'BP', 'design-c', ...options),
        await call('catalog:delete', 'user_lab', 'user', ...options),
        await call('mf:delete', 'AR MF', ...options),
        await call('qualifiers:delete', 'AR spec.tfsq', ...options),
        await call('coatings:delete', 'BBAR vis', ...options),
    ];
    return { files, contents, unlinked, logs, deleteAll };
}

// ── 1. The main process ──────────────────────────────────────────────────────

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-recycle-bin-'));
try {
    // ── Where there is a Recycle Bin, every one of them goes to it ────────────
    {
        const bin = path.join(root, 'bin');
        fs.mkdirSync(bin);
        const trashed = [];
        const shell = {
            trashItem: async (file) => {
                trashed.push(file);
                fs.renameSync(file, path.join(bin, `${trashed.length}-${path.basename(file)}`));
            },
        };
        const data = makeData(path.join(root, 'with-bin'), shell);
        const results = await data.deleteAll();

        assert.ok(results.every(result => result.success), 'every delete succeeds');
        assert.deepEqual(trashed, Object.values(data.files), 'each file is handed to the Recycle Bin');
        assert.deepEqual(data.unlinked, [], 'and none is deleted outright');
        for (const file of Object.values(data.files)) assert.ok(!fs.existsSync(file), `${path.basename(file)} is gone from its folder`);
        const restored = Object.keys(data.files).map((key, index) =>
            fs.readFileSync(path.join(bin, `${index + 1}-${path.basename(data.files[key])}`), 'utf8') === data.contents[key]);
        assert.ok(restored.every(Boolean), 'and is in the bin as it was');
    }

    // ── Where the bin refuses, nothing is deleted until the user says so ──────
    {
        const label = 'a bin that refuses';
        let tried = 0;
        const shell = { trashItem: async () => { tried++; throw new Error('no trash here'); } };
        const data = makeData(path.join(root, 'bin-refuses'), shell);
        const results = await data.deleteAll();

        assert.deepEqual(results, Object.values(data.files).map(() => ({ success: false, error: 'no-bin' })),
            `${label}: every delete comes back with no-bin`);
        assert.deepEqual(data.unlinked, [], `${label}: none is deleted outright`);
        for (const [key, file] of Object.entries(data.files)) {
            assert.equal(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, data.contents[key],
                `${label}: ${path.basename(file)} is kept as it was`);
        }
        assert.equal(data.logs.filter(line => line.includes('could not go to the Recycle Bin')).length, 7,
            `${label}: each refusal is logged`);

        const forGood = await data.deleteAll({ permanent: true });
        assert.ok(forGood.every(result => result.success), `${label}: asked to delete for good, every delete succeeds`);
        assert.equal(tried, 7, `${label}: without trying the bin again`);
        assert.deepEqual(data.unlinked, Object.values(data.files), `${label}: each file is deleted outright`);
        for (const file of Object.values(data.files)) assert.ok(!fs.existsSync(file), `${label}: ${path.basename(file)} is gone`);
    }

    // ── Where there is no shell at all, the file is deleted ───────────────────
    {
        const label = 'no shell at all';
        const data = makeData(path.join(root, label.replace(/ /g, '-')), undefined);
        const results = await data.deleteAll();

        assert.ok(results.every(result => result.success), `${label}: every delete still succeeds`);
        assert.deepEqual(data.unlinked, Object.values(data.files), `${label}: each file is deleted outright`);
        for (const file of Object.values(data.files)) assert.ok(!fs.existsSync(file), `${label}: ${path.basename(file)} is gone`);
    }
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

// ── 2. The windows ───────────────────────────────────────────────────────────

shimBrowserGlobals();
const R = makeEffectRuntime(globalThis.React);
globalThis.React = R;
const { DesignContext } = await loadApp();
const t = makeLocale('en');
const { noBin } = t.dialogs;

const [
    { useProjectPersistence }, { useProjectRemoval }, { idsLeavingTree }, { removeCatalogWithConfirm }, catalogManager,
    { useCoatingLibrary }, { coatingLibrarySession }, { useMeritPresets }, { useDiskPresets },
] = await Promise.all([
    import('../src/hooks/useProjectPersistence.js'),
    import('../src/hooks/useProjectRemoval.js'),
    import('../src/components/panels/projectExplorerModel.js'),
    import('../src/components/windows/design/materialEditor/materialEditorActions.js'),
    import('../src/utils/materials/catalogManager.js'),
    import('../src/components/windows/design/coatingLibrary/useCoatingLibrary.js'),
    import('../src/components/windows/design/coatingLibrary/sessionState.js'),
    import('../src/components/windows/optimization/meritFunctionEditor/useMeritPresets.js'),
    import('../src/components/windows/design/specification/useDiskPresets.js'),
]);

// Every delete a window sends, to a Recycle Bin that refuses them all: a delete
// without permanent: true comes back 'no-bin' and deletes nothing.
const sent = [];
const binRefuses = (kind, nameAt = 0) => async (...args) => {
    const permanent = args.some(arg => arg?.permanent === true);
    sent.push(`${kind} ${args[nameAt]}${permanent ? ' for good' : ''}`);
    return permanent ? { success: true } : { success: false, error: 'no-bin' };
};
const api = {
    deleteItem: binRefuses('design', 1), deleteFolder: binRefuses('folder'), deleteCatalog: binRefuses('catalog'),
    deleteCoating: binRefuses('coating'), deleteMFPreset: binRefuses('merit'), deleteQualifierPreset: binRefuses('spec'),
    listCoatings: async () => ({ success: true, presets: [{ name: 'BBAR vis', record: { name: 'BBAR vis', layers: [] } }] }),
};
window.electronAPI = new Proxy(api, { get: (target, name) => target[name] || (() => Promise.resolve({ success: true, presets: [] })) });
const take = () => sent.splice(0);

// The Coating Library and the Specification window ask with the browser's
// confirm, as their delete does; the first answer is to that delete.
const asked = [];
const answers = [];
window.confirm = (message) => { asked.push(message); return answers.shift() ?? false; };
// A catalog write that failed is announced as an event; a refusal is not one.
const events = [];
window.dispatchEvent = (event) => { events.push(event); return true; };
const eventTypes = () => events.map(event => event.type);

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// The Project Explorer asks in the app's confirm dialog, as its delete does:
// one question for a design, for a multi-select and for a project folder.
{
    let dialog = null;
    const notices = [];
    const evicted = [];
    const tree = {
        foldersRef: { current: [
            { id: 'Customer', name: 'Customer', items: [
                { id: 'design-ar', name: 'AR' }, { id: 'design-hr', name: 'HR' }, { id: 'design-bp', name: 'BP' }] },
            { id: 'Archive', name: 'Archive', items: [] },
        ] },
        setFolders: () => {}, setSelectedFolder: () => {}, selectedItem: null, selectedItems: [],
        evictDesigns: (ids) => evicted.push(...ids), forgetUnreadNames: () => {},
    };
    R.unmount();
    const removal = R.run(() => useProjectRemoval({
        tree, persistChange: useProjectPersistence(note => notices.push(note), t),
        setInputDialog: (next) => { dialog = next; }, setMessageNotification: note => notices.push(note), t,
    }));

    await removal.removeItem('Customer', 'design-ar');
    assert.equal(dialog?.title, noBin.one('AR'), 'explorer: a design the bin refuses is asked about by name');
    assert.equal(dialog.confirmLabel, t.dialogs.deleteDesign.confirm, 'explorer: with Delete');
    assert.deepEqual(notices, [], 'explorer: rather than reported as a failure');
    dialog.onCancel();
    assert.deepEqual(evicted, [], 'explorer: on Cancel the design stays');
    assert.deepEqual(take(), ['design AR'], 'explorer: and nothing more is sent');

    await removal.removeItem('Customer', 'design-ar');
    dialog.onConfirm();
    await settle();
    assert.deepEqual(take(), ['design AR', 'design AR for good'], 'explorer: on Delete it is sent again for good');
    assert.deepEqual(evicted, ['design-ar'], 'explorer: and leaves the tree');

    await removal.removeSelectedItems([{ id: 'design-hr' }, { id: 'design-bp' }]);
    assert.equal(dialog?.title, noBin.several(2), 'explorer: a multi-select asks once for all it holds');
    assert.equal(dialog.confirmLabel, t.dialogs.deleteDesigns.confirm);
    dialog.onConfirm();
    await settle();
    assert.equal(dialog, null, 'explorer: and asks nothing more');
    assert.deepEqual(take(), ['design HR', 'design BP', 'design HR for good', 'design BP for good'],
        'explorer: the rest are deleted for good');

    await removal.removeFolder('Customer');
    assert.equal(dialog?.title, noBin.one('Customer'), 'explorer: a project folder asks once, by its name');
    assert.equal(dialog.confirmLabel, t.dialogs.deleteProject.confirm);
    dialog.onConfirm();
    await settle();
    assert.deepEqual(take(), ['folder Customer', 'folder Customer for good'], 'explorer: and on Delete is deleted for good');
}

// A design two folders show through linked files loses only the row whose file
// was deleted: the other folder keeps its row, and the design its working copy.
{
    const folders = [
        { id: 'A', name: 'A', items: [{ id: 'shared', name: 'AR' }] },
        { id: 'B', name: 'B', items: [{ id: 'shared', name: 'AR' }, { id: 'other', name: 'X' }] },
    ];
    let shown = folders;
    const dropped = [];
    const tree = {
        foldersRef: { current: folders },
        setFolders: (next) => { shown = typeof next === 'function' ? next(shown) : next; },
        setSelectedFolder: () => {}, selectedItem: null, selectedItems: [],
        evictDesigns: (ids, isRemoved) => dropped.push(...idsLeavingTree(folders, ids, isRemoved)),
        forgetUnreadNames: () => {},
    };
    const plain = api.deleteItem;
    api.deleteItem = async () => ({ success: true });
    R.unmount();
    const removal = R.run(() => useProjectRemoval({
        tree, persistChange: useProjectPersistence(() => {}, t),
        setInputDialog: () => {}, setMessageNotification: () => {}, t,
    }));
    await removal.removeItem('A', 'shared');
    api.deleteItem = plain;
    assert.deepEqual(shown.map(f => [f.id, f.items.map(item => item.id)]), [['A', []], ['B', ['shared', 'other']]],
        'linked design: the other folder keeps its row');
    assert.deepEqual(dropped, [], 'linked design: and the design keeps its working copy');
}

// The Material Editor asks in the app's confirm dialog, as its delete does,
// and keeps the catalog until the answer.
{
    catalogManager.initCatalogs({ user_lab: { id: 'user_lab', name: 'Lab', source: 'user', materials: {} } });
    let dialog = null;
    const me = t.materialEditor;
    const ctx = {
        catalogs: catalogManager.getCatalogs(), setInputDialog: (next) => { dialog = next; }, me, t,
        loadCatalogs: () => {}, catFilter: 'all', setCatFilter: () => {},
        selectedId: null, setSelectedId: () => {}, editDraft: null, setEditDraft: () => {}, designs: {},
    };
    const deleteLab = async () => {
        removeCatalogWithConfirm('user_lab', ctx);
        dialog.onConfirm();
        await settle();
    };

    await deleteLab();
    assert.equal(dialog?.title, noBin.one('Lab'), 'material editor: a catalog the bin refuses is asked about by name');
    assert.equal(dialog.confirmLabel, me.deleteMaterial, 'material editor: with Delete');
    assert.ok(catalogManager.getCatalog('user_lab'), 'material editor: the catalog stays meanwhile');
    assert.ok(!eventTypes().includes('catalog-save-failed'), 'material editor: and the refusal is not reported as a failed write');
    dialog.onCancel();
    assert.ok(catalogManager.getCatalog('user_lab'), 'material editor: on Cancel too');

    await deleteLab();
    dialog.onConfirm();
    await settle();
    assert.equal(catalogManager.getCatalog('user_lab'), null, 'material editor: on Delete it goes');
    assert.deepEqual(take(), ['catalog user_lab', 'catalog user_lab', 'catalog user_lab for good'],
        'material editor: deleted for good');
}

// A catalog the registry takes again while its file is being deleted, as a
// save merged with another copy's file does, is still the one that goes, with
// every material it held by then.
{
    catalogManager.initCatalogs({ user_glass: { id: 'user_glass', name: 'Glass', source: 'user', materials: {} } });
    const added = { id: 'N', name: 'N', formulaNum: -1, tabData: [[300, 1.5, 0], [1200, 1.5, 0]] };
    const plain = api.deleteCatalog;
    api.deleteCatalog = (...args) => {
        catalogManager.addCatalog({ id: 'user_glass', name: 'Glass', source: 'user', materials: { N: added } });
        return plain(...args);
    };
    events.length = 0;
    await catalogManager.removeCatalog('user_glass', { permanent: true });
    api.deleteCatalog = plain;
    take();
    assert.equal(catalogManager.getCatalog('user_glass'), null, 'catalog: the catalog does not come back');
    const notice = events.filter(event => event.type === 'catalogs-changed').at(-1);
    assert.deepEqual(Object.keys(notice?.detail?.removed || {}), ['user_glass:N'],
        'catalog: and an open design using a material it took meanwhile keeps that material');
}

// The Coating Library asks with the confirm its delete uses.
{
    DesignContext.value = makeDesignCtx(makeSampleDesign());
    coatingLibrarySession.reset();
    coatingLibrarySession.write(null, { source: 'user', selectedId: 'user-bbar-vis' });
    R.unmount();
    const library = () => R.run(() => useCoatingLibrary(t.coatingLibrary, t));
    library();
    await settle();
    assert.equal(library().selected?.name, 'BBAR vis', 'coating: the saved coating is selected');

    answers.push(true, false);
    await library().remove();
    assert.deepEqual(asked.splice(0), [t.coatingLibrary.confirmDelete('BBAR vis'), noBin.one('BBAR vis')],
        'coating: a coating the bin refuses is asked about by name');
    assert.deepEqual(take(), ['coating BBAR vis'], 'coating: and on no nothing more is sent');

    answers.push(true, true);
    await library().remove();
    asked.length = 0;
    assert.deepEqual(take(), ['coating BBAR vis', 'coating BBAR vis for good'], 'coating: on yes it is deleted for good');
    coatingLibrarySession.reset();
}

// The Merit Function Editor asks in the app's confirm dialog, as its delete does.
{
    let dialog = null;
    const presets = () => R.run(() => useMeritPresets({
        operands: [], design: { name: 'Design1' },
        te: t.meritFunctionEditor, t, setInputDialog: (next) => { dialog = next; },
        setOperands: () => {}, setSelectedId: () => {}, checkpoint: () => {},
    }));
    R.unmount();
    const deleteArMf = async () => {
        presets().onDeleteDiskPreset('AR MF');
        dialog.onConfirm();
        await settle();
    };

    await deleteArMf();
    assert.equal(dialog?.title, noBin.one('AR MF'), 'merit: a preset the bin refuses is asked about by name');
    assert.equal(dialog.confirmLabel, t.explorer.delete, 'merit: with Delete');
    dialog.onCancel();
    assert.deepEqual(take(), ['merit AR MF'], 'merit: and on Cancel nothing more is sent');

    await deleteArMf();
    dialog.onConfirm();
    await settle();
    assert.deepEqual(take(), ['merit AR MF', 'merit AR MF for good'], 'merit: on Delete it is deleted for good');
}

// The Specification window asks with the confirm its delete uses.
{
    const presets = () => R.run(() => useDiskPresets({
        qualifiers: [], writeQualifiers: () => {}, checkpoint: () => {},
        design: { name: 'Design1' }, ts: t.specification, t, setInputDialog: () => {},
    }));
    R.unmount();

    answers.push(true, false);
    await presets().onDeleteDiskPreset('AR spec');
    assert.deepEqual(asked.splice(0), [`${t.specification.confirmDelete} "AR spec"?`, noBin.one('AR spec')],
        'spec: a preset the bin refuses is asked about by name');
    assert.deepEqual(take(), ['spec AR spec'], 'spec: and on no nothing more is sent');

    answers.push(true, true);
    await presets().onDeleteDiskPreset('AR spec');
    asked.length = 0;
    assert.deepEqual(take(), ['spec AR spec', 'spec AR spec for good'], 'spec: on yes it is deleted for good');
}

console.log('deletes_to_recycle_bin: passed');
