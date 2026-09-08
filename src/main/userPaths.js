/**
 * Where user data lives: one data folder, with nine subfolders under it.
 *
 * configuredRoot is what the user chose and rootDir is what the app is running
 * from. They differ when the chosen folder is unusable at startup, say a drive
 * that is not plugged in: the app falls back to Documents\TFStudio for the
 * session but keeps the choice, so the next start with the drive back uses it
 * again.
 *
 * CommonJS, Electron-free (deps injected) for testability.
 */

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

// probe: mkdir + write temp file + delete, verifies the directory is writable
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
    rejected: null,       // reason configuredRoot is temporarily unusable { configured, reason }
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

    const folders = cfg && cfg.folders;
    const configured = folders && folders.root;
    if (!configured) {
      // no configured root, use default
      state.configuredRoot = null;
      state.rootDir = baseDir;
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

    // mkdir + write probe (configuredRoot keeps original value, relative path persisted as-is)
    const probe = probeUsable(fs, path, resolved);
    if (probe.ok) {
      state.configuredRoot = configured;
      state.rootDir = resolved;
    } else {
      state.configuredRoot = configured;
      state.rejected = { configured, reason: probe.reason };
      state.rootDir = baseDir;
      log(`Folder root "${configured}" is unusable (${probe.reason}); using default ${baseDir}`);
    }

    // detect legacy keys (do not early-return just because root is valid)
    detectLegacyKeys(folders, log);
  }

  // detect legacy per-folder keys in folders other than root
  function detectLegacyKeys(folders, logFn) {
    if (!folders || typeof folders !== 'object') return;
    for (const key of Object.keys(folders)) {
      if (key === 'root') continue;
      logFn(`Legacy folder key "${key}" in settings is ignored and will be dropped on next write`);
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
    // read-only properties for external modules such as ipc/paths.js
    get baseDir() { return baseDir; },
    get rootDir() { return state.rootDir; },
    get configuredRoot() { return state.configuredRoot; },
    get rejected() { return state.rejected; },
  };
}

module.exports = { createUserPaths, FOLDER_SPECS };
