// 数据目录注册表（单一 Data Folder 模型，issue #75 收敛版）。
//
// 新模型只保留一个 optional root，替代所有 per-folder overrides。
// 每个子目录解析为 rootDir + subdir。
// 配置的根目录（configuredRoot）与实际使用的根目录（rootDir）分离——
// fallback 期间不清 configuredRoot，确保设备恢复后可重新加载。
//
// CommonJS, Electron-free (deps injected) 以便测试。

// 目标基线：1.7.2/main 的 FOLDER_SPECS（9 项，含 Coatings）
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

// probe：mkdir + 写临时文件 + 删除，验证目录可写
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
 * 构建路径注册表。
 *
 * @param {object} deps
 * @param {string} deps.documentsDir  OS 文档文件夹（app.getPath('documents')）
 * @param {object} deps.fs            Node fs（注入供测试）
 * @param {object} deps.path          Node path（注入供测试）
 * @param {string} [deps.exeDir]      exe 所在目录（portable relative 解析用）
 * @param {Function} [deps.log]       日志输出
 */
function createUserPaths({ documentsDir, fs, path, exeDir, log = () => {} }) {
  const baseDir = path.join(documentsDir, 'TFStudio');
  const resolvedExeDir = exeDir || path.dirname(process.execPath);

  // ── 内部状态 ──────────────────────────────────────────────────────────
  const state = {
    baseDir,              // Documents\TFStudio（默认根目录）
    configuredRoot: null, // settings 中用户真正配置的 root（null = 默认）
    rootDir: baseDir,     // 当前本次运行实际使用的 root
    rejected: null,       // configuredRoot 暂不可用的原因 { configured, reason }
  };

  // ── 派生路径 ──────────────────────────────────────────────────────────
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

  // ── load(cfg)：startup validation ─────────────────────────────────────
  function load(cfg) {
    // 每次 load 前清 rejected
    state.rejected = null;

    const folders = cfg && cfg.folders;
    const configured = folders && folders.root;
    if (!configured) {
      // 没有配置 root，使用默认
      state.configuredRoot = null;
      state.rootDir = baseDir;
      // 检测 legacy keys
      detectLegacyKeys(folders, log);
      return;
    }

    // 相对路径则相对 exeDir resolve
    let resolved = configured;
    if (!path.isAbsolute(configured)) {
      resolved = path.resolve(resolvedExeDir, configured);
    }

    // 验证 absolute（resolve 后一定绝对，但双重检查）
    if (!path.isAbsolute(resolved)) {
      state.configuredRoot = configured;
      state.rejected = { configured, reason: 'path must be absolute' };
      state.rootDir = baseDir;
      log(`Folder root "${configured}" is not absolute; using default ${baseDir}`);
      detectLegacyKeys(folders, log);
      return;
    }

    // mkdir + write probe（configuredRoot 保留原始值，相对路径原样持久化）
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

    // 检测 legacy keys（不因 root 有效就提前 return）
    detectLegacyKeys(folders, log);
  }

  // 检测 folders 中除 root 外的 legacy per-folder keys
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
  // 供事务协调用：rootDir = root；configuredRoot 可能是相对路径（portable §11）；清 rejected
  function applyRoot(root) {
    state.rootDir = root;
    if (root === baseDir) {
      // 回到默认 → 无覆盖
      state.configuredRoot = null;
    } else {
      // portable（§11）：root 在 exeDir 下时 configuredRoot 存相对路径
      const rel = path.relative(resolvedExeDir, root);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        state.configuredRoot = rel;
      } else {
        state.configuredRoot = root;
      }
    }
    state.rejected = null;
  }

  // ── setRoot(dir)：纯内部赋值（无验证），供事务协调用 ──────────────────
  function setRoot(dir) {
    state.rootDir = dir;
    if (dir === baseDir) {
      // 回到默认 → 无覆盖
      state.configuredRoot = null;
    } else {
      // portable（§11）：dir 在 exeDir 下时 configuredRoot 存相对路径
      const rel = path.relative(resolvedExeDir, dir);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        state.configuredRoot = rel;
      } else {
        state.configuredRoot = dir;
      }
    }
    state.rejected = null;
    return { success: true };
  }

  // ── setRejected(configured, reason)：窄写 rejected（供 critical 分支调用）──
  function setRejected(configured, reason) {
    state.rejected = { configured, reason };
  }

  // ── clearOverride()：清 configuredRoot（fallback Reset 用）───────────
  function clearOverride() {
    state.configuredRoot = null;
    state.rejected = null;
  }

  // ── get(key)：rootDir + subdir ────────────────────────────────────────
  function get(key) {
    return subdirPath(key);
  }

  // ── defaultPath(key)：baseDir + subdir ────────────────────────────────
  function defaultPath(key) {
    return defaultSubdirPath(key);
  }

  // ── list() ────────────────────────────────────────────────────────────
  function list() {
    const subfolders = FOLDER_SPECS.map(spec => {
      const p = path.join(state.rootDir, spec.subdir);
      let exists = false;
      try { exists = fs.statSync(p).isDirectory(); } catch (_) { /* 不存在 */ }
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

  // ── ensureAll()：创建 active rootDir 的 9 个子目录 ───────────────────
  function ensureAll() {
    for (const spec of FOLDER_SPECS) {
      const dir = path.join(state.rootDir, spec.subdir);
      if (fs.existsSync(dir)) continue;
      try { fs.mkdirSync(dir, { recursive: true }); log(`Created directory: ${dir}`); }
      catch (err) { log(`Failed to create ${dir}: ${err.message}`); }
    }
  }

  // ── defineCtxGetters(ctx) ─────────────────────────────────────────────
  // 9 个子目录 getter 活读取 rootDir + subdir
  // userDocsDir 返回 active rootDir（不是 configuredRoot）
  function defineCtxGetters(ctx) {
    for (const spec of FOLDER_SPECS) {
      Object.defineProperty(ctx, spec.ctxKey, {
        get: () => subdirPath(spec.key),
        enumerable: true,
      });
    }
    // userDocsDir 返回 active rootDir
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
    setRoot,
    ensureAll,
    defineCtxGetters,
    setRejected,
    clearOverride,
    // 供 ipc/paths.js 等外部模块直接访问的只读属性
    get baseDir() { return baseDir; },
    get rootDir() { return state.rootDir; },
    get configuredRoot() { return state.configuredRoot; },
    get rejected() { return state.rejected; },
  };
}

module.exports = { createUserPaths, FOLDER_SPECS };
