/**
 * Moving the data folder, end to end.
 *
 * The pieces are covered on their own elsewhere: the move engine in
 * data_folder_move.mjs, the transaction in ipc_paths_transaction.mjs (with a
 * stub engine), the settings merge in user_paths.mjs. Nothing runs them
 * together. This does: the real engine from dataFolderMove.js behind the real
 * paths:set / paths:reset handlers, real designs on disk, and the real
 * settings.json helpers from main/paths.js.
 *
 * What it holds to:
 *   - every file arrives byte for byte, including Cyrillic names, deep nesting
 *     and binary content
 *   - settings.json follows the move and the renderer's own keys survive it
 *   - the four targets that are refused leave the data and settings untouched
 *   - a folder on another volume goes by copy, and the old one is dropped after
 *     the settings are safely written
 *
 * Run: node tests/data_folder_end_to_end.mjs
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { createUserPaths } = require('../src/main/userPaths.js');
const { createDataFolderMove } = require('../src/main/dataFolderMove.js');
const { readJsonSafe, writeFileAtomic } = require('../src/main/paths.js');
const { register } = require('../src/main/ipc/paths.js');

// ── Assertion framework ──────────────────────────────────────────────────
let P = 0, F = 0;
function ok(c, m) { if (!c) { F++; console.error('FAIL:', m); } else P++; }

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dfe2e-'));
let seq = 0;

// ── A data folder with the kinds of content a real one carries ───────────
// Written under the nine subfolders ensureAll() has already created.
function seedData(root) {
  const designs = path.join(root, 'Projects', 'My Designs');
  fs.mkdirSync(designs, { recursive: true });
  fs.writeFileSync(path.join(designs, 'BBAR 400-700.tfs'),
    JSON.stringify({ tfs_version: '1.1', id: 'd1', name: 'BBAR 400-700', layers: [] }, null, 2), 'utf-8');
  // A Cyrillic name, which is what this user's own designs look like.
  fs.writeFileSync(path.join(designs, 'Просветление.tfs'),
    JSON.stringify({ tfs_version: '1.1', id: 'd2', name: 'Просветление', layers: [] }, null, 2), 'utf-8');

  // A second project folder, and one nested deeper than the app itself goes.
  const deep = path.join(root, 'Projects', 'Archive', '2026', 'Q3');
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, 'old.tfs'),
    JSON.stringify({ tfs_version: '1.0', id: 'd3', name: 'old' }, null, 2), 'utf-8');

  const userMaterials = path.join(root, 'Materials', 'user');
  fs.mkdirSync(userMaterials, { recursive: true });
  fs.writeFileSync(path.join(userMaterials, 'inhouse.catalog.json'), '{"materials":[]}', 'utf-8');

  // Binary content, so the check is not only about text.
  const bin = Buffer.alloc(4096);
  for (let i = 0; i < bin.length; i++) bin[i] = i % 256;
  fs.writeFileSync(path.join(root, 'Coatings', 'run.bin'), bin);

  // An empty subfolder, which a copy has to recreate to pass its own dirCount check.
  fs.mkdirSync(path.join(root, 'Qualifiers', 'empty'), { recursive: true });
}

// Every entry under a folder as a comparable line: directories by path, files
// by path, size and content hash.
function snapshot(root) {
  const out = [];
  (function walk(dir, rel) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { out.push(`d ${r}`); walk(full, r); }
      else {
        const buf = fs.readFileSync(full);
        out.push(`f ${r} ${buf.length} ${createHash('sha1').update(buf).digest('hex')}`);
      }
    }
  })(root, '');
  return out.join('\n');
}

/**
 * One app instance: its own Documents folder, its own settings.json outside the
 * data root, the real path helpers and the real move engine.
 *
 * @param {object} [opts]
 * @param {object} [opts.fs] file system handed to the engine and the handlers
 */
function makeApp(opts = {}) {
  const dir = path.join(TMP_ROOT, `app-${++seq}`);
  const documents = path.join(dir, 'Documents');
  const appData = path.join(dir, 'AppData');
  // The exe sits in its own folder. A data folder chosen underneath it is
  // recorded as a relative path for the portable build, which is a different
  // case from the one here; these targets are all outside it.
  const exeDir = path.join(dir, 'Program');
  fs.mkdirSync(documents, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(exeDir, { recursive: true });

  const settingsPath = path.join(appData, 'settings.json');
  // The renderer owns these; a data folder move must not disturb them.
  writeFileAtomic(settingsPath, JSON.stringify({ theme: 'Dark', locale: 'ru' }, null, 2), 'utf-8');

  const useFs = opts.fs || fs;
  const userPaths = createUserPaths({ documentsDir: documents, fs, path, exeDir });
  userPaths.load(readJsonSafe(settingsPath));
  userPaths.ensureAll();
  seedData(userPaths.rootDir);

  let reloads = 0;
  const ctx = userPaths.defineCtxGetters({
    fs: useFs, path, log: () => {},
    settingsPath, readJsonSafe, writeFileAtomic,
    userPaths,
    dataFolderMove: createDataFolderMove({ fs: useFs, path }),
    onUserPathsChanged: () => { reloads++; userPaths.ensureAll(); },
    dialog: { async showOpenDialog() { return { canceled: true }; } },
    getMainWindow: () => ({}),
    shell: { async openPath() { return ''; } },
  });

  const handlers = {};
  register({ handle(channel, fn) { handlers[channel] = fn; } }, ctx);

  return {
    dir, userPaths, settingsPath,
    invoke: (channel, ...args) => handlers[channel](null, ...args),
    settings: () => readJsonSafe(settingsPath),
    reloadCount: () => reloads,
    // A folder beside the data root, created empty like the picker's own
    // "New folder" button leaves it.
    emptyTarget: (name) => {
      const t = path.join(dir, name);
      fs.mkdirSync(t, { recursive: true });
      return t;
    },
  };
}

// rename always reports the two paths as being on different volumes.
function exdevFs() {
  return { ...fs, promises: new Proxy(fs.promises, {
    get(target, prop) {
      if (prop === 'rename') {
        return async () => { const e = new Error('EXDEV: cross-device link'); e.code = 'EXDEV'; throw e; };
      }
      return target[prop];
    },
  }) };
}

async function test() {
  // ── The ordinary move: an empty folder the user made in the picker ──────
  {
    const app = makeApp();
    const before = snapshot(app.userPaths.rootDir);
    const oldRoot = app.userPaths.rootDir;
    const target = app.emptyTarget('TFStudio Data');

    const r = await app.invoke('paths:set', null, target);
    ok(r.success, `the move succeeds, got error: ${r.error}`);
    ok(app.userPaths.rootDir === target, 'the app runs from the new folder');
    ok(!fs.existsSync(oldRoot), 'and the old one is gone');
    ok(snapshot(target) === before, 'every file arrived unchanged');
    ok(app.reloadCount() === 1, 'the renderer is told once');

    const s = app.settings();
    ok(s.folders?.root === target, 'settings point at the new folder');
    ok(s.theme === 'Dark' && s.locale === 'ru', 'and the renderer keys survived the write');
    ok(r.folders.overridden === true, 'the pane is told the folder is no longer the default');
  }

  // ── A folder that does not exist yet ───────────────────────────────────
  {
    const app = makeApp();
    const before = snapshot(app.userPaths.rootDir);
    const target = path.join(app.dir, 'Not Created Yet');
    ok(!fs.existsSync(target), 'setup: the target is not there');

    const r = await app.invoke('paths:set', null, target);
    ok(r.success, `a target that does not exist yet is created, got error: ${r.error}`);
    ok(snapshot(target) === before, 'and receives the data unchanged');
  }

  // ── Moved twice, then reset ────────────────────────────────────────────
  {
    const app = makeApp();
    const before = snapshot(app.userPaths.rootDir);
    const defaultRoot = app.userPaths.baseDir;

    const first = app.emptyTarget('First');
    ok((await app.invoke('paths:set', null, first)).success, 'the first move succeeds');
    const second = app.emptyTarget('Second');
    const r2 = await app.invoke('paths:set', null, second);
    ok(r2.success, `a second move succeeds, got error: ${r2.error}`);
    ok(!fs.existsSync(first), 'the folder in between is gone');
    ok(snapshot(second) === before, 'the data is still whole after two moves');

    const reset = await app.invoke('paths:reset');
    ok(reset.success, `reset moves it back, got error: ${reset.error}`);
    ok(app.userPaths.rootDir === defaultRoot, 'to the default folder');
    ok(snapshot(defaultRoot) === before, 'with the data intact');
    ok(!fs.existsSync(second), 'and nothing left where it was');

    const s = app.settings();
    ok(s.folders === undefined, 'the folders block is removed once the default is back');
    ok(s.theme === 'Dark', 'and the renderer keys are still there');
  }

  // ── A target with something already in it ──────────────────────────────
  {
    const app = makeApp();
    const before = snapshot(app.userPaths.rootDir);
    const root = app.userPaths.rootDir;
    const target = app.emptyTarget('Occupied');
    fs.writeFileSync(path.join(target, 'someone-elses.txt'), 'keep me', 'utf-8');

    const r = await app.invoke('paths:set', null, target);
    ok(!r.success, 'a target with files in it is refused');
    ok(r.error?.includes('not empty'), `and says why, got: ${r.error}`);
    ok(app.userPaths.rootDir === root, 'the app still runs from where it did');
    ok(snapshot(root) === before, 'the data was not touched');
    ok(fs.readFileSync(path.join(target, 'someone-elses.txt'), 'utf-8') === 'keep me',
      "and neither was the target's own file");
    ok(app.settings().folders === undefined, 'settings were not written');
  }

  // ── A target inside the data folder ────────────────────────────────────
  // The picker opens at the current root, so this is one double-click away.
  {
    const app = makeApp();
    const root = app.userPaths.rootDir;
    const before = snapshot(root);
    const inside = path.join(root, 'Coatings');

    const r = await app.invoke('paths:set', null, inside);
    ok(!r.success, 'a target inside the data folder is refused');
    ok(r.error?.includes('inside'), `and says why, got: ${r.error}`);
    ok(snapshot(root) === before, 'with the data untouched');
  }

  // ── The folder that contains the data folder ───────────────────────────
  {
    const app = makeApp();
    const root = app.userPaths.rootDir;
    const before = snapshot(root);
    const parent = path.dirname(root);

    const r = await app.invoke('paths:set', null, parent);
    ok(!r.success, 'the folder holding the data folder is refused');
    ok(r.error?.includes('inside'), `and says why, got: ${r.error}`);
    ok(snapshot(root) === before, 'with the data untouched');
  }

  // ── The folder it is already in ────────────────────────────────────────
  {
    const app = makeApp();
    const root = app.userPaths.rootDir;
    const before = snapshot(root);

    const r = await app.invoke('paths:set', null, root);
    ok(r.success, `choosing the current folder is allowed, got error: ${r.error}`);
    ok(app.userPaths.rootDir === root, 'the root does not change');
    ok(snapshot(root) === before, 'and the data is untouched');
  }

  // ── Another volume: copy, verify, then drop the old folder ─────────────
  {
    const app = makeApp({ fs: exdevFs() });
    const oldRoot = app.userPaths.rootDir;
    const before = snapshot(oldRoot);
    const target = app.emptyTarget('Other Volume');

    const r = await app.invoke('paths:set', null, target);
    ok(r.success, `a folder on another volume is copied, got error: ${r.error}`);
    ok(!r.warning, `and nothing is left to warn about, got: ${r.warning}`);
    ok(snapshot(target) === before, 'the copy matches the original byte for byte');
    ok(!fs.existsSync(oldRoot), 'and the old folder is dropped once settings are written');
    ok(app.settings().folders?.root === target, 'settings point at the copy');
  }

  // ── Reset when the default folder has been refilled ────────────────────
  // Another install, or an older version, recreates Documents\TFStudio while
  // the data lives elsewhere. Merging the two sets is what the empty-target
  // rule exists to prevent, so reset is refused and the data stays put.
  {
    const app = makeApp();
    const defaultRoot = app.userPaths.baseDir;
    const target = app.emptyTarget('Elsewhere');
    ok((await app.invoke('paths:set', null, target)).success, 'setup: the data is moved away');

    fs.mkdirSync(path.join(defaultRoot, 'Projects'), { recursive: true });
    fs.writeFileSync(path.join(defaultRoot, 'Projects', 'other.tfs'), '{}', 'utf-8');
    const before = snapshot(target);

    const r = await app.invoke('paths:reset');
    ok(!r.success, 'reset into a refilled default folder is refused');
    ok(r.error?.includes('not empty'), `and says why, got: ${r.error}`);
    ok(app.userPaths.rootDir === target, 'the app keeps running from the configured folder');
    ok(snapshot(target) === before, 'the data is untouched');
    ok(app.settings().folders?.root === target, 'and settings still point at it');
  }

  return { passed: P, failed: F };
}

test().then(({ passed, failed }) => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  console.log(`\ndata_folder_end_to_end: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('ERROR:', err.stack);
  process.exit(1);
});
