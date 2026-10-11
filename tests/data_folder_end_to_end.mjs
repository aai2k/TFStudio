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
 *   - a folder that does not exist yet is made by the move, and the next start
 *     runs from it
 *   - the folder in use is kept in settings at startup and after a move, and a
 *     default folder renamed away after that is reported at the next start
 *   - when Windows moves Documents and leaves the data folder behind, the next
 *     start keeps that folder as the chosen one and says so once
 *   - a start writes only what it records and leaves the rest of settings as
 *     it was, the per-folder paths of 1.5.0 to 1.7.2 and a chosen folder that
 *     is not there included, and writes nothing when it could not read them
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
const { writeRendererSettings } = require('../src/main/settingsFile.js');
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

// The next start of `app`, the way main.js starts: its settings as written are
// read by a fresh registry, which makes its folders, and registering the
// handlers records what was settled. `documentsDir` is where Documents points
// at that start; `readFails` stands for a read of settings.json that failed at
// load, the file being locked for a moment, which main.js hands on as null.
function restart(app, { documentsDir = path.join(app.dir, 'Documents'), readFails = false } = {}) {
  const userPaths = createUserPaths({ documentsDir, fs, path, exeDir: path.join(app.dir, 'Program') });
  userPaths.load(readFails ? null : app.settings());
  userPaths.ensureAll();
  register({ handle() {} }, {
    fs, userPaths, settingsPath: app.settingsPath, readJsonSafe, writeFileAtomic, log: () => {},
  });
  return userPaths;
}

// `app` with its settings.json replaced by `settings`, as an older release or
// a hand edit leaves it.
function withSettings(app, settings) {
  writeFileAtomic(app.settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  return app;
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

    // The startup check refuses to make a chosen folder that is missing; the
    // move made this one, so the next start finds it and uses it.
    const restarted = restart(app);
    ok(restarted.rootDir === target, `the next start runs from the new folder, got: ${restarted.rootDir}`);
    ok(restarted.rejected === null, `with nothing rejected, got: ${JSON.stringify(restarted.rejected)}`);
  }

  // ── The folder in use is kept for the next start ───────────────────────
  // It is what tells a default folder renamed away from one never made.
  {
    const app = makeApp();
    const defaultRoot = app.userPaths.baseDir;
    ok(app.settings().lastDataFolder === defaultRoot, `startup records the folder in use, got: ${app.settings().lastDataFolder}`);
    writeRendererSettings({ settingsPath: app.settingsPath, readJsonSafe, writeFileAtomic }, { theme: 'Light' });
    ok(app.settings().lastDataFolder === defaultRoot, 'a renderer settings write keeps it');

    const target = app.emptyTarget('Moved Here');
    ok((await app.invoke('paths:set', null, target)).success, 'setup: the data is moved');
    ok(app.settings().lastDataFolder === target, `a move records the new folder, got: ${app.settings().lastDataFolder}`);
  }
  {
    const app = makeApp();
    const defaultRoot = app.userPaths.baseDir;
    const restarted = restart(app);
    ok(restarted.takeNotices().length === 0, 'the next start with the default folder in place says nothing');

    const renamed = path.join(app.dir, 'Documents', 'TFStudio old');
    const before = snapshot(defaultRoot);
    fs.renameSync(defaultRoot, renamed);
    const afterRename = restart(app);
    const notices = afterRename.takeNotices();
    ok(notices.length === 1 && notices[0].code === 'createdEmpty' && notices[0].folder === defaultRoot,
      `a default folder renamed away is reported as made again empty, got: ${JSON.stringify(notices)}`);
    ok(snapshot(renamed) === before, 'and the renamed folder is left as it was');
  }

  // ── Documents moved, with the data folder left where it was ────────────
  // OneDrive backup stopped, or the Documents folder moved without its
  // content: Documents\TFStudio is a new place, and the last run's data is at
  // the old one.
  {
    const app = makeApp();
    const oldRoot = app.userPaths.baseDir;
    const before = snapshot(oldRoot);
    const movedDocuments = path.join(app.dir, 'Profile', 'Documents');
    fs.mkdirSync(movedDocuments, { recursive: true });

    const moved = restart(app, { documentsDir: movedDocuments });
    ok(moved.rootDir === oldRoot, `the data folder is kept, got: ${moved.rootDir}`);
    ok(app.settings().folders?.root === oldRoot, `settings record it as the chosen folder, got: ${JSON.stringify(app.settings().folders)}`);
    ok(moved.list().overridden && moved.list().root === oldRoot, 'so Preferences shows it');
    ok(!fs.existsSync(path.join(movedDocuments, 'TFStudio')), 'no empty folder is made where Documents points now');
    ok(snapshot(oldRoot) === before, 'and the data is untouched');
    const notices = moved.takeNotices();
    ok(notices.length === 1 && notices[0].code === 'documentsMoved'
      && notices[0].documents === movedDocuments && notices[0].folder === oldRoot,
    `the user is told where Documents points and which folder is kept, got: ${JSON.stringify(notices)}`);

    const next = restart(app, { documentsDir: movedDocuments });
    ok(next.rootDir === oldRoot && next.takeNotices().length === 0, 'the start after that runs from it and says nothing');
  }

  // ── A start writes only what it records ────────────────────────────────
  // The folders block of 1.5.0 to 1.7.2 held one path per folder; it is the
  // only record of where that data is, so a start and a renderer settings save
  // leave it as it is.
  {
    const perFolder = { projects: 'D:\\Work\\Projects', materials: 'D:\\Work\\Materials', coatings: 'D:\\Work\\Coatings' };
    const app = withSettings(makeApp(), { theme: 'Dark', folders: { ...perFolder } });
    restart(app);
    ok(JSON.stringify(app.settings().folders) === JSON.stringify(perFolder),
      `a start keeps the per-folder paths, got: ${JSON.stringify(app.settings().folders)}`);
    writeRendererSettings({ settingsPath: app.settingsPath, readJsonSafe, writeFileAtomic }, { theme: 'Light' });
    ok(JSON.stringify(app.settings().folders) === JSON.stringify(perFolder),
      `and so does a renderer settings save, got: ${JSON.stringify(app.settings().folders)}`);
  }
  // A data folder kept after Documents moved is added to the folders block,
  // beside the per-folder paths already there.
  {
    const perFolder = { projects: 'D:\\Work\\Projects' };
    const app = makeApp();
    const oldRoot = app.userPaths.baseDir;
    withSettings(app, { ...app.settings(), folders: { ...perFolder } });
    const movedDocuments = path.join(app.dir, 'Profile', 'Documents');
    fs.mkdirSync(movedDocuments, { recursive: true });
    restart(app, { documentsDir: movedDocuments });
    ok(JSON.stringify(app.settings().folders) === JSON.stringify({ ...perFolder, root: oldRoot }),
      `the kept folder is recorded and the per-folder paths stay, got: ${JSON.stringify(app.settings().folders)}`);
  }
  // A chosen folder that is not there stays in settings as it was, with
  // whatever else the folders block holds, so the next start tries it again.
  {
    const missing = path.join(TMP_ROOT, 'Unplugged', 'TFStudio');
    const folders = { root: missing, projects: 'D:\\Work\\Projects' };
    const app = withSettings(makeApp(), { theme: 'Dark', folders: { ...folders }, lastDataFolder: missing });
    const started = restart(app);
    ok(started.rootDir === started.baseDir, 'setup: the session runs from the default');
    ok(JSON.stringify(app.settings().folders) === JSON.stringify(folders),
      `the folders block is left as it was, got: ${JSON.stringify(app.settings().folders)}`);
    const portable = withSettings(makeApp(), { theme: 'Dark', folders: { root: 'Data' } });
    restart(portable);
    ok(portable.settings().folders?.root === 'Data', `a missing relative folder stays as written, got: ${JSON.stringify(portable.settings().folders)}`);
  }
  // A run whose default folder could not be made, Documents being out of
  // reach, records no folder as used: recorded, it would make the next start,
  // with Documents back, say the folder was renamed away. The last run's
  // record stands instead.
  {
    const dir = path.join(TMP_ROOT, `app-${++seq}`);
    const settingsPath = path.join(dir, 'AppData', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const documents = path.join(dir, 'Documents');
    const start = () => {
      const userPaths = createUserPaths({ documentsDir: documents, fs, path, exeDir: path.join(dir, 'Program') });
      userPaths.load(readJsonSafe(settingsPath));
      userPaths.ensureAll();
      register({ handle() {} }, { fs, userPaths, settingsPath, readJsonSafe, writeFileAtomic, log: () => {} });
      return userPaths;
    };
    fs.writeFileSync(documents, 'a file where Documents should be');
    const first = start();
    ok(first.takeNotices().some(n => n.code === 'defaultUnusable'), 'setup: the first run cannot use the default folder');
    ok(readJsonSafe(settingsPath)?.lastDataFolder === undefined,
      `no folder is recorded as used, got: ${readJsonSafe(settingsPath)?.lastDataFolder}`);
    fs.rmSync(documents);
    fs.mkdirSync(documents);
    const second = start();
    ok(second.takeNotices().length === 0, 'the next start, with Documents back, says nothing');

    const earlier = path.join(dir, 'Earlier', 'TFStudio');
    writeFileAtomic(settingsPath, JSON.stringify({ theme: 'Dark', lastDataFolder: earlier }), 'utf-8');
    fs.rmSync(documents, { recursive: true });
    fs.writeFileSync(documents, 'out of reach again');
    start();
    ok(readJsonSafe(settingsPath).lastDataFolder === earlier,
      `a run that cannot use the default folder keeps the last run's record, got: ${readJsonSafe(settingsPath).lastDataFolder}`);
  }
  // Settings read at load but out of reach when the startup write comes, the
  // file locked by then, are not written over either: written from nothing,
  // every other key would be lost.
  {
    const app = makeApp();
    const before = fs.readFileSync(app.settingsPath, 'utf-8');
    const userPaths = createUserPaths({ documentsDir: path.join(app.dir, 'Documents'), fs, path, exeDir: path.join(app.dir, 'Program') });
    userPaths.load(app.settings());
    userPaths.ensureAll();
    register({ handle() {} }, {
      fs, userPaths, settingsPath: app.settingsPath, readJsonSafe: () => null, writeFileAtomic, log: () => {},
    });
    ok(fs.readFileSync(app.settingsPath, 'utf-8') === before, 'a startup write that cannot read settings writes nothing over them');
  }
  // Settings that could not be read at load, the file locked for a moment, are
  // not written at startup: this run never saw what they hold.
  {
    const chosen = app => path.join(app.dir, 'Work', 'TFStudio');
    const app = makeApp();
    fs.mkdirSync(path.join(chosen(app), 'Projects'), { recursive: true });
    const before = { theme: 'Dark', folders: { root: chosen(app) }, lastDataFolder: chosen(app) };
    withSettings(app, before);
    restart(app, { readFails: true });
    ok(JSON.stringify(app.settings()) === JSON.stringify(before),
      `settings are left as they were on disk, got: ${JSON.stringify(app.settings())}`);
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
