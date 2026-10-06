/**
 * The project tree and saves, as the renderer drives the main process.
 *
 *   1. The tree is loaded with the recorded place of each design's file, and
 *      records it again once loaded, so a copy made outside the app is the one
 *      renumbered, never the original.
 *   2. Files the loader could not read are named in a notice, and their names
 *      stay taken: a new design is never proposed under one.
 *   3. Running from the default folder because the chosen one is unusable
 *      (a drive not plugged in) neither drops the session's working copies of
 *      the designs on that drive nor overwrites the record of where files are.
 *   4. A save checks the file's time; when the file changed on disk since it
 *      was read, the user is asked, and only Overwrite writes over it.
 *   5. Two saves of one design started together write one after the other,
 *      and a save that changes no material copy keeps the design object.
 *   6. A rename sends the row's time, and a selection made before it deletes
 *      the renamed file.
 *   7. The names of unreadable files follow their folder when it is renamed.
 *   8. A write answered without the file's time leaves the next save
 *      unchecked, as the main process documents.
 *
 * Run: node tests/design_files_wiring.mjs
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
const { writeSessionEntry } = await import('../src/utils/io/appSession.js');
const { designFingerprint } = await import('../src/utils/io/projectPersistence.js');

const t = new Proxy({}, { get: (_, ns) => new Proxy({}, { get: (__, key) => (key === 'changedOnDisk'
    ? { title: 'changed', message: name => `changed ${name}`, overwrite: 'Overwrite' }
    : (...args) => `${ns}.${String(key)}(${args.join('|')})`) }) });

const design = (id, name) => ({
    id, name, incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [{ id: `${id}-l`, material: 'builtin:SiO2', thickness: 100 }], backLayers: [],
});

const ENTRY = id => `tfstudio-session-v4:${id}`;

// A fresh mount of the store and the tree over `disk`.
async function start(disk) {
    rt.reset();
    let dialog = null;
    const notes = [];
    let store, project;
    const render = () => {
        const out = rt.render(() => {
            const st = useDesignStore({});
            const pr = useProjectTree({
                store: st, openTool() {}, onRestoreLayout() {},
                setInputDialog: d => { dialog = d; }, setMessageNotification: n => notes.push(n), t,
            });
            return { st, pr };
        });
        for (const effect of rt.pendingEffects()) effect();
        ({ st: store, pr: project } = out);
    };
    globalThis.electronAPI = disk;
    render();
    await new Promise(resolve => setTimeout(resolve, 0));
    render();
    return { render, get store() { return store; }, get project() { return project; }, notes, get dialog() { return dialog; } };
}

// ── 1 to 3. Loading ──────────────────────────────────────────────────────────
const D1 = design('d1', 'D1');
const asked = [];
const loaded = (extra = {}) => ({
    success: true, unreadable: 0,
    folders: [{ id: 'P', name: 'P', items: [{ id: 'd1', name: 'D1', mtime: 1000, design: D1 }] }],
    ...extra,
});
storage.set('tfstudio:design-locations', JSON.stringify({ d1: 'P/D1.tfs' }));
writeSessionEntry('gone', { design: design('gone', 'On the drive'), history: { past: [], future: [] }, base: designFingerprint(design('gone', 'On the drive')) });

{
    const app = await start({
        loadFolders: async lastSeen => { asked.push(lastSeen); return loaded({ unreadable: 1, unreadFiles: ['P/Broken.tfs'] }); },
    });
    assert.deepEqual(asked[0], { d1: 'P/D1.tfs' }, 'the tree is read with the recorded places');
    assert.ok(app.notes.some(n => n.message === 'dialogs.unreadDesignFiles(P/Broken.tfs)'), 'unreadable files are named');
}

// New Design proposes the next free name, which must skip the name of a file
// that could not be read: writing it would be refused, the file being another's.
{
    const written = [];
    const app = await start({
        loadFolders: async () => loaded({ unreadable: 1, unreadFiles: ['P/Design 2.tfs'] }),
        saveDesign: async (folderId, d) => { written.push(d.name); return { success: true, mtime: 5000 }; },
        createFolder: async () => ({ success: true }),
    });
    app.project.setSelectedFolder({ id: 'P', name: 'P' });
    app.render();
    await app.project.addItem({ id: 'P', name: 'P' });
    assert.deepEqual(written, ['Design 3'], 'a new design skips the name of the file that could not be read');
}

{
    const app = await start({ loadFolders: async () => loaded() });
    app.render();
    assert.deepEqual(JSON.parse(storage.get('tfstudio:design-locations')), { d1: 'P/D1.tfs' }, 'the places are recorded again');
    assert.equal(storage.has(ENTRY('gone')), false,
        'a complete read of the real folder drops the entry of a design that is gone');
}

{
    writeSessionEntry('gone', { design: design('gone', 'On the drive'), history: { past: [], future: [] }, base: designFingerprint(design('gone', 'On the drive')) });
    storage.set('tfstudio:design-locations', JSON.stringify({ gone: 'Drive/On the drive.tfs' }));
    const app = await start({ loadFolders: async () => loaded({ fallback: true }) });
    app.render();
    assert.ok(storage.has(ENTRY('gone')), 'running from the default folder keeps the drive\'s working copies');
    assert.deepEqual(JSON.parse(storage.get('tfstudio:design-locations')), { gone: 'Drive/On the drive.tfs' },
        'and leaves the record of where files are alone');
}

// ── 4. A save over a file that changed on disk asks first ───────────────────
{
    const calls = [];
    let changed = true;
    const app = await start({
        loadFolders: async () => loaded(),
        saveDesign: async (folderId, d, expectedMtime) => {
            calls.push(expectedMtime);
            if (changed && expectedMtime !== undefined) return { success: false, error: 'changed-on-disk', mtime: 2000 };
            return { success: true, mtime: 3000 };
        },
    });
    app.store.setActiveDesignId('d1');
    app.render();
    const first = await app.project.saveDesignToDisk('d1');
    assert.equal(first, false, 'the save is refused');
    assert.equal(calls[0], 1000, 'it was sent with the time the file had when it was read');
    assert.equal(app.notes.some(n => n.type === 'error'), false, 'no error is shown');
    assert.equal(app.dialog?.confirmLabel, 'Overwrite', 'the user is asked instead');
    app.dialog.onConfirm();
    await new Promise(resolve => setTimeout(resolve, 0));
    app.render();
    assert.deepEqual(calls, [1000, undefined], 'Overwrite writes without the check');
    changed = false;
    await app.project.saveDesignToDisk('d1');
    assert.equal(calls.at(-1), 3000, 'and the next save checks against the time of that write');
}

// ── 5. Two saves of one design started together ─────────────────────────────
// A second Ctrl+S while the first is still writing waits for it, and is checked
// against the time that write left rather than the one the file was read with.
{
    const calls = [];
    let diskTime = 1000;
    const app = await start({
        loadFolders: async () => loaded(),
        saveDesign: async (folderId, d, expectedMtime) => {
            calls.push(expectedMtime);
            await new Promise(resolve => setTimeout(resolve, 5));
            if (expectedMtime !== undefined && expectedMtime !== diskTime) {
                return { success: false, error: 'changed-on-disk', mtime: diskTime };
            }
            diskTime += 1000;
            return { success: true, mtime: diskTime };
        },
    });
    const before = app.store.designs.d1;
    const results = await Promise.all([app.project.saveDesignToDisk('d1'), app.project.saveDesignToDisk('d1')]);
    app.render();
    assert.deepEqual(results, [true, true], 'both saves write');
    assert.deepEqual(calls, [1000, 2000], 'the second is checked against the time the first left');
    assert.equal(app.dialog, null, 'nobody is asked about a file changed on disk');
    assert.equal(app.store.designs.d1, before,
        'a save that changes no material copy leaves the design object as it was');
}

// ── 6. A rename hands the row's time on and renames the selection too ──────
{
    const renames = [];
    const deletes = [];
    const D2 = design('d2', 'D2');
    const app = await start({
        loadFolders: async () => ({
            success: true, unreadable: 0,
            folders: [{ id: 'P', name: 'P', items: [
                { id: 'd1', name: 'D1', mtime: 1000, design: D1 },
                { id: 'd2', name: 'D2', mtime: 1000, design: D2 },
            ] }],
        }),
        renameItem: async (...args) => { renames.push(args); return { success: true, mtime: 1500 }; },
        deleteItem: async (...args) => { deletes.push(args); return { success: true }; },
    });
    const folder = app.project.folders[0];
    app.project.handleItemClick(folder.items[0], folder, {});
    app.render();
    app.project.handleItemClick(folder.items[1], folder, { ctrlKey: true });
    app.render();
    await app.project.renameItem('P', 'd1', 'D1 final');
    app.render();
    assert.deepEqual(renames[0], ['P', 'D1', 'D1 final', 'd1', 1000], 'the rename is checked against the row\'s time');
    assert.deepEqual(app.project.selectedItems.map(i => i.name), ['D1 final', 'D2'], 'the selection has the new name');
    await app.project.removeSelectedItems(app.project.selectedItems.slice());
    assert.deepEqual(deletes.map(d => d[1]), ['D1 final', 'D2'], 'so a delete of the selection deletes the renamed file');
}

// ── 7. Unreadable files move with their folder ──────────────────────────────
{
    const written = [];
    const app = await start({
        loadFolders: async () => loaded({ unreadable: 1, unreadFiles: ['P/Design 2.tfs'] }),
        renameFolder: async () => ({ success: true }),
        saveDesign: async (folderId, d) => { written.push(`${folderId}/${d.name}`); return { success: true, mtime: 5000 }; },
    });
    await app.project.renameFolder('P', 'Q');
    app.render();
    await app.project.addItem({ id: 'Q', name: 'Q' });
    assert.deepEqual(written, ['Q/Design 3'], 'after a rename, a new design still skips the unreadable file\'s name');
}

// A folder deleted whole takes its unreadable files along, so a folder made
// again under its name starts from Design 1.
{
    const written = [];
    const app = await start({
        loadFolders: async () => ({
            success: true, unreadable: 1, unreadFiles: ['C/Design 1.tfs'],
            folders: [loaded().folders[0], { id: 'C', name: 'C', items: [] }],
        }),
        deleteFolder: async () => ({ success: true }),
        createFolder: async () => ({ success: true }),
        saveDesign: async (folderId, d) => { written.push(`${folderId}/${d.name}`); return { success: true, mtime: 5000 }; },
    });
    await app.project.removeFolder('C');
    app.render();
    app.project.addFolder();
    await app.dialog.onConfirm('C');
    app.render();
    await app.project.addItem({ id: 'C', name: 'C' });
    assert.deepEqual(written, ['C/Design 1'], 'the unreadable file\'s name is free again');
}

// ── 8. A write answered without the file's time ─────────────────────────────
// The main process could not read the time back; the next save writes without
// the check rather than being refused as changed on disk.
{
    const calls = [];
    const app = await start({
        loadFolders: async () => loaded(),
        saveDesign: async (folderId, d, expectedMtime) => { calls.push(expectedMtime); return { success: true }; },
    });
    await app.project.saveDesignToDisk('d1');
    await app.project.saveDesignToDisk('d1');
    assert.deepEqual(calls, [1000, undefined], 'the second save is sent without a time');
}

console.log('PASS: design_files_wiring');
