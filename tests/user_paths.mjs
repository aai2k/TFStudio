/**
 * Path registry for the configurable user-data folders (src/main/userPaths.js).
 *
 * Covers default resolution, override handling, the fallback when a configured
 * folder cannot be used, the live ctx getters the IPC handlers read through,
 * and that the traversal guard in safeFilePath still holds when it is rooted at
 * a configured (non-default) base.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { createUserPaths, FOLDER_KEYS } = require('../src/main/userPaths.js');
const { safeFilePath } = require('../src/main/paths.js');
const { writeMainOwnedKey, writeRendererSettings } = require('../src/main/settingsFile.js');
const { register: registerPathIpc } = require('../src/main/ipc/paths.js');

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

// In-memory fs. `unwritable` marks paths whose mkdir/write must fail, standing
// in for a read-only share or a disconnected drive.
function makeFs(unwritable = []) {
  const dirs = new Set();
  const files = new Map();
  const blocked = (p) => unwritable.some(bad => p === bad || p.startsWith(bad + path.win32.sep) || p.startsWith(bad + path.posix.sep));
  return {
    dirs,
    files,
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
  };
}

const DOCS = '/home/andrey/Documents';
const make = (unwritable) => {
  const fs = makeFs(unwritable);
  const logs = [];
  const paths = createUserPaths({ documentsDir: DOCS, fs, path: path.posix, log: (m) => logs.push(m) });
  return { paths, fs, logs };
};

// ── Defaults ────────────────────────────────────────────────────────────────
{
  const { paths } = make();
  ok(paths.get('projects') === `${DOCS}/TFStudio/Projects`, 'projects defaults under Documents/TFStudio');
  ok(paths.get('materials') === `${DOCS}/TFStudio/Materials`, 'materials default is unchanged');
  ok(paths.get('coatings') === `${DOCS}/TFStudio/Coatings`, 'coatings default is under Documents/TFStudio');
  ok(paths.get('meritFunctions') === `${DOCS}/TFStudio/MeritFunctions`, 'merit functions default is unchanged');
  ok(paths.get('qualifiers') === `${DOCS}/TFStudio/Qualifiers`, 'qualifiers default is unchanged');
  ok(paths.get('integrals') === `${DOCS}/TFStudio/IntegralPresets`, 'integral presets default is unchanged');
  ok(paths.get('reportPresets') === `${DOCS}/TFStudio/ReportPresets`, 'report presets default is unchanged');
  ok(paths.get('branding') === `${DOCS}/TFStudio/Branding`, 'branding default is unchanged');
  ok(paths.get('preferences') === `${DOCS}/TFStudio/Preferences`, 'preferences default is under Documents so it survives a reinstall');
  ok(FOLDER_KEYS.length === 9, 'nine configurable folders');
  ok(paths.list().every(entry => !entry.overridden), 'nothing is overridden on a fresh install');
  ok(Object.keys(paths.toSettings()).length === 0, 'an untouched install persists no folders block');
}

// ── Overrides from settings.json ────────────────────────────────────────────
{
  const { paths } = make();
  paths.loadOverrides({ projects: '/data/designs' });
  ok(paths.get('projects') === '/data/designs', 'a usable override is honoured');
  ok(paths.get('materials') === `${DOCS}/TFStudio/Materials`, 'other folders keep their defaults');
  const entry = paths.list().find(e => e.key === 'projects');
  ok(entry.overridden === true, 'list reports the override');
  ok(entry.defaultPath === `${DOCS}/TFStudio/Projects`, 'list still reports the default to fall back to');
  ok(paths.toSettings().projects === '/data/designs', 'only overridden keys are persisted');
}

// ── An unusable override falls back to the default ──────────────────────────
{
  const { paths, logs } = make(['/mnt/unplugged']);
  paths.loadOverrides({ projects: '/mnt/unplugged/designs', materials: '/data/mats' });
  ok(paths.get('projects') === `${DOCS}/TFStudio/Projects`, 'unusable override falls back to the default');
  ok(paths.get('materials') === '/data/mats', 'a sibling usable override is unaffected');
  const entry = paths.list().find(e => e.key === 'projects');
  ok(entry.overridden === false, 'a rejected override does not read as overridden');
  ok(entry.rejected && entry.rejected.configured === '/mnt/unplugged/designs', 'the rejected path is reported for the UI');
  ok(logs.some(m => m.includes('unusable')), 'the fallback is logged');
  ok(paths.toSettings().projects === undefined, 'a rejected override is not persisted back');
}

// ── Relative paths are refused ──────────────────────────────────────────────
{
  const { paths } = make();
  const result = paths.set('projects', 'designs');
  ok(result.success === false, 'a relative override is refused');
  ok(/absolute/.test(result.error), 'the refusal names the reason');
  ok(paths.get('projects') === `${DOCS}/TFStudio/Projects`, 'the folder is unchanged after a refused set');
  ok(paths.set('nonsense', '/tmp/x').success === false, 'an unknown key is refused');
  ok(paths.reset('nonsense').success === false, 'resetting an unknown key is refused');
}

// ── set / reset round trip ──────────────────────────────────────────────────
{
  const { paths } = make();
  ok(paths.set('branding', '/data/logos').success, 'set accepts a usable absolute path');
  ok(paths.get('branding') === '/data/logos', 'set takes effect immediately');
  ok(paths.reset('branding').success, 'reset succeeds');
  ok(paths.get('branding') === `${DOCS}/TFStudio/Branding`, 'reset restores the default');
  ok(Object.keys(paths.toSettings()).length === 0, 'reset clears the persisted override');
}

// ── Live ctx getters: the whole point of the refactor ───────────────────────
{
  const { paths } = make();
  const ctx = paths.defineCtxGetters({});
  ok(ctx.projectsDir === `${DOCS}/TFStudio/Projects`, 'ctx exposes the default');

  // A handler body destructures ctx per call; that must observe a later change.
  const readAsHandlerWould = () => { const { projectsDir } = ctx; return projectsDir; };
  ok(readAsHandlerWould() === `${DOCS}/TFStudio/Projects`, 'destructuring reads the current value');
  paths.set('projects', '/data/designs');
  ok(readAsHandlerWould() === '/data/designs', 'destructuring after a change reads the new value');
  ok(ctx.userDocsDir === `${DOCS}/TFStudio`, 'the base folder is exposed too');

  paths.set('meritFunctions', '/data/mf');
  ok(ctx.meritFunctionsDir === '/data/mf', 'every directory key is a live getter');
}

// ── ensureAll creates configured folders ────────────────────────────────────
{
  const { paths, fs } = make();
  paths.set('projects', '/data/designs');
  paths.ensureAll();
  ok(fs.dirs.has('/data/designs'), 'ensureAll creates the configured folder');
  ok(fs.dirs.has(`${DOCS}/TFStudio/Materials`), 'ensureAll creates the defaulted folders too');
}

// ── Folder overrides survive a renderer settings write ──────────────────────
// The renderer sends a fixed payload that does not carry `folders`, and it
// writes on every theme or locale change. Without the merge the user's folder
// configuration would be wiped the first time they switched theme.
{
  let stored = null;
  const ctx = {
    settingsPath: '/settings.json',
    readJsonSafe: () => (stored ? JSON.parse(stored) : null),
    writeFileAtomic: (_file, data) => { stored = data; },
  };

  writeMainOwnedKey(ctx, 'folders', { projects: '/data/designs' });
  ok(JSON.parse(stored).folders.projects === '/data/designs', 'folder overrides are persisted');

  writeRendererSettings(ctx, { theme: 'Dark', locale: 'ru' });
  const after = JSON.parse(stored);
  ok(after.theme === 'Dark', 'the renderer payload is written');
  ok(after.folders?.projects === '/data/designs', 'a renderer settings write preserves folder overrides');

  writeMainOwnedKey(ctx, 'folders', {});
  ok(JSON.parse(stored).folders === undefined, 'clearing every override removes the folders block');
  ok(JSON.parse(stored).theme === 'Dark', 'clearing folders leaves renderer settings intact');
}

// ── The traversal guard still holds against a configured base ───────────────
{
  const base = path.resolve('/data/designs');
  let threw = false;
  try { safeFilePath(base, '..', 'escaped.tfs'); } catch (_) { threw = true; }
  ok(threw, 'safeFilePath rejects .. against a configured base');
  ok(safeFilePath(base, 'ok.tfs') === path.join(base, 'ok.tfs'), 'safeFilePath still resolves a legitimate child');
}

// IPC path changes are transactional. A failed settings write must not leave
// live handlers pointing at a directory that will disappear after restart.
{
  const { paths } = make();
  paths.loadOverrides({ projects: '/data/old' });
  const handlers = {};
  let stored = { theme: 'Dark', folders: { projects: '/data/old' } };
  let failWrite = true;
  let changes = 0;
  let chooseOptions = null;
  const ctx = {
    userPaths: paths,
    settingsPath: '/settings.json',
    readJsonSafe: () => stored,
    writeFileAtomic: (_file, contents) => {
      if (failWrite) throw new Error('disk full');
      stored = JSON.parse(contents);
    },
    log: () => {},
    onUserPathsChanged: () => { changes++; },
    getMainWindow: () => null,
    dialog: {
      showOpenDialog: async (_window, options) => {
        chooseOptions = options;
        return { canceled: true, filePaths: [] };
      },
    },
    shell: { openPath: async () => '' },
  };
  registerPathIpc({ handle: (name, handler) => { handlers[name] = handler; } }, ctx);

  const failed = await handlers['paths:set'](null, 'projects', '/data/new');
  ok(failed.success === false && failed.error === 'disk full', 'a persistence failure is reported');
  ok(paths.get('projects') === '/data/old', 'a failed write restores the previous live path');
  ok(changes === 0, 'a failed write does not announce a path change');

  failWrite = false;
  const saved = await handlers['paths:set'](null, 'projects', '/data/new');
  ok(saved.success === true, 'a path change succeeds once settings can be written');
  ok(paths.get('projects') === '/data/new', 'a persisted path becomes the live path');
  ok(stored.folders.projects === '/data/new', 'the new live path is persisted');
  ok(changes === 1, 'a persisted path change is announced exactly once');

  await handlers['paths:choose'](null, 'projects');
  ok(chooseOptions.title === undefined, 'the folder picker uses the operating system localized title');
}

// The main-process registry is only half of a live switch: the renderer must
// reload the project/material data it already has in memory.
{
  const renderer = readFileSync(path.join(process.cwd(), 'src', 'renderer.js'), 'utf8');
  const pane = readFileSync(path.join(process.cwd(), 'src', 'components', 'dialogs',
    'settings', 'FoldersPane.js'), 'utf8');
  ok(renderer.includes('loadFoldersFromDisk({ restoreSession: false, restoreLayout: false })'),
    'switching Projects reloads the new root without restoring the old session');
  ok(renderer.includes("key === 'materials'") && renderer.includes('await loadCatalogsFromDisk()'),
    'switching Materials reloads the in-memory catalogs');
  ok(renderer.includes("key !== 'projects' || !Object.values(dirtyDesigns).some(Boolean)"),
    'a Projects switch is refused while any design is unsaved');
  ok(pane.includes('await onUserPathChanged?.(key)'),
    'the Folders pane waits for the affected renderer data to refresh');
}

console.log(`user_paths: ${passed} passed`);
