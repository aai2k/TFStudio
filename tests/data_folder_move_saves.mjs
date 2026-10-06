/**
 * Moving the data folder saves the unsaved designs first.
 *
 * A move reloads every design from the new folder without its unsaved copy, so
 * Browse and Reset write the unsaved designs to their files before moving.
 *
 *   1. Browse and Reset say in their confirm how many unsaved designs will be
 *      saved, save them once confirmed, and only then move.
 *   2. The count is taken once the folder is chosen, and the save runs
 *      whatever it was: a design an optimizer changes while the chooser is
 *      open is saved too.
 *   3. Cancel saves nothing and moves nothing, from Browse and from Reset.
 *   4. A design that cannot be saved stops the move, from Browse and from
 *      Reset, and the pane names it.
 *   5. The buttons are disabled from the confirm on, while the designs save.
 *   6. The save-all, through the real persistence hook, writes each unsaved
 *      design in a project folder to its own file, one after another, names
 *      the ones it could not write (a refused write and one that throws), and
 *      leaves a design that sits in no folder out of the count and the save.
 *
 * Run: node tests/data_folder_move_saves.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
await loadApp();
const t = makeLocale();
const fl = t.settings.folders;

const runtime = makeHookRuntime();
Object.assign(runtime.React, { createElement: React.createElement, Fragment: React.Fragment });
const { FoldersPane } = await importWithHookRuntime(
    '../src/components/dialogs/settings/FoldersPane.js', runtime);
const { FolderRow } = await import('../src/components/dialogs/settings/FolderRow.js');

const find = (node, match) => {
    if (Array.isArray(node)) {
        for (const child of node) { const hit = find(child, match); if (hit) return hit; }
        return null;
    }
    if (!node || typeof node !== 'object' || !node.props) return null;
    return match(node) ? node : find(node.props.children, match);
};
const textOf = node => (typeof node === 'string' ? node
    : Array.isArray(node) ? node.map(textOf).join('')
        : node?.props ? textOf(node.props.children) : '');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

const folders = { root: 'C:/TFStudio', defaultRoot: 'C:/Default', overridden: true, subfolders: [] };

// The disk, as a stand-in that logs the moves it is asked for. `onChoose`
// runs while the folder chooser is open.
function stubDisk(log, state, onChoose) {
    return {
        listUserPaths: async () => ({ success: true, folders }),
        chooseUserPath: async () => { onChoose?.(state); return { path: 'D:/New' }; },
        setUserPath: async path => { log.push(`move ${path}`); return { success: true, folders }; },
        resetUserPath: async () => { log.push('reset'); return { success: true, folders }; },
    };
}

// The pane's props: its confirm and the save-all as stand-ins that log what
// they were asked to do. `state.unsaved` is what the count returns when asked.
function paneProps(log, state, { answer, failed, saveGate }) {
    return {
        c: makeTheme(), t,
        countUnsavedDesigns: () => state.unsaved,
        saveUnsavedDesigns: async () => {
            log.push('save');
            if (saveGate) await saveGate;
            return failed;
        },
        showConfirm: async message => { log.push(`confirm ${message}`); return answer; },
        onUserPathChanged: async () => { log.push('reload'); },
    };
}

// The pane mounted once over those stand-ins, logging in order.
async function pane({ unsaved, answer = true, failed = [], saveGate = null, onChoose = null }) {
    const log = [];
    const state = { unsaved };
    globalThis.window.electronAPI = stubDisk(log, state, onChoose);
    const props = paneProps(log, state, { answer, failed, saveGate });
    const render = () => runtime.render(() => FoldersPane(props));
    render();
    for (const effect of runtime.pendingEffects()) effect();
    await tick();
    const row = () => find(render(), node => node.type === FolderRow);
    return {
        log, state, row,
        browse: () => row().props.onBrowse(),
        reset: () => row().props.onReset(),
        shown: () => textOf(render()),
    };
}

// ── 1. Browse and Reset save the unsaved designs, then move ──────────────────
{
    const p = await pane({ unsaved: 3 });
    await p.browse();
    assert.deepEqual(p.log, [
        `confirm ${fl.unsavedSavedFirst(fl.confirmMove('D:/New'), 3)}`,
        'save', 'move D:/New', 'reload',
    ], 'Browse says the unsaved designs are saved first, saves them, then moves');

    const r = await pane({ unsaved: 1 });
    await r.reset();
    assert.deepEqual(r.log, [
        `confirm ${fl.unsavedSavedFirst(fl.confirmReset('C:/Default'), 1)}`,
        'save', 'reset', 'reload',
    ], 'Reset does the same');

    const none = await pane({ unsaved: 0 });
    await none.browse();
    assert.deepEqual(none.log, [`confirm ${fl.confirmMove('D:/New')}`, 'save', 'move D:/New', 'reload'],
        'with nothing unsaved the confirm is the plain one');
}

// ── 2. The count is taken once the folder is chosen ──────────────────────────
{
    const p = await pane({ unsaved: 0, onChoose: state => { state.unsaved = 2; } });
    await p.browse();
    assert.deepEqual(p.log, [
        `confirm ${fl.unsavedSavedFirst(fl.confirmMove('D:/New'), 2)}`,
        'save', 'move D:/New', 'reload',
    ], 'a design changed while the chooser was open is counted and saved');
}

// ── 3. Cancel saves nothing and moves nothing ────────────────────────────────
{
    const p = await pane({ unsaved: 2, answer: false });
    await p.browse();
    assert.deepEqual(p.log, [`confirm ${fl.unsavedSavedFirst(fl.confirmMove('D:/New'), 2)}`]);
    const r = await pane({ unsaved: 2, answer: false });
    await r.reset();
    assert.deepEqual(r.log, [`confirm ${fl.unsavedSavedFirst(fl.confirmReset('C:/Default'), 2)}`],
        'Cancel on Reset does nothing either');
}

// ── 4. A design that cannot be saved stops the move ──────────────────────────
for (const action of ['browse', 'reset']) {
    const p = await pane({ unsaved: 2, failed: ['Filter B', 'AR 2'] });
    await p[action]();
    assert.deepEqual(p.log.slice(1), ['save'], `${action}: nothing moves when a design could not be saved`);
    assert.ok(p.shown().includes(fl.notSaved('Filter B, AR 2')), `${action}: the pane names the designs`);
    assert.equal(p.row().props.moving, false, `${action}: and the buttons are enabled again`);
}

// ── 5. The buttons are disabled while the designs save ───────────────────────
{
    let release;
    const saveGate = new Promise(resolve => { release = resolve; });
    const p = await pane({ unsaved: 3, saveGate });
    const browsing = p.browse();
    await tick();
    assert.deepEqual(p.log.slice(1), ['save']);
    assert.equal(p.row().props.moving, true, 'Browse, Reset and Open are disabled while saving');
    release();
    await browsing;
    assert.equal(p.row().props.moving, false);
    assert.deepEqual(p.log.slice(1), ['save', 'move D:/New', 'reload']);
}

// ── 6. The save-all itself ───────────────────────────────────────────────────
{
    // Both hooks read React's hooks off the global when they run.
    const actions = makeHookRuntime();
    const { useProjectPersistence } = await importWithHookRuntime('../src/hooks/useProjectPersistence.js', actions);
    const { useDesignActions } = await importWithHookRuntime('../src/hooks/useDesignActions.js', actions);
    const written = [];
    globalThis.window.electronAPI = {
        saveDesign: async (folderId, design) => {
            written.push(`${folderId}/${design.name}`);
            if (design.id === 'e') throw new Error('EACCES');
            return design.id === 'c' ? { success: false, error: 'disk full' } : { success: true };
        },
    };
    const design = (id, name) => ({ id, name, frontLayers: [], backLayers: [] });
    const notices = [];
    const store = {
        activeDesignId: 'a',
        dirtyDesigns: { a: true, b: false, c: true, d: true, e: true },
        designsRef: { current: {
            a: design('a', 'A'), b: design('b', 'B'), c: design('c', 'C'),
            d: design('d', 'Preview'), e: design('e', 'E'),
        } },
        diskDesignsRef: { current: {} },
        scheduleSessionSave: () => {}, setDirtyDesigns: () => {},
    };
    const tree = {
        foldersRef: { current: [
            { id: 'One', items: [{ id: 'a' }, { id: 'b' }, { id: 'e' }] },
            { id: 'Two', items: [{ id: 'c' }] },
        ] },
        setFolders: () => {}, selectedFolder: null,
    };
    const setMessageNotification = notice => notices.push(notice);
    const real = globalThis.React;
    globalThis.React = actions.React;
    let api;
    try {
        api = actions.render(() => useDesignActions({
            store, tree, t, setInputDialog: () => {}, setMessageNotification,
            persistChange: useProjectPersistence(setMessageNotification, t),
        }));
    } finally {
        globalThis.React = real;
    }
    assert.equal(api.countUnsavedDesigns(), 3, 'a design in no folder is not counted');
    const failed = await api.saveUnsavedDesigns();
    assert.deepEqual(written, ['One/A', 'Two/C', 'One/E'],
        'each unsaved design in a folder is written to its own folder; a saved one and one in no folder are not');
    assert.deepEqual(failed, ['C', 'E'], 'a refused write and a write that throws are both named');
    assert.equal(notices.length, 2, 'and each was reported by the app');
    assert.ok(notices.every(notice => notice.type === 'error'));
}

console.log('data_folder_move_saves: passed');
