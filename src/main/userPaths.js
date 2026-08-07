// Registry of the user-data directories (designs, materials, presets, branding).
//
// Each folder has a default under the OS Documents folder and an optional
// user-chosen override persisted in settings.json. Consumers must read a
// directory through this registry on every call rather than caching the string,
// because an override can change while the app is running: an IPC handler
// holding a stale path writes successfully to the old location, and the user
// only notices when a saved preset does not appear where they asked for it.
//
// CommonJS, Electron-free (deps injected) so the resolution logic is testable.

// ctxKey is the name the IPC handlers already destructure off `ctx`; subdir is
// the folder name under Documents\TFStudio that has been the default since 1.0.
const FOLDER_SPECS = [
  { key: 'projects',       ctxKey: 'projectsDir',       subdir: 'Projects' },
  { key: 'materials',      ctxKey: 'materialsDir',      subdir: 'Materials' },
  { key: 'meritFunctions', ctxKey: 'meritFunctionsDir', subdir: 'MeritFunctions' },
  { key: 'qualifiers',     ctxKey: 'qualifiersDir',     subdir: 'Qualifiers' },
  { key: 'integrals',      ctxKey: 'integralsDir',      subdir: 'IntegralPresets' },
  { key: 'reportPresets',  ctxKey: 'reportPresetsDir',  subdir: 'ReportPresets' },
  { key: 'branding',       ctxKey: 'brandingDir',       subdir: 'Branding' },
];

const FOLDER_KEYS = FOLDER_SPECS.map(spec => spec.key);

// Probe whether a directory can actually be used: create it if missing, then
// write and remove a temp file. Existence alone is not enough — a path can
// resolve onto a read-only share or a disconnected drive letter.
function probeUsable(fs, path, dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'test', 'utf-8');
    fs.unlinkSync(probe);
    return { ok: true, dir };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// An override must be an absolute path — a relative one would resolve against
// the process working directory, which differs between a dev run and a packaged
// launch, so the same setting would point at two different places.
function validateOverride(state, dir) {
  if (typeof dir !== 'string' || dir.trim() === '') return { ok: false, reason: 'empty path' };
  if (!state.path.isAbsolute(dir)) return { ok: false, reason: 'path must be absolute' };
  return probeUsable(state.fs, state.path, dir);
}

function defaultPathFor(state, key) {
  const spec = FOLDER_SPECS.find(s => s.key === key);
  if (!spec) throw new Error(`unknown folder key: ${key}`);
  return state.path.join(state.baseDir, spec.subdir);
}

function currentPath(state, key) {
  return state.overrides.get(key) || defaultPathFor(state, key);
}

// Apply the `folders` block from settings.json. An override that no longer works
// (unplugged drive, revoked permission, deleted parent) falls back to the
// default rather than leaving the app with a dead directory; the reason is kept
// so the Settings pane can explain why the path on screen is not the configured
// one.
function loadOverrides(state, folders) {
  state.overrides.clear();
  state.rejected.clear();
  if (!folders || typeof folders !== 'object') return;
  for (const key of FOLDER_KEYS) {
    const configured = folders[key];
    if (!configured) continue;
    const result = validateOverride(state, configured);
    if (result.ok) {
      state.overrides.set(key, result.dir);
      continue;
    }
    state.rejected.set(key, { configured, reason: result.reason });
    state.log(`Folder override for "${key}" is unusable (${result.reason}); using ${defaultPathFor(state, key)}`);
  }
}

function setPath(state, key, dir) {
  if (!FOLDER_KEYS.includes(key)) return { success: false, error: `unknown folder key: ${key}` };
  const result = validateOverride(state, dir);
  if (!result.ok) return { success: false, error: result.reason };
  state.overrides.set(key, result.dir);
  state.rejected.delete(key);
  return { success: true, path: result.dir };
}

function resetPath(state, key) {
  if (!FOLDER_KEYS.includes(key)) return { success: false, error: `unknown folder key: ${key}` };
  state.overrides.delete(key);
  state.rejected.delete(key);
  return { success: true, path: defaultPathFor(state, key) };
}

// What the Settings pane renders: current path, the default it would fall back
// to, and the rejected override if one was dropped at startup.
function listFolders(state) {
  return FOLDER_KEYS.map(key => ({
    key,
    path: currentPath(state, key),
    defaultPath: defaultPathFor(state, key),
    overridden: state.overrides.has(key),
    rejected: state.rejected.get(key) || null,
  }));
}

// Create every configured directory. Called at startup and again after a change,
// so a newly chosen folder exists before anything writes into it.
function ensureAll(state) {
  for (const key of FOLDER_KEYS) {
    const dir = currentPath(state, key);
    if (state.fs.existsSync(dir)) continue;
    try { state.fs.mkdirSync(dir, { recursive: true }); state.log(`Created directory: ${dir}`); }
    catch (err) { state.log(`Failed to create ${dir}: ${err.message}`); }
  }
}

// Install live getters for the `ctx` bag handed to the IPC modules. Getters
// rather than values so `const { projectsDir } = ctx` inside a handler body
// reads the current path per call instead of one captured at registration time.
function defineCtxGetters(state, ctx) {
  for (const spec of FOLDER_SPECS) {
    Object.defineProperty(ctx, spec.ctxKey, {
      get: () => currentPath(state, spec.key),
      enumerable: true,
    });
  }
  Object.defineProperty(ctx, 'userDocsDir', { get: () => state.baseDir, enumerable: true });
  return ctx;
}

/**
 * Build the path registry.
 *
 * @param {object} deps
 * @param {string} deps.documentsDir  OS Documents folder (app.getPath('documents')).
 * @param {object} deps.fs            Node fs (injected for tests).
 * @param {object} deps.path          Node path (injected for tests).
 * @param {Function} [deps.log]       Diagnostic sink.
 */
function createUserPaths({ documentsDir, fs, path, log = () => {} }) {
  const state = {
    fs,
    path,
    log,
    baseDir: path.join(documentsDir, 'TFStudio'),
    overrides: new Map(),   // key → absolute path the user chose
    rejected: new Map(),    // key → why the override could not be used
  };

  return {
    baseDir: state.baseDir,
    get: (key) => currentPath(state, key),
    defaultPath: (key) => defaultPathFor(state, key),
    set: (key, dir) => setPath(state, key, dir),
    reset: (key) => resetPath(state, key),
    list: () => listFolders(state),
    loadOverrides: (folders) => loadOverrides(state, folders),
    // Only keys the user actually overrode, so an untouched install writes
    // nothing and keeps following the OS Documents path even if that moves.
    toSettings: () => Object.fromEntries(state.overrides),
    ensureAll: () => ensureAll(state),
    defineCtxGetters: (ctx) => defineCtxGetters(state, ctx),
  };
}

module.exports = { createUserPaths, FOLDER_KEYS, FOLDER_SPECS };
