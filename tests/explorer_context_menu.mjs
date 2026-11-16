/**
 * The Project Explorer's right-click menu.
 *
 *   1. A design's destination folders sit in one "Move to" entry, as a submenu,
 *      however many folders there are. A multi-selection and a folder get the
 *      same, a folder's with the top level first.
 *   2. The shared context menu opens an entry's children in a submenu beside
 *      it, which scrolls when long and moves left when the right side has no
 *      room; a child runs and closes the menu like any other entry.
 *   3. An entry shows a design's file, or a folder, in the system file manager,
 *      named File Explorer on Windows. It is left out where the app has no files
 *      of its own, as in the web demo.
 *   4. The main process builds the path itself, the way every row call does,
 *      and opens nothing outside Projects; a design whose file is gone is told
 *      how to write it again.
 *
 * Run: node tests/explorer_context_menu.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shimBrowserGlobals, loadApp, makeLocale, makeTheme } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
await loadApp();
const t = makeLocale();
const c = makeTheme();

const runtime = makeHookRuntime();
Object.assign(runtime.React, { createElement: React.createElement });
const { ProjectExplorer } = await importWithHookRuntime('../src/components/panels/ProjectExplorer.js', runtime);
const { ContextMenu, submenuPosition } = await importWithHookRuntime('../src/components/ui/ContextMenu.js', runtime);

function withRuntime(render) {
    const real = globalThis.React;
    globalThis.React = runtime.React;
    try {
        return runtime.render(render);
    } finally {
        globalThis.React = real;
    }
}

function find(node, test) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
        for (const child of node) {
            const hit = find(child, test);
            if (hit) return hit;
        }
        return null;
    }
    if (test(node)) return node;
    return find(node.props?.children, test);
}

const entries = items => items.filter(item => !item.separator);
const labels = items => entries(items).map(item => item.label);

// ── 1 and 3. What the explorer's menus hold ──────────────────────────────────
// The nine folders of a real project tree, plus one nested folder.
const names = ['cwdm1', 'Filters', 'GFF', 'macleod', 'Mirrors', 'ml', 'My Designs', 'New Project', 'ol'];
const folders = [
    ...names.map(name => ({ id: name, name, expanded: true, items: [] })),
    { id: 'Filters/Narrow', name: 'Narrow', expanded: true, items: [] },
];
const myDesigns = folders.find(f => f.id === 'My Designs');
myDesigns.items = [{ id: 'ar', name: 'AR' }, { id: 'bp', name: 'BP' }];

const moved = [];
const folderMoves = [];
const shown = [];
const noop = () => {};
const baseProps = {
    folders, selectedFolder: myDesigns, selectedItem: null, selectedItems: [],
    handleItemClick: noop, setSelectedFolder: noop, toggleFolderExpanded: noop,
    addItem: noop, duplicateItem: noop, removeSelectedItems: noop, removeItem: noop,
    setInputDialog: noop, addFolder: noop, renameFolder: noop, renameItem: noop, removeFolder: noop,
    moveItemsToFolder: (ids, target) => moved.push([ids, target]),
    moveFolder: (id, parent) => folderMoves.push([id, parent]),
    showInFileManager: (folderId, item) => shown.push([folderId, item?.id ?? null]),
    dirtyDesigns: {}, c, t, onOpenDesign: noop,
};

const rightClick = { preventDefault: noop, stopPropagation: noop, clientX: 40, clientY: 60 };

// Right-click the row `pick` finds and answer with the menu's entries.
function menuFor(props, pick) {
    runtime.reset();
    const tree = withRuntime(() => ProjectExplorer({ ...baseProps, ...props }));
    find(tree, pick).props.onContextMenu(rightClick);
    const menu = find(withRuntime(() => ProjectExplorer({ ...baseProps, ...props })), el => el.type === ContextMenu);
    return menu.props.items;
}
const designRow = id => el => el.props?.item?.id === id && el.props.onContextMenu;
const folderRow = id => el => el.props?.folder?.id === id && !el.props.item && el.props.onContextMenu;

globalThis.window.electronAPI = { platform: 'win32' };

{
    const items = menuFor({}, designRow('ar'));
    assert.deepEqual(labels(items), [
        t.explorer.open, t.explorer.duplicate, t.explorer.renameF2,
        t.explorer.moveTo, t.explorer.openInExplorer, t.explorer.delete,
    ], 'a design\'s menu holds one Move to entry, then Open in File Explorer, whatever the folder count');
    const move = entries(items).find(item => item.label === t.explorer.moveTo);
    assert.deepEqual(move.children.map(child => child.label),
        folders.map(f => f.id).filter(id => id !== 'My Designs'),
        'its submenu lists every folder but the one the design is in, by path');
    move.children.find(child => child.label === 'GFF').onClick();
    assert.deepEqual(moved.at(-1), [['ar'], 'GFF'], 'a folder in the submenu moves the design there');
    entries(items).find(item => item.label === t.explorer.openInExplorer).onClick();
    assert.deepEqual(shown.at(-1), ['My Designs', 'ar'], 'and the design is shown in its folder');
}

{
    const items = menuFor({ selectedItems: myDesigns.items.slice() }, designRow('ar'));
    assert.deepEqual(labels(items), [t.explorer.moveSelectedTo(2), t.explorer.deleteSelected(2)],
        'a multi-selection gets one Move entry too, and no file manager entry');
    entries(items)[0].children.find(child => child.label === 'ol').onClick();
    assert.deepEqual(moved.at(-1), [['ar', 'bp'], 'ol'], 'which moves the whole selection');
}

{
    globalThis.window.electronAPI = { platform: 'linux' };
    const items = menuFor({}, folderRow('Filters/Narrow'));
    const move = entries(items).find(item => item.label === t.explorer.moveTo);
    assert.equal(move.children[0].label, t.explorer.topLevel, 'a nested folder can go back to the top level first');
    assert.ok(!move.children.some(child => ['Filters', 'Filters/Narrow'].includes(child.label)),
        'and not into itself or the folder already holding it');
    move.children[0].onClick();
    assert.deepEqual(folderMoves.at(-1), ['Filters/Narrow', null]);
    const reveal = entries(items).find(item => item.label === t.explorer.openInFileManager);
    assert.ok(reveal, 'on Linux the entry names the file manager');
    reveal.onClick();
    assert.deepEqual(shown.at(-1), ['Filters/Narrow', null], 'and a folder is shown as itself');
    globalThis.window.electronAPI = { platform: 'win32' };
}

{
    const without = { showInFileManager: null };
    for (const items of [menuFor(without, designRow('ar')), menuFor(without, folderRow('GFF'))]) {
        assert.ok(!entries(items).some(item => item.id === 'show-in-file-manager'),
            'with no files to show, as in the web demo, the entry is left out');
    }
    const demoShim = fs.readFileSync(new URL('../web/demo-shim.js', import.meta.url), 'utf8');
    assert.ok(!demoShim.includes('showInFolder'), 'and the web demo\'s bridge offers none');
}

// ── 2. The submenu of the shared context menu ────────────────────────────────
{
    let closed = 0;
    let ran = null;
    const children = folders.map(f => ({ id: f.id, label: f.id, onClick: () => { ran = f.id; } }));
    const items = [
        { id: 'move', label: 'Move to', icon: 'folder-symlink', children },
        { separator: true },
        { id: 'delete', label: 'Delete', icon: 'trash', danger: true, onClick: () => { ran = 'delete'; } },
    ];
    runtime.reset();
    const draw = () => withRuntime(() => ContextMenu({ x: 40, y: 60, items, c, onClose: () => { closed++; } }));
    const panels = menu => menu.props.children.filter(Boolean);
    const rows = panel => panel.type(panel.props).props.children
        .filter(el => el.props.item).map(el => el.type(el.props));
    const rowEvent = { stopPropagation: noop, currentTarget: {
        style: {}, getBoundingClientRect: () => ({ left: 40, right: 230, top: 65, bottom: 93, width: 190, height: 28 }),
    } };

    let menu = draw();
    assert.equal(panels(menu).length, 1, 'the submenu is closed until asked for');
    let [parent, remove] = rows(panels(menu)[0]);
    assert.equal(parent.props['aria-haspopup'], 'menu');
    assert.equal(parent.props['aria-expanded'], 'false');
    assert.ok(find(parent, el => el.props?.className === 'tf-caret'), 'an entry with children shows a caret');

    parent.props.onMouseEnter(rowEvent);
    menu = draw();
    assert.equal(panels(menu).length, 2, 'hovering the entry opens its submenu');
    const sub = panels(menu)[1];
    assert.equal(sub.props.items, children);
    assert.deepEqual(sub.props.position, { left: 231, top: 60 },
        'just past the menu\'s right border, its first row level with the entry');
    const subStyle = sub.type(sub.props).props.style;
    assert.equal(subStyle.overflowY, 'auto', 'a long submenu scrolls');
    assert.equal(subStyle.maxHeight, '80vh', 'within the same height as the menu itself');
    let stopped = 0;
    sub.type(sub.props).props.onWheel({ stopPropagation: () => { stopped++; } });
    assert.equal(stopped, 1, 'a wheel turn over it scrolls it rather than closing the menu');
    [parent, remove] = rows(panels(menu)[0]);
    assert.equal(parent.props['aria-expanded'], 'true');
    assert.equal(parent.props.style.background, c.hover, 'the entry stays lit while its submenu shows');

    remove.props.onMouseEnter(rowEvent);
    menu = draw();
    assert.equal(panels(menu).length, 1, 'hovering another entry closes the submenu');

    [parent] = rows(panels(menu)[0]);
    parent.props.onClick(rowEvent);
    menu = draw();
    assert.equal(panels(menu).length, 2, 'clicking the entry opens it too');
    assert.equal(closed, 0, 'without closing the menu or running anything');
    rows(panels(menu)[1]).find(row => row.props.children.some(child => child?.props?.children === 'GFF'))
        .props.onClick(rowEvent);
    assert.equal(ran, 'GFF', 'a child runs');
    assert.equal(closed, 1, 'and closes the menu');
}

{
    const view = { innerWidth: 1000, innerHeight: 800 };
    const row = { left: 40, right: 230, top: 65 };
    assert.deepEqual(submenuPosition(row, { width: 150, height: 300 }, view), { left: 231, top: 60 });
    assert.deepEqual(submenuPosition({ left: 700, right: 890, top: 65 }, { width: 150, height: 300 }, view),
        { left: 549, top: 60 }, 'with no room on the right it opens past the menu\'s left border');
    assert.deepEqual(submenuPosition({ ...row, top: 700 }, { width: 150, height: 300 }, view),
        { left: 231, top: 496 }, 'and it is kept inside the window at the bottom');
}

// ── 4. The main process ───────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
const projects = require('../src/main/ipc/projects.js');
const { safeName, safeSegments, safeFilePath } = require('../src/main/paths.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'show-in-folder-'));
const projectsDir = path.join(TMP, 'Projects');
fs.mkdirSync(path.join(projectsDir, 'Filters', 'Narrow'), { recursive: true });
fs.writeFileSync(path.join(projectsDir, 'Filters', 'Narrow', 'BP 550.tfs'), '{}');
fs.writeFileSync(path.join(projectsDir, 'Filters', 'A_B.tfs'), '{}');

const opened = [];
let openPathAnswer = '';
const shell = {
    showItemInFolder: (target) => opened.push(['select', target]),
    openPath: async (target) => { opened.push(['open', target]); return openPathAnswer; },
};
const handlers = new Map();
projects.register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
    fs, path, log: noop, projectsDir, shell, safeName, safeSegments, safeFilePath,
});
const showInFolder = (...args) => handlers.get('show-in-folder')(null, ...args);

try {
    assert.deepEqual(await showInFolder('Filters/Narrow', 'BP 550'), { success: true });
    assert.deepEqual(opened.at(-1), ['select', path.join(projectsDir, 'Filters', 'Narrow', 'BP 550.tfs')],
        'a design opens its folder with its file selected');
    assert.deepEqual(await showInFolder('Filters', 'A/B'), { success: true });
    assert.deepEqual(opened.at(-1), ['select', path.join(projectsDir, 'Filters', 'A_B.tfs')],
        'the file name is made from the design name as a save makes it');
    assert.deepEqual(await showInFolder('Filters/Narrow'), { success: true });
    assert.deepEqual(opened.at(-1), ['open', path.join(projectsDir, 'Filters', 'Narrow')],
        'a folder opens as itself');

    const before = opened.length;
    assert.deepEqual(await showInFolder('Filters', 'Gone'), { success: false, error: 'File not found' });
    assert.deepEqual(await showInFolder('Gone'), { success: false, error: 'Folder does not exist' });
    assert.equal((await showInFolder('..')).success, false, 'a folder id that climbs out of Projects is refused');
    assert.equal((await showInFolder('Filters/../..')).success, false);
    assert.equal(opened.length, before, 'and nothing was opened for any of them');

    openPathAnswer = 'Failed to open path';
    assert.deepEqual(await showInFolder('Filters'), { success: false, error: 'Failed to open path' },
        'a file manager that will not open answers with its own error');
} finally {
    fs.rmSync(TMP, { recursive: true, force: true });
}

const preload = fs.readFileSync(new URL('../src/preload.js', import.meta.url), 'utf8');
assert.match(preload, /showInFolder:\s*\(folderId, itemName\) => ipcRenderer\.invoke\('show-in-folder', folderId, itemName\)/,
    'the preload bridge reaches the handler');
assert.match(preload, /platform:\s*process\.platform/, 'and tells the renderer the platform');

// ── 3 and 4. The renderer's side of the call ─────────────────────────────────
const hookRuntime = makeHookRuntime();
const { useFolderActions } = await importWithHookRuntime('../src/hooks/useFolderActions.js', hookRuntime);

function folderActions(api) {
    const notices = [];
    globalThis.window.electronAPI = api;
    const tree = { foldersRef: { current: folders }, setFolders: noop, setSelectedFolder: noop, selectedItem: null };
    const real = globalThis.React;
    globalThis.React = hookRuntime.React;
    try {
        hookRuntime.reset();
        const actions = hookRuntime.render(() => useFolderActions({
            tree, persistChange: noop, setInputDialog: noop, setMessageNotification: n => notices.push(n), t,
        }));
        return { actions, notices };
    } finally {
        globalThis.React = real;
    }
}

{
    const calls = [];
    let answer = { success: true };
    const { actions, notices } = folderActions({ showInFolder: async (...args) => { calls.push(args); return answer; } });
    assert.equal(await actions.showInFileManager('My Designs', { id: 'ar', name: 'AR' }), true);
    assert.equal(await actions.showInFileManager('Filters/Narrow', null), true);
    assert.deepEqual(calls, [['My Designs', 'AR'], ['Filters/Narrow', null]],
        'a design is named by its folder and name, a folder by its id alone');
    assert.equal(notices.length, 0);

    answer = { success: false, error: 'File not found' };
    await actions.showInFileManager('My Designs', { id: 'ar', name: 'AR' });
    assert.equal(notices.at(-1).message, t.explorer.fileGone('AR'), 'a file gone from disk says how to write it again');
    answer = { success: false, error: 'Folder does not exist' };
    await actions.showInFileManager('Filters/Narrow', null);
    assert.equal(notices.at(-1).message, t.explorer.openInFileManagerFailed('Filters/Narrow'),
        'any other failure says what could not be opened');
}

assert.equal(folderActions({}).actions.showInFileManager, null,
    'a bridge with no file system, as in the web demo, offers no action');

console.log('explorer_context_menu: passed');
