/**
 * Refresh all reads the Projects folder again with the app running.
 *
 *   1. A design file added outside the app joins the tree, a deleted one leaves
 *      it and the windows showing it, and a clean design whose file changed
 *      takes the file. Unsaved edits on an unchanged file stay, with their ●
 *      and undo history. The selection, the active design and the folders left
 *      closed stay as they were.
 *   2. Unsaved edits whose file was saved since lose to the file, as at
 *      startup: a notice names the design and Ctrl+Z brings the edits back.
 *   3. A design whose file is unchanged keeps its object, so the windows
 *      showing it have nothing to recompute.
 *   4. A read that missed files keeps the designs it did not find, and a read
 *      that failed changes nothing.
 *   5. Deleting the active design's file clears the active design.
 *
 * Run: node tests/project_refresh_all.mjs
 */
import assert from 'node:assert/strict';
import { makeHookRuntime } from './_hookHarness.mjs';

const events = new EventTarget();
const storage = new Map();
globalThis.window = globalThis;
globalThis.addEventListener = events.addEventListener.bind(events);
globalThis.removeEventListener = events.removeEventListener.bind(events);
globalThis.dispatchEvent = events.dispatchEvent.bind(events);
globalThis.localStorage = {
    get length() { return storage.size; },
    key: i => [...storage.keys()][i] ?? null,
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
    clear: () => storage.clear(),
};

const rt = makeHookRuntime();
Object.assign(rt.React, { createContext: () => ({ Provider: 'Provider' }), useContext: () => null, createElement: () => null });
globalThis.React = rt.React;
const { useDesignStore } = await import('../src/hooks/useDesignStore.js');
const { useProjectTree } = await import('../src/hooks/useProjectTree.js');

const t = new Proxy({}, { get: (_, ns) => new Proxy({}, { get: (__, key) => (...args) => `${ns}.${String(key)}(${args.join('|')})` }) });

const design = (id, name, thickness = 100) => ({
    id, name, incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [{ id: `${id}-l`, material: 'builtin:SiO2', thickness }], backLayers: [],
});
const thickness = d => d.frontLayers[0].thickness;

// The Projects folder as the main process reports it. Each call reads `disk`
// as it is at that moment.
let disk;
let failRead = false;
const listing = () => (failRead ? { success: false } : {
    success: true, unreadable: disk.unreadFiles.length, unreadFiles: disk.unreadFiles,
    folders: Object.entries(disk.folders).map(([id, items]) => ({
        id, name: id, expanded: true,
        items: items.map(d => ({ id: d.id, name: d.name, mtime: 1000, design: structuredClone(d) })),
    })),
});

const evicted = [];
globalThis.addEventListener('tfstudio:design-evict', event => evicted.push(event.detail.id));

let reads = 0;

// Mount the store and the tree over `disk`. With `settle` false the startup
// read is left running.
async function start({ settle = true } = {}) {
    rt.reset();
    storage.clear();
    evicted.length = 0;
    const notes = [];
    let store, project;
    const render = () => {
        const out = rt.render(() => {
            const st = useDesignStore({});
            const pr = useProjectTree({
                store: st, openTool() {}, onRestoreLayout() {},
                setInputDialog() {}, setMessageNotification: n => notes.push(n), t,
            });
            return { st, pr };
        });
        for (const effect of rt.pendingEffects()) effect();
        ({ st: store, pr: project } = out);
    };
    globalThis.electronAPI = {
        loadFolders: async () => { reads += 1; return listing(); },
        createFolder: async () => ({ success: true }),
    };
    render();
    if (settle) {
        await new Promise(resolve => setTimeout(resolve, 0));
        render();
    }
    // The catalogs reload between the read and the merge; `onCatalogs` sees the
    // store as it stands at that moment.
    let onCatalogs = () => {};
    let changed = null;
    const refresh = async () => {
        changed = await project.refreshFoldersFromDisk(async () => { render(); onCatalogs(); });
        render();
    };
    const select = id => {
        const folder = project.folders.find(f => f.items.some(item => item.id === id));
        project.handleItemClick(folder.items.find(item => item.id === id), folder, {});
        // The click selects; the effect the selection runs then activates.
        render();
        render();
    };
    const edit = (id, nm) => {
        store.handleDesignChange(id, { ...store.designs[id], frontLayers: [{ ...store.designs[id].frontLayers[0], thickness: nm }] });
        render();
    };
    return {
        render, refresh, select, edit, notes,
        set onCatalogs(fn) { onCatalogs = fn; }, get changed() { return changed; },
        get store() { return store; }, get project() { return project; },
        rows: folderId => project.folders.find(f => f.id === folderId).items.map(item => item.id),
    };
}

// ── 1. Added, deleted, changed and edited designs ───────────────────────────
{
    disk = { unreadFiles: [], folders: { P: [design('d1', 'D1'), design('d2', 'D2'), design('d3', 'D3')], Q: [] } };
    const app = await start();
    app.select('d1');
    app.edit('d2', 120);
    app.project.toggleFolderExpanded('Q');
    app.render();
    assert.equal(app.store.dirtyDesigns.d2, true, 'the edit is unsaved before the refresh');

    disk.folders.P = [design('d1', 'D1', 150), design('d2', 'D2'), design('d4', 'D4')];
    let atCatalogs = null;
    app.onCatalogs = () => { atCatalogs = { d1: thickness(app.store.designs.d1), rows: app.rows('P') }; };
    await app.refresh();
    app.onCatalogs = () => {};
    assert.deepEqual(atCatalogs, { d1: 100, rows: ['d1', 'd2', 'd3'] },
        'nothing read is applied before the catalogs reload, so the windows render once with both');
    assert.deepEqual(app.changed, ['d1'],
        'the designs in memory the refresh changed are named, so they count as edited');

    assert.deepEqual(app.rows('P'), ['d1', 'd2', 'd4'], 'the new file joins the tree and the deleted one leaves it');
    assert.equal(app.store.designs.d4.name, 'D4', 'the new design is in the store');
    assert.equal(app.store.designs.d3, undefined, 'the deleted design leaves the store');
    assert.deepEqual(evicted, ['d3'], 'and the windows showing it are told to let go');
    assert.equal(thickness(app.store.designs.d1), 150, 'a clean design takes its changed file');
    assert.equal(!!app.store.dirtyDesigns.d1, false, 'and is not marked unsaved');
    assert.equal(thickness(app.store.designs.d2), 120, 'unsaved edits on an unchanged file stay');
    assert.equal(app.store.dirtyDesigns.d2, true, 'with their unsaved mark');
    assert.equal(app.store.historyRef.current.d2.past.length, 1, 'and their undo history');
    assert.equal(app.project.selectedItem.id, 'd1', 'the selection stays');
    assert.equal(app.store.activeDesignId, 'd1', 'and so does the active design');
    assert.equal(app.project.folders.find(f => f.id === 'Q').expanded, false, 'a folder left closed stays closed');
    assert.equal(app.notes.length, 0, 'nothing needed saying');

    // ── 2. Unsaved edits whose file was saved since ──────────────────────────
    disk.folders.P = [design('d1', 'D1', 150), design('d2', 'D2', 200), design('d4', 'D4')];
    await app.refresh();
    assert.equal(thickness(app.store.designs.d2), 200, 'a file saved since wins over the unsaved edits');
    assert.equal(!!app.store.dirtyDesigns.d2, false, 'which leaves nothing unsaved');
    assert.equal(thickness(app.store.historyRef.current.d2.past.at(-1)), 120, 'the edits are one Ctrl+Z back');
    assert.deepEqual(app.notes.map(n => n.message), ['dialogs.savedElsewhere(D2)'], 'and a notice names the design');

    // ── 3. Nothing changed on disk ───────────────────────────────────────────
    const before = { ...app.store.designs };
    await app.refresh();
    for (const id of ['d1', 'd2', 'd4']) {
        assert.equal(app.store.designs[id], before[id], `${id} keeps its object when its file is unchanged`);
    }

    // ── 4. A read that missed files, and one that failed ─────────────────────
    app.edit('d4', 130);
    disk.folders.P = [design('d1', 'D1', 150), design('d2', 'D2', 200)];
    disk.unreadFiles = ['P/D4.tfs'];
    await app.refresh();
    assert.deepEqual(app.rows('P'), ['d1', 'd2'], 'the tree shows what was read');
    assert.equal(thickness(app.store.designs.d4), 130, 'a design not found by an incomplete read stays in memory');
    assert.equal(evicted.includes('d4'), false, 'and its windows keep it');
    assert.ok(app.notes.some(n => n.message === 'dialogs.unreadDesignFiles(P/D4.tfs)'), 'the unread file is named');

    disk.folders.P = [design('d1', 'D1', 150), design('d2', 'D2', 200), design('d4', 'D4')];
    disk.unreadFiles = [];
    await app.refresh();
    assert.deepEqual(app.rows('P'), ['d1', 'd2', 'd4'], 'the file read again brings the design back');
    assert.equal(thickness(app.store.designs.d4), 130, 'with the unsaved edits it had in memory');
    assert.equal(app.store.dirtyDesigns.d4, true, 'still marked unsaved');

    const folders = app.project.folders;
    failRead = true;
    await app.refresh();
    failRead = false;
    assert.equal(app.project.folders, folders, 'a read that failed changes nothing');
}

// ── 5. The active design's file deleted ─────────────────────────────────────
{
    disk = { unreadFiles: [], folders: { P: [design('d1', 'D1'), design('d2', 'D2')] } };
    const app = await start();
    app.select('d2');
    assert.equal(app.store.activeDesignId, 'd2');
    disk.folders.P = [design('d1', 'D1')];
    await app.refresh();
    assert.equal(app.store.activeDesignId, null, 'the active design goes with its file');
    assert.equal(app.project.selectedItem, null, 'and so does the selection');
}

// ── 6. A file renamed outside the app ───────────────────────────────────────
// The working copy keeps its edits and takes the file's name, so a save writes
// the renamed file instead of a second file under the old name.
{
    disk = { unreadFiles: [], folders: { P: [design('d1', 'D1')] } };
    const app = await start();
    app.edit('d1', 140);
    disk.folders.P = [design('d1', 'Renamed')];
    await app.refresh();
    assert.equal(app.store.designs.d1.name, 'Renamed', 'the design takes the new file name');
    assert.equal(thickness(app.store.designs.d1), 140, 'and keeps its unsaved edits');
    assert.equal(app.project.folders[0].items[0].name, 'Renamed', 'the row shows the new name');
}

// ── 7. Refresh all before the tree has been read ────────────────────────────
// The designs in memory are not yet the ones the startup read will show, so a
// refresh then would take every working copy for a design without one.
{
    disk = { unreadFiles: [], folders: { P: [design('d1', 'D1')] } };
    reads = 0;
    const app = await start({ settle: false });
    let reloaded = false;
    assert.equal(await app.project.refreshFoldersFromDisk(async () => { reloaded = true; }), null,
        'the refresh says it did not run');
    assert.equal(reloaded, false, 'and leaves the catalogs to the startup load');
    assert.equal(reads, 1, 'only the startup read runs');
    await new Promise(resolve => setTimeout(resolve, 0));
    app.render();
    assert.deepEqual(app.rows('P'), ['d1'], 'and the tree loads as usual');
}

console.log('PASS project_refresh_all');
