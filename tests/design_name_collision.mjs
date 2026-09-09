// Two designs must never share a .tfs file. The filename is derived from the
// design name and is also the key used to rename and delete a design, so a
// collision silently destroys one of them on save.
//
// Covers the renderer-side naming rules (designNaming.js) and the main-process
// save guard (ipc/projects.js).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { designFileKey, folderDesignNames, uniqueDesignName } from '../src/utils/io/designNaming.js';

const require = createRequire(import.meta.url);
const projects = require('../src/main/ipc/projects.js');

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

// ── File keys ───────────────────────────────────────────────────────────────
ok(designFileKey('BBAR') === designFileKey('bbar'), 'file key is case-insensitive');
ok(designFileKey('A/B') === designFileKey('A_B'), 'illegal characters sanitize to the same key');
ok(designFileKey('Design 2.') === designFileKey('Design 2'), 'trailing dot is ignored');
ok(designFileKey('Design 2 ') === designFileKey('Design 2'), 'trailing space is ignored');
ok(designFileKey('AR VIS') !== designFileKey('AR NIR'), 'distinct names keep distinct keys');

// ── The names a new design is checked against ───────────────────────────────
// One folder, not the whole tree: a folder is a directory, so the same name in
// two of them is two files and collides with nothing.
{
  const tree = [
    { id: 'vis', name: 'Visible', items: [{ id: 'd1', name: 'AR VIS' }, { id: 'd2', name: 'Cold mirror' }] },
    { id: 'ir', name: 'Infrared', items: [{ id: 'd3', name: 'Germanium AR' }] },
    { id: 'empty', name: 'Archive', items: [] },
  ];
  ok(folderDesignNames(tree, 'vis').join() === 'AR VIS,Cold mirror', 'the folder\'s own designs are listed');
  ok(folderDesignNames(tree, 'ir').join() === 'Germanium AR', 'and only its own');
  ok(folderDesignNames(tree, 'empty').length === 0, 'an empty folder has none');

  // A folder that cannot be resolved is a caller that lost track of it. An
  // empty list would read as "nothing is taken here" and let the caller create
  // a design over another one's file, so it throws instead.
  const throws = (call) => { try { call(); return false; } catch (_) { return true; } };
  ok(throws(() => folderDesignNames(tree, 'no-such-folder')), 'an unknown folder throws');
  ok(throws(() => folderDesignNames(tree, undefined)), 'a caller that forgot the folder throws');
  ok(throws(() => folderDesignNames(null, 'vis')), 'a missing tree throws');

  // The rule this file exists for, stated the other way round: a name taken in
  // another folder does not push a new design onto a suffix.
  ok(uniqueDesignName('Germanium AR', folderDesignNames(tree, 'vis'), (b, k) => `${b} ${k}`) === 'Germanium AR',
     'a name used in another folder is free here');
  ok(uniqueDesignName('AR VIS', folderDesignNames(tree, 'vis'), (b, k) => `${b} ${k}`) === 'AR VIS 2',
     'a name used in this folder is not');
}

// ── Every creation path names against a folder ──────────────────────────────
// The defect this rule replaced was that new, imported, duplicated and Save As
// designs were named against the whole tree while rename used one folder. A
// call site that drops the argument would put that back, so the calls are
// checked directly: folderDesignNames throws on an unresolved folder, but only
// once a user reaches that path.
{
  const renderer = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf-8');
  const calls = renderer.match(/existingDesignNames\([^)]*\)/g) || [];
  ok(calls.length === 6, `all six creation paths still call it, found ${calls.length}`);
  const bare = calls.filter(call => /existingDesignNames\(\s*\)/.test(call));
  ok(bare.length === 0, `every call names the folder it is adding to, found ${bare.length} without one`);

  // The default name counts within the folder, so each one numbers from 1.
  ok(/const n\s*=\s*taken\.length \+ 1/.test(renderer),
     'the "Design N" counter is of the target folder, not the whole tree');
}

// ── Unique names ────────────────────────────────────────────────────────────
const copySuffix = (b, k) => `${b} ${k}`;
ok(uniqueDesignName('AR', [], copySuffix) === 'AR', 'a free name is used as-is');
ok(uniqueDesignName('AR', ['AR'], copySuffix) === 'AR 2', 'a taken name gets the first free suffix');
ok(uniqueDesignName('AR', ['AR', 'AR 2'], copySuffix) === 'AR 3', 'suffixes keep counting');
ok(uniqueDesignName('A/B', ['A_B'], copySuffix) === 'A/B 2',
   'collision is detected through sanitization, not on the raw name');

// Duplicating the same design twice: both clones must reach different files.
const tree = ['AR VIS'];
const first = uniqueDesignName('AR VIS (copy)', tree, copySuffix);
tree.push(first);
const second = uniqueDesignName('AR VIS (copy)', tree, copySuffix);
ok(first === 'AR VIS (copy)' && second === 'AR VIS (copy) 2', 'a second duplicate is named apart');
ok(designFileKey(first) !== designFileKey(second), 'the two duplicates map to different files');

// Deleting a design and adding a new one must not reuse a live name: with
// "Design 1" and "Design 3" present the running count proposes "Design 3".
// The default-name path keeps counting up instead of adding a suffix.
const afterDelete = ['Design 1', 'Design 3'];
const nextDefault = (names) => {
    const n = names.length + 1;
    return uniqueDesignName(`Design ${n}`, names, (_, k) => `Design ${n + k - 1}`);
};
ok(nextDefault(afterDelete) === 'Design 4', 'a default name that is already taken counts up');
ok(nextDefault(['Design 1']) === 'Design 2', 'the default name is used unchanged when free');

// ── Main-process save guard ─────────────────────────────────────────────────
function makeHarness() {
  const files = new Map();
  const logs = [];
  const handlers = new Map();
  const dirs = new Set(['/projects', '/projects/My Designs']);
  const fs = {
    existsSync(p) { return dirs.has(p) || files.has(p); },
    mkdirSync(p) { dirs.add(p); },
    readdirSync(dir) {
      return [...files.keys()]
        .filter(f => path.posix.dirname(f) === dir)
        .map(f => path.posix.basename(f));
    },
    readFileSync(f) { return files.get(f); },
    unlinkSync(f) { files.delete(f); },
  };
  const ctx = {
    fs,
    path: path.posix,
    log(message) { logs.push(message); },
    projectsDir: '/projects',
    safeName(value) { return String(value).replace(/[<>:"/\\|?*]/g, '_'); },
    safeFilePath(base, ...parts) { return path.posix.join(base, ...parts); },
    writeFileAtomic(file, data) { files.set(file, data); },
    readJsonSafe(f) { try { return JSON.parse(files.get(f)); } catch (_) { return null; } },
  };
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  projects.register(ipcMain, ctx);
  return { files, handlers, logs };
}

const { files, handlers, logs } = makeHarness();
const save = (design) => handlers.get('save-design')(null, 'My Designs', design);
const FILE = '/projects/My Designs/AR VIS (copy).tfs';

ok((await save({ id: 'design-a', name: 'AR VIS (copy)', frontLayers: [] })).success, 'first design saves');
ok(JSON.parse(files.get(FILE)).id === 'design-a', 'the file holds the first design');

const clash = await save({ id: 'design-b', name: 'AR VIS (copy)', frontLayers: [] });
ok(clash.success === false, 'saving a different design to the same file is refused');
ok(JSON.parse(files.get(FILE)).id === 'design-a', 'the first design survives the refused save');
ok(logs.some(m => m.includes('refused to overwrite')), 'the refusal is logged');

ok((await save({ id: 'design-a', name: 'AR VIS (copy)', frontLayers: [{ d: 100 }] })).success,
   'a design still overwrites its own file');
ok(JSON.parse(files.get(FILE)).frontLayers.length === 1, 'its own update is written');

ok((await save({ id: 'design-b', name: 'AR VIS (copy) 2', frontLayers: [] })).success,
   'the disambiguated name saves');
ok(files.has('/projects/My Designs/AR VIS (copy) 2.tfs'), 'both designs now exist on disk');

console.log(`design_name_collision: ${passed} passed`);
