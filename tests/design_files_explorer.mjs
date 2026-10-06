/**
 * The explorer side of the design-file rules.
 *
 *   1. Delete and move send the row's design id with its name, so the main
 *      process can refuse a file that holds another design, and the refusal
 *      is worded for the user.
 *   8. A project folder deleted where there is no Recycle Bin keeps the files
 *      that are not designs, and the user is told so.
 *  11. Sorting by name survives a row whose name is not a string.
 *  12. A folder name Windows cannot open is refused as it is typed.
 *  17. A move whose file is gone from disk says how to write it again.
 *
 * Also the where-each-design-lives map the renderer hands the main process.
 *
 * Run: node tests/design_files_explorer.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
await loadApp();
const t = makeLocale();

const model = await import('../src/components/panels/projectExplorerModel.js');

// ── 11. Sorting a name that is not a string ──────────────────────────────────
{
    const items = [{ id: 'a', name: 'b' }, { id: 'n', name: 2024 }, { id: 'u' }];
    for (const mode of ['name-asc', 'name-desc', 'date-new', 'date-old']) {
        assert.doesNotThrow(() => model.sortExplorerItems(items, mode), `sorting by ${mode} survives a numeric name`);
    }
    assert.deepEqual(model.sortExplorerItems(items, 'name-desc').map(i => i.id), ['a', 'n', 'u']);
}

// ── Where each design lives ──────────────────────────────────────────────────
{
    const folders = [
        { id: 'My Designs', items: [{ id: 'd1', name: 'D1' }, { id: 'd2', name: 'A/B: test?' }] },
        { id: 'Archive/2026', items: [{ id: 'd3', name: 'AR' }] },
    ];
    assert.deepEqual(model.designFileLocations(folders), {
        d1: 'My Designs/D1.tfs',
        d2: 'My Designs/A_B_ test_.tfs',
        d3: 'Archive/2026/AR.tfs',
    }, 'each row maps to its file the way the main process names it');
}

// ── The hooks ────────────────────────────────────────────────────────────────
const runtime = makeHookRuntime();
const { useProjectPersistence } = await importWithHookRuntime('../src/hooks/useProjectPersistence.js', runtime);
const { useProjectRemoval } = await importWithHookRuntime('../src/hooks/useProjectRemoval.js', runtime);
const { useFolderActions } = await importWithHookRuntime('../src/hooks/useFolderActions.js', runtime);

function harness(api) {
    const calls = [];
    const notices = [];
    let dialog = null;
    const folders = [
        { id: 'My Designs', name: 'My Designs', expanded: true, items: [{ id: 'design-ar', name: 'AR' }, { id: 'design-b', name: 'B' }] },
        { id: 'Archive', name: 'Archive', expanded: true, items: [] },
        { id: 'Customer', name: 'Customer', expanded: true, items: [{ id: 'design-c', name: 'C' }] },
    ];
    const tree = {
        foldersRef: { current: folders },
        setFolders: () => {}, setSelectedFolder: () => {},
        selectedItem: null, selectedItems: [],
        evictDesigns: () => {}, rehomeUnreadNames: () => {}, forgetUnreadNames: () => {},
    };
    globalThis.window.electronAPI = Object.fromEntries(Object.entries(api).map(([name, fn]) =>
        [name, async (...args) => { calls.push([name, ...args]); return fn(...args); }]));
    const setMessageNotification = (n) => notices.push(n);
    const setInputDialog = (d) => { dialog = d; };
    const real = globalThis.React;
    globalThis.React = runtime.React;
    try {
        return runtime.render(() => {
            const persistChange = useProjectPersistence(setMessageNotification, t);
            return {
                calls, notices, dialog: () => dialog,
                removal: useProjectRemoval({ tree, persistChange, setMessageNotification, t }),
                folders: useFolderActions({ tree, persistChange, setInputDialog, setMessageNotification, t }),
            };
        });
    } finally {
        globalThis.React = real;
    }
}

// 1. Delete and move carry the design id.
{
    const h = harness({
        deleteItem: () => ({ success: true }),
        moveItem: () => ({ success: true }),
    });
    await h.removal.removeItem('My Designs', 'design-ar');
    await h.removal.removeSelectedItems([{ id: 'design-b', name: 'B' }]);
    await h.folders.moveItemsToFolder(['design-c'], 'Archive');
    assert.deepEqual(h.calls, [
        ['deleteItem', 'My Designs', 'AR', 'design-ar'],
        ['deleteItem', 'My Designs', 'B', 'design-b'],
        ['moveItem', 'Customer', 'Archive', 'C', 'design-c'],
    ], 'every row call names the design it means');
}
{
    const h = harness({
        deleteItem: () => ({ success: false, error: 'not-this-design' }),
        moveItem: () => ({ success: false, error: 'not-this-design' }),
    });
    await h.removal.removeItem('My Designs', 'design-ar');
    assert.equal(h.notices.at(-1).message, t.explorer.notThisDesign('AR'), 'a refused delete says why');
    await h.folders.moveItemsToFolder(['design-ar'], 'Archive');
    assert.equal(h.notices.at(-1).message, t.explorer.notThisDesign('AR'), 'and so does a refused move');
}

// 17. A move whose file is gone.
{
    const h = harness({ moveItem: () => ({ success: false, error: 'File not found' }) });
    await h.folders.moveItemsToFolder(['design-c'], 'Archive');
    assert.equal(h.notices.at(-1).message, t.explorer.fileGone('C'), 'the user is told to save it first');
}

// 8. A folder deleted where there is no Recycle Bin.
{
    const h = harness({ deleteFolder: () => ({ success: true, filesLeft: 3 }) });
    await h.removal.removeFolder('Customer');
    assert.equal(h.notices.at(-1).message, t.explorer.folderFilesLeft('Customer', 3), 'the files left behind are mentioned');
    const quiet = harness({ deleteFolder: () => ({ success: true }) });
    await quiet.removal.removeFolder('Customer');
    assert.equal(quiet.notices.length, 0, 'a folder sent to the Recycle Bin whole needs no notice');
}

// 12. Folder names refused as typed.
{
    const h = harness({ createFolder: () => ({ success: true }), renameFolder: () => ({ success: true }) });
    h.folders.addFolder(null);
    for (const name of ['Thorlabs Inc.', 'Q3.', 'CON', 'aux', 'Nul.txt', 'COM1', 'LPT9']) {
        assert.equal(h.dialog().validate(name), t.dialogs.folder.nameNotAllowed, `the new-folder dialog refuses "${name}"`);
    }
    for (const name of ['Thorlabs Inc', 'CONSOLE', 'COM10', 'Rev 2.1', 'Q3']) {
        assert.equal(h.dialog().validate(name), '', `and takes "${name}"`);
    }
    const renamed = await h.folders.renameFolder('Archive', 'aux');
    assert.equal(renamed, false);
    assert.equal(h.notices.at(-1).message, t.dialogs.folder.nameNotAllowed, 'a rename to such a name is refused');
    assert.equal(h.calls.length, 0, 'before anything reaches the disk');

    const fromDisk = harness({ createFolder: () => ({ success: false, error: 'name-not-allowed' }) });
    fromDisk.folders.addFolder(null);
    await fromDisk.dialog().onConfirm('Rev 2');
    assert.equal(fromDisk.notices.at(-1).message, t.dialogs.folder.nameNotAllowed, 'the main process refusal is worded the same');
}

for (const code of ['en', 'ru', 'zh', 'it']) {
    const locale = makeLocale(code);
    for (const key of ['notThisDesign', 'fileGone', 'folderFilesLeft']) {
        assert.equal(typeof locale.explorer[key], 'function', `${code}: explorer.${key}`);
    }
    assert.equal(typeof locale.dialogs.folder.nameNotAllowed, 'string', `${code}: dialogs.folder.nameNotAllowed`);
}

console.log('design_files_explorer: passed');
