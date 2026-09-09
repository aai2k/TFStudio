/**
 * Moving a design to another project folder.
 *
 * Two halves, matching the two the feature is built from:
 *   - moveExplorerItems, the tree transition the explorer renders
 *   - the move-item IPC handler, which renames the .tfs file on disk
 *
 * The handler runs against a real Projects tree under os.tmpdir() with the same
 * path helpers main.js gives it, so the collision and traversal guards are the
 * real ones.
 *
 * Run: node tests/design_move_between_folders.mjs
 */
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { dropTargetFolders, moveExplorerItems } from '../src/components/panels/projectExplorerModel.js';
import { shimBrowserGlobals, loadApp, makeLocale, makeTheme } from './_uiShim.mjs';

const require = createRequire(import.meta.url);
const projects = require('../src/main/ipc/projects.js');
const { safeName, safeSegments, safeFilePath, readJsonSafe, writeFileAtomic } = require('../src/main/paths.js');

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

// ── The tree transition ──────────────────────────────────────────────────────
const tree = [
  { id: 'visible', name: 'Visible coatings', expanded: true, items: [
    { id: 'a', name: 'AR VIS' },
    { id: 'b', name: 'Cold mirror' },
  ] },
  { id: 'ir', name: 'Infrared', expanded: true, items: [{ id: 'c', name: 'Germanium AR' }] },
  { id: 'archive', name: 'Archive', expanded: false, items: [] },
];

{
  const moved = moveExplorerItems(tree, ['a'], 'archive');
  ok(moved[0].items.map(i => i.id).join() === 'b', 'the design leaves its old folder');
  ok(moved[2].items.map(i => i.id).join() === 'a', 'and arrives in the target');
  ok(moved[1] === tree[1], 'a folder with nothing to do keeps its identity');
  ok(tree[0].items.length === 2, 'the original tree is not mutated');
}

{
  // A multi-selection can span folders, so one drop pulls from both.
  const moved = moveExplorerItems(tree, ['a', 'c'], 'archive');
  ok(moved[0].items.map(i => i.id).join() === 'b', 'the first source folder gives up its design');
  ok(moved[1].items.length === 0, 'so does the second');
  ok(moved[2].items.map(i => i.id).join() === 'a,c', 'and both land in the target');
}

{
  const moved = moveExplorerItems(tree, ['a', 'b'], 'visible');
  ok(moved === tree, 'dropping designs on the folder they are already in changes nothing');
}

{
  const partial = moveExplorerItems(tree, ['a', 'c'], 'visible');
  ok(partial[1].items.length === 0, 'a mixed drop still moves the design from elsewhere');
  ok(partial[0].items.map(i => i.id).join() === 'a,b,c', 'and leaves the one already there in place');
}

ok(moveExplorerItems(tree, [], 'archive') === tree, 'an empty drag changes nothing');
ok(moveExplorerItems(tree, ['a'], 'no-such-folder') === tree, 'an unknown target changes nothing');
ok(moveExplorerItems(tree, ['no-such-design'], 'archive') === tree, 'an unknown design changes nothing');

// ── Which folders are offered, and which light up under a drag ───────────────
{
  const ids = dropTargetFolders(tree, ['a']).map(f => f.id);
  ok(ids.join() === 'ir,archive', 'a design is offered every folder except the one it is in');
}
{
  const ids = dropTargetFolders(tree, ['a', 'c']).map(f => f.id);
  ok(ids.join() === 'visible,ir,archive',
    'a selection spanning folders can move into either of them, and elsewhere');
}
ok(dropTargetFolders(tree, []).length === 0, 'nothing is a drop target for an empty drag');
ok(dropTargetFolders(tree, null).length === 0, 'and none for no drag at all');
ok(dropTargetFolders(tree, ['a', 'b']).map(f => f.id).join() === 'ir,archive',
  'the shared home folder of a selection is not offered');

// ── The file on disk ─────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'design-move-'));
const projectsDir = path.join(TMP, 'Projects');
for (const folder of ['My Designs', 'Archive', 'Empty']) {
  fs.mkdirSync(path.join(projectsDir, folder), { recursive: true });
}

const handlers = new Map();
projects.register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
  fs, path, log: () => {}, projectsDir,
  safeName, safeSegments, safeFilePath, readJsonSafe, writeFileAtomic,
});
const move = (from, to, name) => handlers.get('move-item')(null, from, to, name);

const design = { tfs_version: '1.1', id: 'design-1', name: 'AR VIS', frontLayers: [{ d: 100 }] };
const source = path.join(projectsDir, 'My Designs', 'AR VIS.tfs');
const target = path.join(projectsDir, 'Archive', 'AR VIS.tfs');
fs.writeFileSync(source, JSON.stringify(design, null, 2), 'utf-8');

{
  const before = fs.readFileSync(source, 'utf-8');
  const result = await move('My Designs', 'Archive', 'AR VIS');
  ok(result.success, `the move succeeds, got error: ${result.error}`);
  ok(!fs.existsSync(source), 'the file leaves the old folder');
  ok(fs.existsSync(target), 'and appears in the new one');
  ok(fs.readFileSync(target, 'utf-8') === before, 'with its contents untouched');
  ok(readJsonSafe(target).id === 'design-1', 'the design keeps its id');
  ok(readJsonSafe(target).name === 'AR VIS', 'and its name');
}

{
  // The design is addressed on disk by its filename, so a name already taken in
  // the target would put one design on top of another.
  const other = path.join(projectsDir, 'My Designs', 'AR VIS.tfs');
  fs.writeFileSync(other, JSON.stringify({ id: 'design-2', name: 'AR VIS' }, null, 2), 'utf-8');
  const result = await move('My Designs', 'Archive', 'AR VIS');
  ok(!result.success, 'a name already taken in the target is refused');
  ok(result.error?.includes('already exists'), `and says why, got: ${result.error}`);
  ok(readJsonSafe(other).id === 'design-2', 'the design that would have moved is still there');
  ok(readJsonSafe(target).id === 'design-1', 'and the one it would have replaced is intact');
  fs.unlinkSync(other);
}

{
  const result = await move('My Designs', 'Archive', 'Not There');
  ok(!result.success, 'moving a design that is not on disk is refused');
  ok(result.error === 'File not found', `naming the reason, got: ${result.error}`);
}

{
  const result = await move('Archive', 'No Such Folder', 'AR VIS');
  ok(!result.success, 'a target folder that does not exist is refused');
  ok(result.error === 'Target folder does not exist', `naming the reason, got: ${result.error}`);
  ok(fs.existsSync(target), 'and the design stays where it was');
}

{
  const result = await move('Archive', 'Archive', 'AR VIS');
  ok(result.success, 'moving a design into the folder it is already in is a no-op');
  ok(fs.existsSync(target), 'and leaves it alone');
}

{
  // Folder and design names reach the filesystem, so they are sanitized to one
  // path component before they are joined.
  const result = await move('Archive', '..', 'AR VIS');
  ok(!result.success, 'a target folder that climbs out of Projects is refused');
  ok(fs.existsSync(target), 'and the design stays where it was');
  ok(!fs.existsSync(path.join(TMP, 'AR VIS.tfs')), 'nothing is written outside Projects');
}

{
  const escaped = await move('Archive', '../Escaped', 'AR VIS');
  ok(!escaped.success, 'a separator in the target folder name does not escape Projects');
  ok(!fs.existsSync(path.join(TMP, 'Escaped')), 'no folder is created outside Projects');
  ok(fs.existsSync(target), 'and the design is untouched');
}

fs.rmSync(TMP, { recursive: true, force: true });

// ── The drag source ──────────────────────────────────────────────────────────
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
  removeFolder: noop, moveItemsToFolder: noop,
  dirtyDesigns: {},
  c: makeTheme(), t: makeLocale(), onOpenDesign: noop,
}));
ok(markup.includes('draggable="true"'), 'design rows are drag sources');

console.log(`design_move_between_folders: ${passed} passed`);
