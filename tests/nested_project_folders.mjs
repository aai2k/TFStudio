/**
 * Project folders that nest, and folders that move.
 *
 * Four parts, matching what the feature is built from:
 *   - the tree model: folder ids as paths, the rows the explorer draws, the
 *     search, and the rewrite a rename or a move does to a subtree
 *   - the IPC handlers, against a real Projects tree under os.tmpdir() with the
 *     same path helpers main.js gives them, so the per-segment sanitizing and
 *     the traversal guards are the real ones
 *   - the web demo's store and bridge, which keep the same tree in IndexedDB,
 *     loaded here against the in-memory fallback they already ship
 *   - the explorer itself, rendered to check the nesting reaches the rows
 *
 * Run: node tests/nested_project_folders.mjs
 */
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  explorerRows, filterExplorerFolders, folderDropTargets, folderLeafName, folderSegment,
  folderSubtree, isFolderWithin, joinFolderId, parentFolderId, rehomeExplorerFolder,
  rehomedFolderId,
} from '../src/components/panels/projectExplorerModel.js';
import { shimBrowserGlobals, loadApp, makeLocale, makeTheme } from './_uiShim.mjs';

const require = createRequire(import.meta.url);
const projects = require('../src/main/ipc/projects.js');
const { safeName, safeSegments, safeFilePath, readJsonSafe, writeFileAtomic } = require('../src/main/paths.js');

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

// ── Folder ids are paths ─────────────────────────────────────────────────────
ok(parentFolderId('Archive/2026/Q3') === 'Archive/2026', 'the parent of a folder is its path minus its name');
ok(parentFolderId('Archive') === null, 'a top-level folder has no parent');
ok(folderLeafName('Archive/2026/Q3') === 'Q3', 'a folder is named by the last segment of its id');
ok(folderLeafName('Archive') === 'Archive', 'a top-level folder is named by its whole id');
ok(joinFolderId('Archive', '2026') === 'Archive/2026', 'a name joins its parent to make an id');
ok(joinFolderId(null, '2026') === '2026', 'and stands alone at the top level');
ok(joinFolderId('Archive', 'Q3/rework') === 'Archive/Q3_rework',
  'a separator typed into a name is not a level of nesting');
ok(folderSegment('a\\b/c') === 'a_b_c', 'both separators are replaced in a name');

ok(isFolderWithin('Archive/2026', 'Archive'), 'a subfolder is within its parent');
ok(isFolderWithin('Archive', 'Archive'), 'and a folder is within itself');
ok(!isFolderWithin('Archived', 'Archive'), 'a shared name prefix is not nesting');
ok(!isFolderWithin('Archive', 'Archive/2026'), 'a parent is not within its own child');

// ── The tree the explorer works on ───────────────────────────────────────────
const tree = [
  { id: 'Visible', name: 'Visible', expanded: true, items: [{ id: 'a', name: 'AR VIS', mtime: 10 }] },
  { id: 'Visible/2026', name: '2026', expanded: true, items: [{ id: 'b', name: 'Cold mirror', mtime: 20 }] },
  { id: 'Visible/2026/Q3', name: 'Q3', expanded: false, items: [{ id: 'c', name: 'Beamsplitter', mtime: 30 }] },
  { id: 'Infrared', name: 'Infrared', expanded: true, items: [{ id: 'd', name: 'Germanium AR', mtime: 40 }] },
];

{
  const ids = folderSubtree(tree, 'Visible').map(f => f.id);
  ok(ids.join() === 'Visible,Visible/2026,Visible/2026/Q3', 'a subtree is the folder and everything below it');
  ok(folderSubtree(tree, 'Infrared').length === 1, 'a folder with nothing below it is its own subtree');
}

{
  const ids = folderDropTargets(tree, 'Visible/2026').map(f => f.id);
  ok(ids.join() === 'Infrared',
    'a folder can move anywhere except itself, what is below it, and where it already is');
  ok(folderDropTargets(tree, 'Visible').map(f => f.id).join() === 'Infrared',
    'a top-level folder is not offered its own descendants');
}

{
  const renamed = rehomeExplorerFolder(tree, 'Visible', 'Daylight');
  ok(renamed[0].id === 'Daylight' && renamed[0].name === 'Daylight', 'a rename changes the folder');
  ok(renamed[1].id === 'Daylight/2026', 'and the id of everything below it');
  ok(renamed[2].id === 'Daylight/2026/Q3' && renamed[2].name === 'Q3',
    'while a folder below keeps its own name');
  ok(renamed[3] === tree[3], 'a folder elsewhere keeps its identity');
  ok(tree[0].id === 'Visible', 'the original tree is not mutated');
}

{
  const moved = rehomeExplorerFolder(tree, 'Visible/2026', 'Infrared/2026');
  ok(moved[1].id === 'Infrared/2026', 'a move re-homes the folder');
  ok(moved[2].id === 'Infrared/2026/Q3', 'and carries its subfolders with it');
  ok(moved[2].expanded === false, 'a folder keeps its expanded state when it moves');
  ok(moved[0] === tree[0], 'the old parent is untouched');
}

ok(rehomeExplorerFolder(tree, 'Nope', 'Elsewhere') === tree, 're-homing an unknown folder changes nothing');
ok(rehomeExplorerFolder(tree, 'Visible', 'Visible') === tree, 'and re-homing to where it already is changes nothing');
ok(rehomeExplorerFolder(tree, 'Visible', 'Visible/2026/here') === tree,
  'and re-homing a folder into its own subtree is refused rather than collapsing it');
ok(rehomedFolderId('Visible/2026/Q3', 'Visible', 'Daylight') === 'Daylight/2026/Q3',
  'a descendant id follows the folder that moved');
ok(rehomedFolderId('Infrared', 'Visible', 'Daylight') === 'Infrared', 'and one elsewhere does not');

// ── The rows drawn, in the order they appear ─────────────────────────────────
{
  const rows = explorerRows(tree, { sortMode: 'name-asc' });
  const shape = rows.map(r => `${r.type === 'folder' ? r.folder.id : r.item.name}@${r.depth}`).join(' ');
  ok(shape === 'Infrared@0 Germanium AR@0 Visible@0 Visible/2026@1 Visible/2026/Q3@2 Cold mirror@1 AR VIS@0',
    `rows nest, folders before designs at each level, got: ${shape}`);
  ok(!rows.some(r => r.type === 'item' && r.item.id === 'c'),
    'a collapsed folder keeps its designs off screen');
}

{
  const rows = explorerRows(tree, { sortMode: 'name-asc', allExpanded: true });
  ok(rows.some(r => r.type === 'item' && r.item.id === 'c'),
    'a search opens every level so a match deep in the tree is visible');
}

{
  const collapsed = tree.map(f => (f.id === 'Visible' ? { ...f, expanded: false } : f));
  const ids = explorerRows(collapsed, { sortMode: 'name-asc' })
    .filter(r => r.type === 'folder').map(r => r.folder.id);
  ok(ids.join() === 'Infrared,Visible', 'collapsing a folder hides the whole subtree below it');
}

{
  // A folder whose parent is missing would have nothing to hang on, and walking
  // down from the top level alone would take its designs off screen with it.
  const orphaned = tree.filter(f => f.id !== 'Visible');
  const rows = explorerRows(orphaned, { sortMode: 'name-asc' });
  ok(rows.some(r => r.type === 'folder' && r.folder.id === 'Visible/2026'),
    'a folder with no parent in the tree is still drawn');
  ok(rows.find(r => r.type === 'folder' && r.folder.id === 'Visible/2026').depth === 0,
    'at the top level');
  ok(rows.some(r => r.type === 'item' && r.item.id === 'b'), 'and the designs in it are reachable');
  ok(rows.some(r => r.type === 'folder' && r.folder.id === 'Visible/2026/Q3'),
    'along with the folders below it');
}

// ── Search ───────────────────────────────────────────────────────────────────
{
  const found = filterExplorerFolders(tree, 'beamsplitter');
  ok(found.map(f => f.id).join() === 'Visible,Visible/2026,Visible/2026/Q3',
    'a matching design keeps the folders above it as the path to it');
  ok(found[0].items.length === 0 && found[2].items.length === 1,
    'and those folders show nothing of their own');
}

{
  const found = filterExplorerFolders(tree, '2026');
  ok(found.map(f => f.id).join() === 'Visible,Visible/2026,Visible/2026/Q3',
    'a matching folder is kept with everything filed under it');
  ok(found[1].items.length === 1 && found[2].items.length === 1,
    'and those designs are all kept, not just the ones whose names match');
}

ok(filterExplorerFolders(tree, 'nothing here').length === 0, 'search excludes non-matches');
ok(filterExplorerFolders(tree, '   ') === tree, 'blank search preserves the original tree');

// ── Per-segment sanitizing ───────────────────────────────────────────────────
ok(safeSegments('Archive/2026').join('|') === 'Archive|2026', 'a folder id splits into its segments');
// A backslash is a legal character in a directory name on Linux and macOS, so
// it is a character inside one segment rather than a level of nesting.
ok(safeSegments('Archive\\2026').join('|') === 'Archive_2026', 'a backslash is not a separator');
ok(safeSegments('Archive/b\\c').join('|') === 'Archive|b_c',
  'a folder named with one stays a single segment');
ok(safeSegments('Arch:ive/20*26').join('|') === 'Arch_ive|20_26', 'each segment is sanitized on its own');
for (const bad of ['', '/', '..', 'Archive/..', '../Escaped', '.']) {
  let threw = false;
  try { safeSegments(bad); } catch (_) { threw = true; }
  ok(threw, `a folder id of ${JSON.stringify(bad)} is refused rather than resolved`);
}

// ── The tree on disk ─────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-folders-'));
const projectsDir = path.join(TMP, 'Projects');
fs.mkdirSync(projectsDir, { recursive: true });

const handlers = new Map();
projects.register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
  fs, path, log: () => {}, projectsDir,
  safeName, safeSegments, safeFilePath, readJsonSafe, writeFileAtomic,
});
const call = (channel, ...args) => handlers.get(channel)(null, ...args);
const dirExists = (...parts) => fs.existsSync(path.join(projectsDir, ...parts));

{
  ok((await call('create-folder', 'Archive')).success, 'a top-level folder is created');
  ok((await call('create-folder', 'Archive/2026')).success, 'and a folder inside it');
  ok((await call('create-folder', 'Archive/2026/Q3')).success, 'to any depth');
  ok(dirExists('Archive', '2026', 'Q3'), 'each level is a real directory');
  const again = await call('create-folder', 'Archive/2026');
  ok(!again.success && again.error === 'Folder already exists', 'creating one twice is refused');
}

{
  const escaped = await call('create-folder', '../Escaped');
  ok(!escaped.success, 'a folder id that climbs out of Projects is refused');
  ok(!fs.existsSync(path.join(TMP, 'Escaped')), 'and nothing is created outside it');
}

{
  const design = { id: 'design-1', name: 'Beamsplitter', frontLayers: [{ d: 100 }] };
  ok((await call('save-design', 'Archive/2026/Q3', design)).success, 'a design saves into a nested folder');
  const file = path.join(projectsDir, 'Archive', '2026', 'Q3', 'Beamsplitter.tfs');
  ok(fs.existsSync(file), 'as a .tfs file at that path');

  // A save into a folder deleted or renamed elsewhere must not rebuild the path
  // it names and hide the design in it.
  const orphaned = await call('save-design', 'Archive/Gone/Q4', design);
  ok(!orphaned.success, 'a save whose parent folder is gone is refused');
  ok(!fs.existsSync(path.join(projectsDir, 'Archive', 'Gone')),
    'and no level of the missing path is recreated');

  const loaded = await call('load-folders');
  const ids = loaded.folders.map(f => f.id);
  ok(loaded.success, 'the tree loads');
  ok(ids.join() === 'Archive,Archive/2026,Archive/2026/Q3', 'every folder is reported, by path, parent first');
  ok(loaded.folders[2].name === 'Q3', 'a folder is named by its own segment');
  ok(loaded.folders[0].expanded === true, 'the top level opens');
  ok(loaded.folders[1].expanded === false && loaded.folders[2].expanded === false,
    'and the levels below it start closed, so a deep tree does not fill the panel on launch');
  ok(loaded.folders[2].items.map(i => i.id).join() === 'design-1', 'with the designs it holds directly');
  ok(loaded.folders[1].items.length === 0, 'and none of the ones below it');
}

{
  ok((await call('rename-item', 'Archive/2026/Q3', 'Beamsplitter', 'Beamsplitter 2')).success,
    'a design in a nested folder renames');
  ok(dirExists('Archive', '2026', 'Q3', 'Beamsplitter 2.tfs'), 'and its file moves with it');
  ok((await call('move-item', 'Archive/2026/Q3', 'Archive', 'Beamsplitter 2')).success,
    'and moves to a folder at another depth');
  ok(dirExists('Archive', 'Beamsplitter 2.tfs'), 'landing there');
  ok(!dirExists('Archive', '2026', 'Q3', 'Beamsplitter 2.tfs'), 'and leaving where it was');
  ok((await call('delete-item', 'Archive', 'Beamsplitter 2')).success, 'and deletes');
  ok(!dirExists('Archive', 'Beamsplitter 2.tfs'), 'taking its file with it');
}

{
  // Renaming a folder carries its subtree, which is what makes the ids below it
  // change in the tree.
  const renamed = await call('rename-folder', 'Archive/2026', 'Archive/2027');
  ok(renamed.success, `a folder renames, got error: ${renamed.error}`);
  ok(dirExists('Archive', '2027', 'Q3'), 'and everything below it comes along');
  ok(!dirExists('Archive', '2026'), 'leaving nothing behind');
}

{
  ok((await call('create-folder', 'Infrared')).success, 'a second top-level folder');
  const moved = await call('rename-folder', 'Archive/2027', 'Infrared/2027');
  ok(moved.success, `a folder moves to another parent, got error: ${moved.error}`);
  ok(dirExists('Infrared', '2027', 'Q3'), 'with its subfolders');
  ok(!dirExists('Archive', '2027'), 'and is gone from the old parent');

  const back = await call('rename-folder', 'Infrared/2027', '2027');
  ok(back.success, 'and moves back to the top level');
  ok(dirExists('2027', 'Q3'), 'landing under Projects itself');
}

{
  const intoSelf = await call('rename-folder', '2027', '2027/Q3/moved');
  ok(!intoSelf.success, 'a folder cannot be moved into something below it');
  ok(intoSelf.error === 'Target folder is inside the folder being moved', `naming the reason, got: ${intoSelf.error}`);
  ok(dirExists('2027', 'Q3'), 'and is left where it was');

  const taken = await call('rename-folder', '2027', 'Archive');
  ok(!taken.success, 'a name already taken by another folder is refused');
  ok(taken.error === 'Target folder name already exists', `naming the reason, got: ${taken.error}`);

  const noParent = await call('rename-folder', '2027', 'No Such Folder/2027');
  ok(!noParent.success, 'a target parent that does not exist is refused');
  ok(noParent.error === 'Target folder does not exist', `naming the reason, got: ${noParent.error}`);

  const missing = await call('rename-folder', 'Nope', 'Archive/Nope');
  ok(!missing.success && missing.error === 'Folder does not exist', 'and so is a folder that is not there');
}

{
  // A directory symlink reports as a link rather than a directory, so the walk
  // steps over one instead of following it. Without that, a link pointing back
  // up its own tree recurses until the stack gives out. Symlinks need a
  // privilege on Windows that a plain user does not have, so the link is made
  // as a junction, which needs none there and is an ordinary symlink on a
  // POSIX host. Skipped where the file system refuses it outright.
  let linked = false;
  try {
    fs.symlinkSync(path.join(projectsDir, 'Archive'), path.join(projectsDir, 'Archive', 'loop'), 'junction');
    linked = true;
  } catch (_) { /* not permitted here */ }
  if (linked) {
    const loaded = await call('load-folders');
    ok(loaded.success, 'a tree holding a symlink back to itself still loads');
    ok(!loaded.folders.some(f => f.id.includes('loop')), 'and the link is not walked as a folder');
    fs.unlinkSync(path.join(projectsDir, 'Archive', 'loop'));
  }
}

{
  const deleted = await call('delete-folder', '2027');
  ok(deleted.success, 'deleting a folder succeeds');
  ok(!dirExists('2027'), 'and takes the subfolders below it');
}

fs.rmSync(TMP, { recursive: true, force: true });

// ── The same tree in the web demo's store ────────────────────────────────────
// The demo keeps designs in IndexedDB rather than in files, and names a folder
// by the same path. Loaded here with no IndexedDB, which is the in-memory
// fallback it already ships for private-browsing modes.
{
  const source = fs.readFileSync(new URL('../web/demo-storage.js', import.meta.url), 'utf-8');
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function('window', 'indexedDB', source)(win, undefined);
  const store = win.DemoStorage;

  const design = (name) => ({ id: `demo-${name}`, name, frontLayers: [] });
  await store.createFolder('Archive');
  ok(!store.persistent(), 'the demo falls back to its in-memory store with no IndexedDB');
  await store.createFolder('Archive/2026');
  await store.createFolder('Archive/2026/Q3');
  await store.putDesign('Archive/2026/Q3', design('Beamsplitter'));
  await store.putDesign('Archive', design('AR VIS'));

  const folderIds = async () => (await store.listFolders()).map(f => f.name).sort();
  const designHomes = async () => (await store.listDesigns()).map(d => `${d.folder}/${d.name}`).sort();

  ok((await folderIds()).join() === 'Archive,Archive/2026,Archive/2026/Q3',
    'the demo store holds a folder per level, named by path');

  await store.renameFolder('Archive', 'Warehouse');
  ok((await folderIds()).join() === 'Warehouse,Warehouse/2026,Warehouse/2026/Q3',
    'renaming a folder in the demo carries the folders below it');
  ok((await designHomes()).join() === 'Warehouse/2026/Q3/Beamsplitter,Warehouse/AR VIS',
    'and the designs of the whole subtree come with it');

  await store.renameFolder('Warehouse/2026', '2026');
  ok((await folderIds()).join() === '2026,2026/Q3,Warehouse',
    'a move to the top level is the same rewrite');
  ok((await designHomes()).join() === '2026/Q3/Beamsplitter,Warehouse/AR VIS',
    'and takes that subtree\'s designs along');

  await store.deleteFolder('2026');
  ok((await folderIds()).join() === 'Warehouse', 'deleting a folder deletes the folders below it');
  ok((await designHomes()).join() === 'Warehouse/AR VIS', 'and their designs, leaving the rest alone');

  // The bridge the demo's renderer sees, over that same store.
  const shimSource = fs.readFileSync(new URL('../web/demo-shim.js', import.meta.url), 'utf-8');
  // eslint-disable-next-line no-new-func
  new Function('window', shimSource)(win);

  await store.createFolder('Warehouse/2027');
  // A design saved into a folder the store has no record of: the folder list and
  // the design list are independent, so the levels above it have to be filled in
  // or the design has no row to sit on.
  await store.putDesign('Warehouse/2027/Q1/draft', design('Orphan'));

  const loaded = await win.electronAPI.loadFolders();
  ok(loaded.success, 'the demo bridge loads the tree');
  const byId = new Map(loaded.folders.map(f => [f.id, f]));
  ok(byId.get('Warehouse/2027').name === '2027', 'a nested folder is named by its own segment, not its path');
  ok(byId.has('Warehouse/2027/Q1') && byId.has('Warehouse/2027/Q1/draft'),
    'a design in a folder with no record of its own still gets the levels above it');
  ok(byId.get('Warehouse/2027/Q1/draft').items.map(i => i.name).join() === 'Orphan',
    'and the design itself is there to be seen');
}

// ── The rows the explorer renders ────────────────────────────────────────────
shimBrowserGlobals();
await loadApp();
const { ProjectExplorer } = await import('../src/components/panels/ProjectExplorer.js');
const noop = () => {};
const markup = renderToStaticMarkup(React.createElement(ProjectExplorer, {
  folders: tree,
  selectedFolder: tree[0],
  selectedItem: null,
  selectedItems: [],
  handleItemClick: noop, setSelectedFolder: noop, toggleFolderExpanded: noop,
  addItem: noop, duplicateItem: noop, removeSelectedItems: noop, removeItem: noop,
  setInputDialog: noop, addFolder: noop, renameFolder: noop, renameItem: noop,
  removeFolder: noop, moveItemsToFolder: noop, moveFolder: noop,
  dirtyDesigns: {},
  c: makeTheme(), t: makeLocale(), onOpenDesign: noop,
}));
ok(markup.includes('padding-left:4px'), 'a top-level folder row sits where it always has');
ok(markup.includes('padding-left:16px') && markup.includes('padding-left:28px'),
  'a subfolder row is indented by its depth');
ok(markup.includes('padding-left:32px') && markup.includes('padding-left:44px'),
  'and so is a design row under one');
ok((markup.match(/draggable="true"/g) || []).length >= tree.length,
  'folder rows are drag sources, not only design rows');

console.log(`nested_project_folders: ${passed} passed`);
