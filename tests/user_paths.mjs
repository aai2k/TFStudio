/**
 * The data folder registry (src/main/userPaths.js).
 *
 * Covers startup validation, what is persisted, the portable relative form,
 * the fallback when the configured folder cannot be used, the live ctx getters
 * the IPC handlers read through, and that the traversal guard in safeFilePath
 * still holds when it is rooted at a configured (non-default) base.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { createUserPaths, FOLDER_SPECS } = require('../src/main/userPaths.js');
const { safeFilePath } = require('../src/main/paths.js');
const { writeMainOwnedKey, writeRendererSettings } = require('../src/main/settingsFile.js');

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

// ── Helper: temp dir + real fs ──────────────────────────────────────────────
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'user-paths-test-'));

// A root whose parent is a file. mkdir there fails at once on every platform,
// which is what an unplugged drive looks like to the write probe.
const BLOCKING_FILE = path.join(TMP_ROOT, 'not-a-directory');
const BAD_ROOT = path.join(BLOCKING_FILE, 'TFStudio');
function makeBlockingFile() { fs.writeFileSync(BLOCKING_FILE, 'x'); }
makeBlockingFile();

function tmpDir(name) {
  const dir = path.join(TMP_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanTmp() {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  makeBlockingFile();
}

// POSIX paths for the cases that need no real file system.
const POSIX = path.posix;
const DOCS = '/home/test/Documents';
const BASE = DOCS + '/TFStudio';
const makePosix = (opts = {}) => {
  const inMemoryFs = makeInMemoryFs(opts.unwritable);
  const logs = [];
  const paths = createUserPaths({
    documentsDir: DOCS,
    fs: inMemoryFs,
    path: POSIX,
    exeDir: opts.exeDir || '/opt/app/bin',
    log: (m) => logs.push(m),
  });
  return { paths, fs: inMemoryFs, logs };
};

// Real fs, for load / ensureAll and anything else that must touch disk.
function makeReal(exeDir) {
  const docs = tmpDir('docs');
  const logs = [];
  const paths = createUserPaths({
    documentsDir: docs,
    fs,
    path,
    exeDir: exeDir || tmpDir('exe'),
    log: (m) => logs.push(m),
  });
  return { paths, logs, docs };
}

// `unwritable` marks paths whose mkdir/write must fail, standing in for a
// read-only share or a disconnected drive.
function makeInMemoryFs(unwritable = []) {
  const dirs = new Set();
  const files = new Map();
  const blocked = (p) => unwritable.some(bad =>
    p === bad || p.startsWith(bad + POSIX.sep) || p.startsWith(bad + '/')
  );
  return {
    existsSync(p) { return dirs.has(p) || files.has(p); },
    mkdirSync(p) {
      if (blocked(p)) throw new Error('EACCES: permission denied');
      dirs.add(p);
    },
    writeFileSync(p, data) {
      if (blocked(p)) throw new Error('EACCES: permission denied');
      files.set(p, data);
    },
    unlinkSync(p) { files.delete(p); },
    statSync(p) {
      if (!dirs.has(p) && !files.has(p)) throw new Error('ENOENT: no such file or directory ' + p);
      return { isDirectory: () => dirs.has(p) };
    },
  };
}

function posixJoin(...parts) { return POSIX.join(...parts); }
function posixDefault(subdir) { return posixJoin(BASE, subdir); }

// ── Defaults ────────────────────────────────────────────────────────────────
{
  const { paths } = makePosix();
  ok(paths.get('projects') === posixDefault('Projects'), 'projects default is correct');
  ok(paths.get('materials') === posixDefault('Materials'), 'materials default is correct');
  ok(paths.get('coatings') === posixDefault('Coatings'), 'coatings default is correct');
  ok(paths.get('meritFunctions') === posixDefault('MeritFunctions'), 'meritFunctions default is correct');
  ok(paths.get('qualifiers') === posixDefault('Qualifiers'), 'qualifiers default is correct');
  ok(paths.get('integrals') === posixDefault('IntegralPresets'), 'integrals default is correct');
  ok(paths.get('reportPresets') === posixDefault('ReportPresets'), 'reportPresets default is correct');
  ok(paths.get('branding') === posixDefault('Branding'), 'branding default is correct');
  ok(paths.get('preferences') === posixDefault('Preferences'), 'preferences default is correct');
  ok(FOLDER_SPECS.length === 9, 'there are nine subfolders');
  ok(paths.list().overridden === false, 'an untouched install is not overridden');
  ok(Object.keys(paths.toSettings()).length === 0, 'an untouched install persists no folders block');
}

// ── A configured root that exists and is writable is used ───────────────────
{
  const { paths } = makeReal();
  const customRoot = tmpDir('custom-root');
  paths.load({ folders: { root: customRoot } });
  ok(paths.rootDir === customRoot, 'the configured root is used');
  ok(paths.configuredRoot === customRoot, 'and recorded as configured');
  ok(paths.rejected === null, 'with nothing rejected');
  cleanTmp();
}

// ── A root that does not exist yet is created ───────────────────────────────
{
  const { paths } = makeReal();
  const parent = tmpDir('device-ok');
  const newRoot = path.join(parent, 'nonexistent');
  ok(!fs.existsSync(newRoot), 'setup: the target does not exist');
  paths.load({ folders: { root: newRoot } });
  ok(fs.existsSync(newRoot), 'load creates it');
  ok(paths.rootDir === newRoot, 'and uses it');
  ok(paths.rejected === null, 'with nothing rejected');
  cleanTmp();
}

// ── An unusable root falls back to the default ──────────────────────────────
{
  const { paths, logs } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.rootDir !== BAD_ROOT, 'an unusable root is not used');
  ok(paths.rejected !== null, 'it is rejected');
  ok(paths.rejected.configured === BAD_ROOT, 'the rejection names the configured path');
  ok(typeof paths.rejected.reason === 'string', 'and carries a reason');
  ok(logs.some(m => m.includes('unusable')), 'the fallback is logged');
  cleanTmp();
}

// ── The fallback keeps the configured root for the next start ───────────────
{
  const { paths } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.configuredRoot === BAD_ROOT, 'the choice survives the fallback');
  ok(paths.rootDir === paths.baseDir, 'while the session runs from the default');
  cleanTmp();
}

// ── A relative root resolves against the exe folder (portable build) ────────
{
  const exeDir = tmpDir('exe-rel');
  const relName = 'mydata';
  const expectedRoot = path.join(exeDir, relName);
  const { paths } = makeReal(exeDir);
  paths.load({ folders: { root: relName } });
  ok(paths.configuredRoot === relName, 'the relative form is kept as written');
  ok(paths.rootDir === expectedRoot, 'and resolves against exeDir');
  cleanTmp();
}

// ── Per-folder keys from 1.5 to 1.7 are ignored, with a log line ────────────
{
  const { paths, logs } = makeReal();
  const customRoot = tmpDir('legacy-ok');
  paths.load({ folders: { root: customRoot, projects: '/old/Projects', materials: '/old/Materials' } });
  ok(paths.rootDir === customRoot, 'a valid root is still used');
  ok(logs.some(m => m.includes('Legacy folder key "projects"')), 'the projects key is logged');
  ok(logs.some(m => m.includes('Legacy folder key "materials"')), 'the materials key is logged');
  cleanTmp();
}

// ── A later load clears an earlier rejection ────────────────────────────────
{
  const { paths } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.rejected !== null, 'setup: rejected');
  const goodRoot = tmpDir('second-load');
  paths.load({ folders: { root: goodRoot } });
  ok(paths.rejected === null, 'the rejection is cleared');
  ok(paths.rootDir === goodRoot, 'and the new root is used');
  cleanTmp();
}

// ── What toSettings writes ──────────────────────────────────────────────────
{
  const { paths } = makeReal();
  const customRoot = tmpDir('tosettings-custom');
  paths.load({ folders: { root: customRoot } });
  const s = paths.toSettings();
  ok(s.root === customRoot, 'a custom root is written');
  ok(Object.keys(s).length === 1, 'and nothing else');
  cleanTmp();
}
{
  const { paths } = makePosix();
  ok(Object.keys(paths.toSettings()).length === 0, 'the default writes no folders block');
}
{
  const { paths } = makeReal();
  const badRoot = BAD_ROOT;
  paths.load({ folders: { root: badRoot } });
  ok(paths.rootDir === paths.baseDir, 'setup: running from the default');
  const s = paths.toSettings();
  ok(s.root === badRoot, 'a rejected root is still written, so it is there after a restart');
  cleanTmp();
}

// ── applyRoot stores a path under the exe folder relative to it ─────────────
{
  const exeDir = tmpDir('exe-portable');
  const dataDir = path.join(exeDir, 'portable-data');
  fs.mkdirSync(dataDir, { recursive: true });
  const { paths } = makeReal(exeDir);
  paths.applyRoot(dataDir);
  const s = paths.toSettings();
  ok(s.root === 'portable-data', `a root under exeDir is stored relative, got: ${s.root}`);
  ok(paths.rootDir === dataDir, 'while rootDir stays absolute');
  cleanTmp();
}
{
  const exeDir = tmpDir('exe-abs');
  const absRoot = tmpDir('abs-root');
  const { paths } = makeReal(exeDir);
  paths.applyRoot(absRoot);
  const s = paths.toSettings();
  ok(s.root === absRoot, 'a root outside exeDir is stored absolute');
  ok(paths.rootDir === absRoot, 'and rootDir with it');
  cleanTmp();
}
{
  const { paths } = makePosix({ exeDir: '/opt/app/bin' });
  paths.applyRoot('/opt/app/bin/Projects');
  const s = paths.toSettings();
  ok(s.root === 'Projects', `the stored form is relative, got: ${s.root}`);
  ok(paths.rootDir === '/opt/app/bin/Projects', 'while rootDir stays absolute');
}

// ── The ctx getters follow the root as it changes ───────────────────────────
{
  const { paths } = makePosix();
  const ctx = paths.defineCtxGetters({});
  ok(ctx.projectsDir === posixDefault('Projects'), 'the getter starts at the default');

  const newRoot = '/data/new-root';
  paths.applyRoot(newRoot);
  ok(ctx.projectsDir === newRoot + '/Projects', 'projectsDir follows the new root');
  ok(ctx.materialsDir === newRoot + '/Materials', 'materialsDir follows');
  ok(ctx.coatingsDir === newRoot + '/Coatings', 'coatingsDir follows');
  ok(ctx.meritFunctionsDir === newRoot + '/MeritFunctions', 'meritFunctionsDir follows');
  ok(ctx.qualifiersDir === newRoot + '/Qualifiers', 'qualifiersDir follows');
  ok(ctx.integralsDir === newRoot + '/IntegralPresets', 'integralsDir follows');
  ok(ctx.reportPresetsDir === newRoot + '/ReportPresets', 'reportPresetsDir follows');
  ok(ctx.brandingDir === newRoot + '/Branding', 'brandingDir follows');
  ok(ctx.preferencesDir === newRoot + '/Preferences', 'preferencesDir follows');
}
{
  const { paths } = makePosix();
  const ctx = paths.defineCtxGetters({});
  ok(ctx.userDocsDir === BASE, 'userDocsDir starts at the default root');
  const newRoot = '/data/new-root';
  paths.applyRoot(newRoot);
  ok(ctx.userDocsDir === newRoot, 'and follows the active root');
}

// ── applyRoot clears a rejection ────────────────────────────────────────────
{
  const { paths } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.rejected !== null, 'setup: rejected');
  const newRoot = tmpDir('setroot-ok');
  paths.applyRoot(newRoot);
  ok(paths.rejected === null, 'the rejection is cleared');
  ok(paths.rootDir === newRoot, 'and the root is the new one');
  cleanTmp();
}
{
  const { paths } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.rejected !== null, 'setup: rejected');
  paths.applyRoot(paths.baseDir);
  ok(paths.rejected === null, 'applyRoot(default) clears the rejection');
  ok(paths.rootDir === paths.baseDir, 'the root is the default');
  ok(paths.configuredRoot === null, 'and there is no configured root left');
  cleanTmp();
}

// ── The next settings write drops the old per-folder keys ───────────────────
// toSettings writes { root } alone and writeMainOwnedKey replaces the whole
// folders block, so keys from 1.5 to 1.7 leave the file on the next write.
{
  let stored = null;
  const ctx = {
    settingsPath: '/settings.json',
    readJsonSafe: () => (stored ? JSON.parse(stored) : null),
    writeFileAtomic: (_file, data) => { stored = data; },
  };

  stored = JSON.stringify({
    folders: { root: '/data/root', projects: '/old/Projects', materials: '/old/Materials' },
    theme: 'Dark',
  });

  const { paths } = makePosix();
  paths.load({ folders: { root: '/data/root' } });
  const s = paths.toSettings();
  ok(s.root === '/data/root', 'toSettings carries the root');

  writeMainOwnedKey(ctx, 'folders', s);
  const after = JSON.parse(stored);
  ok(after.folders.root === '/data/root', 'the root is written');
  ok(after.folders.projects === undefined, 'the projects key is gone');
  ok(after.folders.materials === undefined, 'the materials key is gone');
  ok(after.theme === 'Dark', 'renderer settings are untouched');
}

// ── The data folder survives a renderer settings write ──────────────────────
// The renderer sends a fixed payload that does not carry `folders`, and it
// writes on every theme or locale change. Without the merge the user's data
// folder would be wiped the first time they switched theme.
{
  let stored = null;
  const ctx = {
    settingsPath: '/settings.json',
    readJsonSafe: () => (stored ? JSON.parse(stored) : null),
    writeFileAtomic: (_file, data) => { stored = data; },
  };

  writeMainOwnedKey(ctx, 'folders', { root: '/data/designs' });
  ok(JSON.parse(stored).folders.root === '/data/designs', 'the data folder is persisted');

  writeRendererSettings(ctx, { theme: 'Dark', locale: 'ru' });
  const after = JSON.parse(stored);
  ok(after.theme === 'Dark', 'the renderer payload is written');
  ok(after.folders?.root === '/data/designs', 'a renderer settings write preserves the folders block');

  writeMainOwnedKey(ctx, 'folders', {});
  ok(JSON.parse(stored).folders === undefined, 'returning to the default removes the folders block');
  ok(JSON.parse(stored).theme === 'Dark', 'and leaves renderer settings intact');
}

// ── The traversal guard still holds against a configured base ───────────────
{
  const base = path.resolve('/data/designs');
  let threw = false;
  try { safeFilePath(base, '..', 'escaped.tfs'); } catch (_) { threw = true; }
  ok(threw, 'safeFilePath rejects .. against a configured base');
  ok(safeFilePath(base, 'ok.tfs') === path.join(base, 'ok.tfs'), 'safeFilePath still resolves a legitimate child');
}

// ── ensureAll ───────────────────────────────────────────────────────────────
{
  const { paths } = makeReal();
  paths.ensureAll();
  for (const spec of FOLDER_SPECS) {
    ok(fs.existsSync(path.join(paths.rootDir, spec.subdir)), 'ensureAll creates ' + spec.subdir);
  }
  cleanTmp();
}
{
  const { paths } = makeReal();
  const customRoot = tmpDir('ensureall-custom');
  paths.load({ folders: { root: customRoot } });
  paths.ensureAll();
  for (const spec of FOLDER_SPECS) {
    ok(fs.existsSync(path.join(customRoot, spec.subdir)), 'ensureAll creates ' + spec.subdir + ' under a custom root');
  }
  cleanTmp();
}
{
  const { paths } = makeReal();
  paths.ensureAll();
  paths.ensureAll();
  for (const spec of FOLDER_SPECS) {
    ok(fs.existsSync(path.join(paths.rootDir, spec.subdir)), 'a second ensureAll leaves ' + spec.subdir + ' alone');
  }
  cleanTmp();
}

// ── What list() hands the settings pane ─────────────────────────────────────
{
  const { paths } = makePosix();
  const result = paths.list();
  ok(result.root === BASE, 'root is the active root');
  ok(result.defaultRoot === BASE, 'defaultRoot is the default');
  ok(result.configuredRoot === null, 'configuredRoot is empty by default');
  ok(result.overridden === false, 'overridden is false by default');
  ok(result.rejected === null, 'rejected is empty by default');
  ok(Array.isArray(result.subfolders), 'subfolders is a list');
  ok(result.subfolders.length === 9, 'of nine entries');
  const keys = result.subfolders.map(s => s.key);
  ok(keys.includes('coatings'), 'including coatings');
  ok(keys.includes('integrals'), 'including integrals');
  ok(keys.includes('reportPresets'), 'including reportPresets');
}

// ── Settings with nothing in them ───────────────────────────────────────────
{
  const { paths } = makeReal();
  paths.load({});
  ok(paths.rootDir === paths.baseDir, 'no folders block means the default root');
  ok(paths.configuredRoot === null, 'and no configured root');
  ok(paths.rejected === null, 'and nothing rejected');
  cleanTmp();
}
{
  const { paths } = makeReal();
  paths.load({ folders: {} });
  ok(paths.rootDir === paths.baseDir, 'an empty folders block means the default root');
  ok(paths.configuredRoot === null, 'and no configured root');
  cleanTmp();
}
{
  const { paths } = makeReal();
  paths.load(null);
  ok(paths.rootDir === paths.baseDir, 'no settings at all means the default root');
  cleanTmp();
}

// ── applyRoot is a plain assignment ─────────────────────────────────────────
{
  const { paths } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.rejected !== null, 'setup: rejected');
  paths.applyRoot('/data/new');
  ok(paths.rejected === null, 'applyRoot clears the rejection');
}
{
  const { paths } = makePosix();
  paths.applyRoot('/data/custom');
  ok(paths.configuredRoot === '/data/custom', 'a custom root is recorded');
  paths.applyRoot(BASE);
  ok(paths.configuredRoot === null, 'and going back to the default clears it');
}
{
  const { paths } = makePosix();
  paths.applyRoot('/impossible/path');
  ok(paths.rootDir === '/impossible/path', 'applyRoot does not validate; checkTarget already did');
}

// ── defaultPath against get ─────────────────────────────────────────────────
{
  const { paths } = makePosix();
  ok(paths.defaultPath('projects') === posixDefault('Projects'), 'defaultPath is the default root plus the subfolder');
  paths.applyRoot('/data/new');
  ok(paths.get('projects') === '/data/new/Projects', 'get is the active root plus the subfolder');
  ok(paths.defaultPath('projects') === posixDefault('Projects'), 'defaultPath does not move');
}

// ── Per-folder keys are logged even without a root ──────────────────────────
{
  const { paths, logs } = makeReal();
  paths.load({ folders: { projects: '/old/Projects' } });
  ok(logs.some(m => m.includes('Legacy folder key "projects"')), 'the key is logged');
  ok(paths.rootDir === paths.baseDir, 'and the default root is used');
  cleanTmp();
}

// ── A drive that comes and goes across restarts ─────────────────────────────
{
  const { paths } = makeReal();
  const goodRoot1 = tmpDir('multi-1');
  paths.load({ folders: { root: goodRoot1 } });
  ok(paths.rootDir === goodRoot1, 'first start: the configured root');
  ok(paths.rejected === null, 'nothing rejected');

  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.rootDir === paths.baseDir, 'second start: the drive is gone, run from the default');
  ok(paths.rejected !== null, 'and say why');

  const goodRoot2 = tmpDir('multi-2');
  paths.load({ folders: { root: goodRoot2 } });
  ok(paths.rootDir === goodRoot2, 'third start: the drive is back');
  ok(paths.rejected === null, 'and the rejection is gone');
  cleanTmp();
}

console.log('user_paths: ' + passed + ' passed');
process.exit(0);
