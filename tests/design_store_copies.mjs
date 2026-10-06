/**
 * The design store: undo past a rename, and the material copies an open design
 * keeps.
 *
 *   1. Undo, redo and a History jump keep the name the file has now, so the
 *      next Ctrl+S after undoing past an explorer rename writes the design
 *      under the file's name.
 *   2. A save puts the material copies it wrote onto the design in memory too,
 *      so deleting the catalog in the same session leaves the open design its
 *      material, and the next save writes the copy again.
 *   3. Deleting a catalog leaves every open design that uses one of its
 *      materials with the deleted definition as its own copy, unless its copy
 *      came from another catalog, and keeps that copy in the session until the
 *      next save.
 *   4. A session written before working copies kept copies gets the file's.
 *   5. Edits reach the session within 2 s while changes keep coming, and at
 *      once when the window closes.
 *
 * Run: node tests/design_store_copies.mjs
 */
import assert from 'node:assert/strict';
import { makeHookRuntime } from './_hookHarness.mjs';

// Window events that are delivered, a session store, and a disk that records
// what it is asked to write.
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
const written = [];
globalThis.electronAPI = {
    saveDesign: async (folderId, design) => { written.push(design); return { success: true }; },
    renameItem: async () => ({ success: true }),
    saveCatalog: async () => ({ success: true }),
    deleteCatalog: async () => ({ success: true }),
};

const rt = makeHookRuntime();
Object.assign(rt.React, { createContext: () => ({ Provider: 'Provider' }), useContext: () => null, createElement: () => null });
globalThis.React = rt.React;
const { useDesignStore } = await import('../src/hooks/useDesignStore.js');
const { useDesignActions } = await import('../src/hooks/useDesignActions.js');
const { persistThenCommit } = await import('../src/utils/io/projectPersistence.js');
const { sessionEntryFor, mergeSessionOverDisk } = await import('../src/utils/io/sessionMerge.js');
const { designFingerprint } = await import('../src/utils/io/projectPersistence.js');
const { initCatalogs, removeCatalog } = await import('../src/utils/materials/catalogManager.js');
const { resolveDesignMaterial } = await import('../src/utils/materials/designMaterials.js');

const H = { id: 'H', name: 'H', formulaNum: -1, tabData: [[300, 2.3, 0], [2000, 2.3, 0]] };
initCatalogs({ user_lab: { id: 'user_lab', uid: 'stamp-lab', name: 'Lab', source: 'user', materials: { H: { ...H } } } });

const F = 'My Designs';
let folders = [];
const foldersRef = { current: folders };
const setFolders = u => { folders = typeof u === 'function' ? u(folders) : u; foldersRef.current = folders; };
const persistChange = async (op, commit) => (await persistThenCommit(op, commit)).success;
const t = { dialogs: { persistenceFailed: 'x', saveAs: { saveFailed: 'x', exists: 'x', empty: 'x' } } };
let store, actions;
function render() {
    const result = rt.render(() => {
        const st = useDesignStore({});
        const tree = {
            foldersRef, setFolders, selectedFolder: folders[0] || null, setSelectedItem: () => {}, setSelectedItems: () => {},
            existingDesignNames: id => folders.find(f => f.id === id).items.map(i => i.name), commitNewDesign: () => {},
        };
        return { st, act: useDesignActions({ store: st, tree, persistChange, setInputDialog: () => {}, setMessageNotification: () => {}, t }) };
    });
    for (const effect of rt.pendingEffects()) effect();
    store = result.st;
    actions = result.act;
}
const design = (id, name, material) => ({
    id, name, incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [{ id: `${id}-l1`, material, thickness: 100 }], backLayers: [],
});
const open = list => {
    setFolders([{ id: F, name: F, items: list.map(d => ({ id: d.id, name: d.name })) }]);
    store.diskDesignsRef.current = Object.fromEntries(list.map(d => [d.id, d]));
    store.setDesigns(Object.fromEntries(list.map(d => [d.id, d])));
    render();
};
const current = id => store.designsRef.current[id];

// ── 1. Undo past a rename keeps the name ─────────────────────────────────────
render();
open([design('d1', 'D1', 'builtin:SiO2')]);
store.setActiveDesignId('d1');
render();
store.handleDesignChange('d1', { ...current('d1'), frontLayers: [{ ...current('d1').frontLayers[0], thickness: 120 }] });
render();
await actions.renameItem(F, 'd1', 'D1 final');
render();
store.undo();
render();
assert.equal(current('d1').frontLayers[0].thickness, 100, 'undo takes the edit back');
assert.equal(current('d1').name, 'D1 final', 'and keeps the name the file has now');
store.redo();
render();
assert.equal(current('d1').name, 'D1 final', 'so does redo');
await actions.saveDesignToDisk('d1');
assert.equal(written.at(-1).name, 'D1 final', 'Ctrl+S writes the design under its current name');

// ── 2. A save leaves its material copies on the design in memory ─────────────
open([design('e', 'E', 'user_lab:H')]);
await actions.saveDesignToDisk('e');
render();
assert.equal(written.at(-1).materials['user_lab:H'].catalogUid, 'stamp-lab', 'the file gets the copy with its catalog stamp');
assert.deepEqual(current('e').materials, written.at(-1).materials, 'and so does the design in memory');
assert.deepEqual(store.diskDesignsRef.current.e.materials, written.at(-1).materials, 'and the disk baseline');
assert.equal(store.dirtyDesigns.e, undefined, 'which does not read as an unsaved edit');

// ── 3. Deleting a catalog leaves open designs their copies ───────────────────
const unsaved = design('f', 'F', 'user_lab:H');                       // never saved, no copy
const foreign = { ...design('g', 'G', 'user_lab:H'),                  // a copy from another catalog
    materials: { 'user_lab:H': { ...H, tabData: [[300, 1.9, 0], [2000, 1.9, 0]], catalogUid: 'stamp-elsewhere' } } };
store.setDesigns(prev => ({ ...prev, f: unsaved, g: foreign }));
render();
removeCatalog('user_lab');
render();
assert.equal(resolveDesignMaterial(current('f'), 'user_lab:H').status, 'embedded',
    'a design that used the deleted catalog keeps its material');
assert.equal(resolveDesignMaterial(current('f'), 'user_lab:H').material.getNK(550)[0], 2.3, 'as it was in the catalog');
assert.equal(current('g'), foreign, 'a design whose copy came from another catalog is left as it was');
assert.ok(sessionEntryFor(current('f'), null, unsaved), 'the kept copy goes into the session');
assert.equal(sessionEntryFor(unsaved, null, unsaved), null, 'while a design with nothing to keep has no entry');
await actions.saveDesignToDisk('e');
assert.ok(written.at(-1).materials['user_lab:H'], 'a saved design still writes its copy after the delete');

// ── 4. An old session gets its file's copies ─────────────────────────────────
const onDisk = { ...design('h', 'Hd', 'user_lab:H'), materials: { 'user_lab:H': { ...H, catalogUid: 'stamp-lab' } } };
const oldEntry = { design: design('h', 'Hd', 'user_lab:H'), history: { past: [], future: [] }, base: designFingerprint(onDisk) };
const merged = mergeSessionOverDisk({ h: onDisk }, { h: oldEntry }).initialDesigns.h;
assert.deepEqual(merged.materials, onDisk.materials, 'the working copy from an old session carries the file\'s copies');

// ── 5. Edits reach the session even while changes keep coming ───────────────
// A running optimizer streams previews faster than the half-second wait, so the
// wait alone would hold the session back until it stopped, or for good if the
// app closed first.
{
    const edited = id => [...storage.keys()].some(key => key.endsWith(id));
    open([design('s1', 'S1', 'builtin:SiO2')]);
    store.setActiveDesignId('s1');
    render();
    const started = Date.now();
    let step = 0;
    while (!edited('s1') && Date.now() - started < 4000) {
        step++;
        store.handleDesignChange('s1', { ...current('s1'), frontLayers: [{ ...current('s1').frontLayers[0], thickness: 100 + step }] },
            { transient: true });
        render();
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    const waited = Date.now() - started;
    assert.ok(edited('s1') && waited < 3000, `a stream of changes is written within 2 s (took ${waited} ms)`);

    open([design('s2', 'S2', 'builtin:SiO2')]);
    store.handleDesignChange('s2', { ...current('s2'), frontLayers: [] });
    render();
    assert.ok(!edited('s2'), 'a fresh edit waits for the debounce');
    globalThis.dispatchEvent(new Event('pagehide'));
    assert.ok(edited('s2'), 'closing the window writes it at once');
}

// ── 6. A copy from another computer with this catalog's n,k ─────────────────
// It is this catalog's material, so it takes this catalog's stamp when the
// catalogs load, and the design follows a later edit of it.
{
    const { saveUserMaterial } = await import('../src/utils/materials/catalogManager.js');
    initCatalogs({ user_lab: { id: 'user_lab', uid: 'stamp-lab', name: 'Lab', source: 'user', materials: { H: { ...H } } } });
    const received = { ...design('r', 'R', 'user_lab:H'), materials: { 'user_lab:H': { ...H, catalogUid: 'stamp-elsewhere' } } };
    const stored = () => [...storage.keys()].some(key => key.endsWith(':r'));
    open([received]);
    globalThis.dispatchEvent(new CustomEvent('catalogs-loaded'));
    render();
    assert.equal(current('r').materials['user_lab:H'].catalogUid, 'stamp-lab', 'the copy takes this catalog\'s stamp');
    assert.equal(store.dirtyDesigns.r, undefined, 'which is not an unsaved edit');
    store.flushSession();
    assert.equal(stored(), false, 'nor a session entry: the next load stamps it again from the file');
    saveUserMaterial('user_lab', { ...H, tabData: [[300, 2.1, 0], [2000, 2.1, 0]] });
    render();
    const resolved = resolveDesignMaterial(current('r'), 'user_lab:H');
    assert.equal(resolved.status, 'catalog', 'after an edit of the catalog the design still follows it');
    assert.equal(resolved.material.getNK(550)[0], 2.1, 'with the edited n,k');
    store.flushSession();
    assert.equal(stored(), true, 'and the session keeps the stamp, which its file alone would no longer give');
}

console.log('PASS: design_store_copies');
