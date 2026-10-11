/**
 * Where user data lives: one data folder, with nine subfolders under it.
 *
 * configuredRoot is what the user chose and rootDir is what the app is running
 * from. They differ when the chosen folder is unusable at startup, say a drive
 * that is not plugged in: the app falls back to Documents\TFStudio for the
 * session but keeps the choice, so the next start with the drive back uses it
 * again. A chosen folder that is not there at startup is passed over the same
 * way, and is not made again. With none chosen, a data folder left behind when
 * Windows moved Documents is kept as the chosen one (see dataFolderCheck.js).
 *
 * CommonJS, Electron-free (deps injected) for testability.
 */

const {
  settingsRoot, probeUsable, rejectedNotice, keptNotices, defaultGone, settle, folderToRecord,
} = require('./dataFolderCheck');

// The nine subfolders, with the names they carry under the data folder.
const FOLDER_SPECS = [
  { key: 'projects',       ctxKey: 'projectsDir',       subdir: 'Projects' },
  { key: 'materials',      ctxKey: 'materialsDir',      subdir: 'Materials' },
  { key: 'coatings',       ctxKey: 'coatingsDir',       subdir: 'Coatings' },
  { key: 'meritFunctions', ctxKey: 'meritFunctionsDir', subdir: 'MeritFunctions' },
  { key: 'qualifiers',     ctxKey: 'qualifiersDir',     subdir: 'Qualifiers' },
  { key: 'integrals',      ctxKey: 'integralsDir',      subdir: 'IntegralPresets' },
  { key: 'reportPresets',  ctxKey: 'reportPresetsDir',  subdir: 'ReportPresets' },
  { key: 'branding',       ctxKey: 'brandingDir',       subdir: 'Branding' },
  { key: 'preferences',    ctxKey: 'preferencesDir',    subdir: 'Preferences' },
];

/**
 * Build the path registry.
 *
 * @param {object} deps
 * @param {string} deps.documentsDir  OS documents folder (app.getPath('documents'))
 * @param {object} deps.fs            Node fs (injected for testing)
 * @param {object} deps.path          Node path (injected for testing)
 * @param {string} [deps.exeDir]      exe directory (used for portable relative resolution)
 * @param {Function} [deps.log]       log output
 */
function createUserPaths({ documentsDir, fs, path, exeDir, log = () => {} }) {
  const baseDir = path.join(documentsDir, 'TFStudio');
  const resolvedExeDir = exeDir || path.dirname(process.execPath);

  // ── Internal state ──────────────────────────────────────────────────
  const state = {
    baseDir,              // Documents\TFStudio (default root)
    configuredRoot: null, // root actually configured by the user in settings (null = default)
    rootDir: baseDir,     // root actually used for this run
    rejected: null,       // reason configuredRoot is temporarily unusable { configured, reason, code? }
    notices: [],          // what to tell the user at startup, until taken (see takeNotices)
    settling: false,      // load() ran and the next ensureAll settles the notices
    defaultWasGone: false, // the default folder, last used, was gone at load
    settingsRead: false,  // load() was given settings
    kept: null,           // a data folder kept after Windows moved Documents
    lastRecorded: undefined, // the folder the last run recorded as used
    defaultUnusable: false,  // the session runs from a default folder that cannot be used
  };

  // ── Derived paths ──────────────────────────────────────────────────
  function subdirPath(key) {
    const spec = FOLDER_SPECS.find(s => s.key === key);
    if (!spec) throw new Error(`unknown folder key: ${key}`);
    return path.join(state.rootDir, spec.subdir);
  }

  function defaultSubdirPath(key) {
    const spec = FOLDER_SPECS.find(s => s.key === key);
    if (!spec) throw new Error(`unknown folder key: ${key}`);
    return path.join(baseDir, spec.subdir);
  }

  // ── load(cfg): startup validation ─────────────────────────────────────
  function load(cfg) {
    // clear rejected before each load
    state.rejected = null;
    state.notices = [];
    state.settling = true;
    state.defaultWasGone = false;
    state.defaultUnusable = false;
    state.settingsRead = Boolean(cfg);

    const folders = cfg && cfg.folders;
    // null for the default, also when the choice names it in another spelling
    const settled = settingsRoot(fs, path, cfg, { exeDir: resolvedExeDir, defaultDir: baseDir, documentsDir });
    const configured = settled.root;
    state.kept = settled.kept;
    state.lastRecorded = settled.last;
    if (!configured) {
      // no configured root, use default
      state.configuredRoot = null;
      state.rootDir = baseDir;
      // read before ensureAll makes the default folder again
      state.defaultWasGone = defaultGone(fs, path, cfg, baseDir);
      // detect legacy keys
      detectLegacyKeys(folders, log);
      return;
    }

    // resolve relative paths against exeDir
    let resolved = configured;
    if (!path.isAbsolute(configured)) {
      resolved = path.resolve(resolvedExeDir, configured);
    }

    // verify absolute (resolve always yields absolute, but double-check)
    if (!path.isAbsolute(resolved)) {
      state.configuredRoot = configured;
      state.rejected = { configured, reason: 'path must be absolute' };
      state.rootDir = baseDir;
      log(`Folder root "${configured}" is not absolute; using default ${baseDir}`);
      detectLegacyKeys(folders, log);
      return;
    }

    // existence and write probe (configuredRoot keeps original value, relative path persisted as-is)
    const probe = probeUsable(fs, path, resolved);
    if (probe.ok) {
      state.configuredRoot = configured;
      state.rootDir = resolved;
      state.notices = keptNotices(settled.kept, documentsDir);
    } else {
      state.configuredRoot = configured;
      state.rejected = { configured, reason: probe.reason, code: probe.code };
      state.rootDir = baseDir;
      log(`Folder root "${configured}" is unusable (${probe.detail}); using default ${baseDir}`);
      // The notice names the folder as resolved, which for the portable build's
      // relative form is the place that was looked in.
      state.notices = [rejectedNotice(probe, resolved, baseDir)];
    }

    // detect legacy keys (do not early-return just because root is valid)
    detectLegacyKeys(folders, log);
  }

  // detect legacy per-folder keys in folders other than root
  function detectLegacyKeys(folders, logFn) {
    if (!folders || typeof folders !== 'object') return;
    for (const key of Object.keys(folders)) {
      if (key === 'root') continue;
      logFn(`Legacy folder key "${key}" in settings is ignored and kept; a data folder move or Reset writes the folders block without it`);
    }
  }

  // ── toSettings() ──────────────────────────────────────────────────────
  function toSettings() {
    return (state.configuredRoot && state.configuredRoot !== baseDir)
      ? { root: state.configuredRoot }
      : {};
  }

  // ── applyRoot(root) ───────────────────────────────────────────────────
  // For transaction coordination: rootDir = root; configuredRoot may be a relative path (portable); clear rejected
  function applyRoot(root) {
    state.rootDir = root;
    if (root === baseDir) {
      // back to default → no override
      state.configuredRoot = null;
    } else {
      // portable: when root is under exeDir, configuredRoot stores a relative path
      const rel = path.relative(resolvedExeDir, root);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        state.configuredRoot = rel;
      } else {
        state.configuredRoot = root;
      }
    }
    state.rejected = null;
  }

  // ── setRejected(configured, reason): narrow write of rejected (for critical branch) ──
  function setRejected(configured, reason) {
    state.rejected = { configured, reason };
  }

  // ── clearOverride(): clear configuredRoot (for fallback Reset) ────────
  function clearOverride() {
    state.configuredRoot = null;
    state.rejected = null;
  }

  // ── takeNotices(): what startup found that the user is told ───────────
  // The notices listed in dataFolderCheck.js, each shown; empty when there is
  // nothing to say. Handed over once, so a later load of the project tree,
  // after a data folder move, does not repeat them.
  function takeNotices() {
    const notices = state.notices;
    state.notices = [];
    return notices;
  }

  // ── startupRecord(): what this start records in settings ──────────────
  // `settingsRead` is whether load() was given settings; the folder used (see
  // folderToRecord, undefined to leave none) and where Documents points are
  // kept for the next start, and `kept` is a data folder kept after Windows
  // moved Documents, to be recorded as the chosen one.
  function startupRecord() {
    return {
      settingsRead: state.settingsRead,
      lastDataFolder: folderToRecord(state),
      lastDocuments: documentsDir,
      kept: state.kept,
    };
  }

  // ── get(key): rootDir + subdir ────────────────────────────────────────
  function get(key) {
    return subdirPath(key);
  }

  // ── defaultPath(key): baseDir + subdir ────────────────────────────────
  function defaultPath(key) {
    return defaultSubdirPath(key);
  }

  // ── list() ────────────────────────────────────────────────────────────
  function list() {
    const subfolders = FOLDER_SPECS.map(spec => {
      const p = path.join(state.rootDir, spec.subdir);
      let exists = false;
      try { exists = fs.statSync(p).isDirectory(); } catch (_) { /* does not exist */ }
      return { key: spec.key, path: p, exists };
    });
    return {
      root: state.rootDir,
      defaultRoot: baseDir,
      configuredRoot: state.configuredRoot,
      overridden: state.configuredRoot !== null && state.configuredRoot !== baseDir,
      rejected: state.rejected,
      subfolders,
    };
  }

  // ── ensureAll(): create the 9 subdirectories under the active rootDir ──
  function ensureAll() {
    for (const spec of FOLDER_SPECS) {
      const dir = path.join(state.rootDir, spec.subdir);
      if (fs.existsSync(dir)) continue;
      try { fs.mkdirSync(dir, { recursive: true }); log(`Created directory: ${dir}`); }
      catch (err) { log(`Failed to create ${dir}: ${err.message}`); }
    }
    // Once the folders are made, the startup notices are settled: whether the
    // default folder, if the session runs from it, can be used, and whether
    // one that was gone has been made again.
    if (state.settling) Object.assign(state, settle(fs, path, state));
    state.settling = false;
  }

  // ── defineCtxGetters(ctx) ─────────────────────────────────────────────
  // 9 subdirectory getters read rootDir + subdir live
  // userDocsDir returns the active rootDir (not configuredRoot)
  function defineCtxGetters(ctx) {
    for (const spec of FOLDER_SPECS) {
      Object.defineProperty(ctx, spec.ctxKey, {
        get: () => subdirPath(spec.key),
        enumerable: true,
      });
    }
    // userDocsDir returns the active rootDir
    Object.defineProperty(ctx, 'userDocsDir', {
      get: () => state.rootDir,
      enumerable: true,
    });
    return ctx;
  }

  return {
    get,
    defaultPath,
    list,
    load,
    toSettings,
    applyRoot,
    ensureAll,
    defineCtxGetters,
    setRejected,
    clearOverride,
    takeNotices,
    startupRecord,
    // read-only properties for external modules such as ipc/paths.js
    get baseDir() { return baseDir; },
    get rootDir() { return state.rootDir; },
    get configuredRoot() { return state.configuredRoot; },
    get rejected() { return state.rejected; },
  };
}

module.exports = { createUserPaths, FOLDER_SPECS };
