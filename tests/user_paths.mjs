/**
 * 单一 Data Folder 模型测试（src/main/userPaths.js，issue #75 收敛版）。
 *
 * 覆盖：startup validation (load)、toSettings、applyRoot/setRoot、
 * defineCtxGetters、ensureAll、legacy keys 检测、fallback 行为。
 *
 * ESM + createRequire 加载 CJS 模块。用真实 fs + os.tmpdir() 建临时目录，用完清理。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { createUserPaths, FOLDER_SPECS } = require('../src/main/userPaths.js');
const { writeMainOwnedKey } = require('../src/main/settingsFile.js');

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

// ── 辅助：临时目录 + 真实 fs ──────────────────────────────────────────────
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'user-paths-test-'));

function tmpDir(name) {
  const dir = path.join(TMP_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanTmp() {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
}

// POSIX path 用于不需要实际文件系统操作的纯逻辑测试
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

// 真实 fs（用于 load/ensureAll 等需要真实 IO 的测试）
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

// ── 内存 fs（用于纯逻辑测试）──────────────────────────────────────────────
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

// 辅助：拼接 POSIX 路径
function posixJoin(...parts) { return POSIX.join(...parts); }
function posixDefault(subdir) { return posixJoin(BASE, subdir); }

// ═══════════════════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. defaults ───────────────────────────────────────────────────────
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
  ok(FOLDER_SPECS.length === 9, 'FOLDER_SPECS has 9 entries');
  ok(paths.list().overridden === false, 'not overridden by default');
  ok(Object.keys(paths.toSettings()).length === 0, 'toSettings returns {} by default');
}

// ── 2. configured root 非空且可用 → accepted ────────────────────────────
{
  const { paths } = makeReal();
  const customRoot = tmpDir('custom-root');
  paths.load({ folders: { root: customRoot } });
  ok(paths.rootDir === customRoot, 'load 可用 root → rootDir 设为 configured');
  ok(paths.configuredRoot === customRoot, 'load 可用 root → configuredRoot 设为该路径');
  ok(paths.rejected === null, 'load 可用 root → rejected 为 null');
  cleanTmp();
}

// ── 3. 路径不存在但设备可用（mkdir+probe 成功）→ accepted ────────────────
{
  const { paths } = makeReal();
  const parent = tmpDir('device-ok');
  const newRoot = path.join(parent, 'nonexistent');
  // 确保路径不存在
  ok(!fs.existsSync(newRoot), 'setup: 目标路径不存在');
  paths.load({ folders: { root: newRoot } });
  ok(fs.existsSync(newRoot), 'mkdir 成功创建了目标路径');
  ok(paths.rootDir === newRoot, 'mkdir+probe 成功 → accepted');
  ok(paths.rejected === null, 'mkdir+probe 成功 → 无 rejected');
  cleanTmp();
}

// ── 4. USB 不可用（mkdir/probe 失败）→ rejected + fallback ──────────────
{
  const { paths, logs } = makeReal();
  const badRoot = 'Q:\\TFStudio';
  paths.load({ folders: { root: badRoot } });
  ok(paths.rootDir !== badRoot, '不可用 root → fallback 到默认');
  ok(paths.rejected !== null, '不可用 root → rejected 非空');
  ok(paths.rejected.configured === badRoot, 'rejected 记录了配置的路径');
  ok(typeof paths.rejected.reason === 'string', 'rejected 记录了原因');
  ok(logs.some(m => m.includes('unusable')), 'fallback 被记录到日志');
  cleanTmp();
}

// ── 5. configuredRoot 不因 fallback 丢失 ────────────────────────────────
{
  const { paths } = makeReal();
  const badRoot = 'Q:\\Missing\\Drive';
  paths.load({ folders: { root: badRoot } });
  ok(paths.configuredRoot === badRoot, 'fallback 期间 configuredRoot 保留配置值');
  ok(paths.rootDir === paths.baseDir, 'fallback 期间 rootDir 使用 baseDir');
  cleanTmp();
}

// ── 6. relative root 按 exeDir resolve ──────────────────────────────────
{
  const exeDir = tmpDir('exe-rel');
  const relName = 'mydata';
  const expectedRoot = path.join(exeDir, relName);
  const { paths } = makeReal(exeDir);
  // 使用相对路径：相对于 exeDir resolve
  paths.load({ folders: { root: relName } });
  ok(paths.configuredRoot === relName, '相对路径保存为原始值');
  ok(paths.rootDir === expectedRoot, '相对路径按 exeDir resolve');
  cleanTmp();
}

// ── 7. legacy keys 检测 + log（不阻断有效 root）─────────────────────────
{
  const { paths, logs } = makeReal();
  const customRoot = tmpDir('legacy-ok');
  paths.load({ folders: { root: customRoot, projects: '/old/Projects', materials: '/old/Materials' } });
  ok(paths.rootDir === customRoot, 'legacy keys 不阻断有效 root');
  ok(logs.some(m => m.includes('Legacy folder key "projects"')), 'legacy projects 被检测到并记录日志');
  ok(logs.some(m => m.includes('Legacy folder key "materials"')), 'legacy materials 被检测到并记录日志');
  cleanTmp();
}

// ── 8. 第二次 load 清理第一次 rejected ──────────────────────────────────
{
  const { paths } = makeReal();
  // 第一次：不可用 root → rejected
  paths.load({ folders: { root: 'Q:\\Bad' } });
  ok(paths.rejected !== null, '第一次 load 后 rejected 非空');
  // 第二次：有效 root → rejected 被清
  const goodRoot = tmpDir('second-load');
  paths.load({ folders: { root: goodRoot } });
  ok(paths.rejected === null, '第二次 load 清理了 rejected');
  ok(paths.rootDir === goodRoot, '第二次 load rootDir 更新');
  cleanTmp();
}

// ── 9. toSettings：custom root → { root } ──────────────────────────────
{
  const { paths } = makeReal();
  const customRoot = tmpDir('tosettings-custom');
  paths.load({ folders: { root: customRoot } });
  const s = paths.toSettings();
  ok(s.root === customRoot, 'toSettings 输出 custom root');
  ok(Object.keys(s).length === 1, 'toSettings 只含 root 键');
  cleanTmp();
}

// ── 10. toSettings：default → {} ────────────────────────────────────────
{
  const { paths } = makePosix();
  ok(Object.keys(paths.toSettings()).length === 0, '默认 toSettings 返回 {}');
}

// ── 11. toSettings：fallback 期间仍写 configuredRoot ───────────────────
{
  const { paths } = makeReal();
  const badRoot = 'Q:\\TFStudio';
  const customRoot = tmpDir('tosettings-fallback');
  // 加载不可用 root → fallback
  paths.load({ folders: { root: badRoot } });
  ok(paths.rootDir === paths.baseDir, 'fallback 期间 rootDir = baseDir');
  // toSettings 应仍写 configuredRoot（不因 fallback 误删）
  const s = paths.toSettings();
  ok(s.root === badRoot, 'fallback 期间 toSettings 仍写 configuredRoot');
  cleanTmp();
}

// ── 12. setRoot(exeDir 内) → toSettings 输出相对路径（P1-3 portable §11）─
{
  const exeDir = tmpDir('exe-portable');
  const dataDir = path.join(exeDir, 'portable-data');
  fs.mkdirSync(dataDir, { recursive: true });
  const { paths } = makeReal(exeDir);
  // setRoot 设置一个位于 exeDir 下的路径
  paths.setRoot(dataDir);
  const s = paths.toSettings();
  const expectedRel = 'portable-data';
  ok(s.root === expectedRel, `setRoot(exeDir 内) → toSettings 输出相对路径 '${expectedRel}'，got: ${s.root}`);
  // rootDir 仍存绝对路径
  ok(paths.rootDir === dataDir, 'rootDir 仍存绝对路径');
  cleanTmp();
}

// ── 13. setRoot(escape exeDir) → toSettings 输出绝对路径 ─────────────────
{
  const exeDir = tmpDir('exe-abs');
  const absRoot = tmpDir('abs-root');
  const { paths } = makeReal(exeDir);
  paths.setRoot(absRoot);
  const s = paths.toSettings();
  ok(s.root === absRoot, 'escape exeDir → toSettings 输出绝对路径');
  ok(paths.rootDir === absRoot, 'rootDir 仍存绝对路径');
  cleanTmp();
}

// ── 13b. applyRoot(exeDir 内) → toSettings 输出相对路径 ──────────────────
{
  const exeDir = '/opt/app/bin';
  const { paths } = makePosix({ exeDir });
  // 模拟 applyRoot 设置一个位于 exeDir 下的路径
  paths.applyRoot('/opt/app/bin/Projects');
  const s = paths.toSettings();
  ok(s.root === 'Projects', `applyRoot(exeDir 内) → toSettings 输出 'Projects'，got: ${s.root}`);
  ok(paths.rootDir === '/opt/app/bin/Projects', 'rootDir 仍存绝对路径');
}

// ── 14. applyRoot 后 getter 实时变化 ───────────────────────────────────
{
  const { paths } = makePosix();
  const ctx = paths.defineCtxGetters({});
  ok(ctx.projectsDir === posixDefault('Projects'), 'applyRoot 前 getter 返回默认路径');

  const newRoot = '/data/new-root';
  paths.applyRoot(newRoot);
  ok(ctx.projectsDir === newRoot + '/Projects', 'applyRoot 后 projectsDir 实时变化');
  ok(ctx.materialsDir === newRoot + '/Materials', 'materialsDir 随 applyRoot 变化');
  ok(ctx.coatingsDir === newRoot + '/Coatings', 'coatingsDir 随 applyRoot 变化');
  ok(ctx.meritFunctionsDir === newRoot + '/MeritFunctions', 'meritFunctionsDir 随 applyRoot 变化');
  ok(ctx.qualifiersDir === newRoot + '/Qualifiers', 'qualifiersDir 随 applyRoot 变化');
  ok(ctx.integralsDir === newRoot + '/IntegralPresets', 'integralsDir 随 applyRoot 变化');
  ok(ctx.reportPresetsDir === newRoot + '/ReportPresets', 'reportPresetsDir 随 applyRoot 变化');
  ok(ctx.brandingDir === newRoot + '/Branding', 'brandingDir 随 applyRoot 变化');
  ok(ctx.preferencesDir === newRoot + '/Preferences', 'preferencesDir 随 applyRoot 变化');
}

// ── 15. userDocsDir = active rootDir ────────────────────────────────────
{
  const { paths } = makePosix();
  const ctx = paths.defineCtxGetters({});
  ok(ctx.userDocsDir === BASE, 'userDocsDir 默认 = baseDir');

  const newRoot = '/data/new-root';
  paths.applyRoot(newRoot);
  ok(ctx.userDocsDir === newRoot, 'applyRoot 后 userDocsDir = active rootDir');
}

// ── 16. setRoot 后清 rejected ──────────────────────────────────────────
{
  const { paths } = makeReal();
  // 先制造 rejected
  paths.load({ folders: { root: 'Q:\\Bad' } });
  ok(paths.rejected !== null, 'setup: rejected 非空');

  // setRoot（纯内部赋值）
  const newRoot = tmpDir('setroot-ok');
  paths.setRoot(newRoot);
  ok(paths.rejected === null, 'setRoot 后 rejected 被清');
  ok(paths.rootDir === newRoot, 'setRoot 后 rootDir 更新');
  cleanTmp();
}

// ── 17. applyRoot(baseDir) 后清 rejected ──────────────────────────────
{
  const { paths } = makeReal();
  // 先制造 rejected
  paths.load({ folders: { root: 'Q:\\Bad' } });
  ok(paths.rejected !== null, 'setup: rejected 非空');

  // applyRoot(baseDir)
  paths.applyRoot(paths.baseDir);
  ok(paths.rejected === null, 'applyRoot(baseDir) 后 rejected 被清');
  ok(paths.rootDir === paths.baseDir, 'applyRoot(baseDir) 后 rootDir = baseDir');
  ok(paths.configuredRoot === null, 'applyRoot(baseDir) 后 configuredRoot = null');
  cleanTmp();
}

// ── 18. legacy keys 下一次 write 物理丢弃 ─────────────────────────────
// toSettings 只输出 {root}；writeMainOwnedKey 整块替换 folders，
// 因此 legacy per-folder keys 在下一次写盘时被物理删除。
{
  let stored = null;
  const ctx = {
    settingsPath: '/settings.json',
    readJsonSafe: () => (stored ? JSON.parse(stored) : null),
    writeFileAtomic: (_file, data) => { stored = data; },
  };

  // 模拟有 legacy keys 的旧 settings
  stored = JSON.stringify({
    folders: { root: '/data/root', projects: '/old/Projects', materials: '/old/Materials' },
    theme: 'Dark',
  });

  const { paths } = makePosix();
  paths.load({ folders: { root: '/data/root' } });
  const s = paths.toSettings();
  ok(s.root === '/data/root', 'toSettings 输出 root');

  // 写盘
  writeMainOwnedKey(ctx, 'folders', s);
  const after = JSON.parse(stored);
  ok(after.folders.root === '/data/root', 'write 后 root 保留');
  ok(after.folders.projects === undefined, 'write 后 legacy projects 被丢弃');
  ok(after.folders.materials === undefined, 'write 后 legacy materials 被丢弃');
  ok(after.theme === 'Dark', 'write 后 renderer keys 保留');
}

// ── 19. ensureAll 创建 active rootDir 的 9 个子目录 ────────────────────
{
  const { paths } = makeReal();
  paths.ensureAll();
  const rootDir = paths.rootDir;
  for (const spec of FOLDER_SPECS) {
    const dir = path.join(rootDir, spec.subdir);
    ok(fs.existsSync(dir), 'ensureAll 创建 ' + spec.subdir);
  }
  cleanTmp();
}

// ── 20. ensureAll 在非默认 root 下创建子目录 ──────────────────────────
{
  const { paths } = makeReal();
  const customRoot = tmpDir('ensureall-custom');
  paths.load({ folders: { root: customRoot } });
  paths.ensureAll();
  for (const spec of FOLDER_SPECS) {
    const dir = path.join(customRoot, spec.subdir);
    ok(fs.existsSync(dir), 'ensureAll 在 custom root 创建 ' + spec.subdir);
  }
  cleanTmp();
}

// ── 21. list() 返回正确形状 ────────────────────────────────────────────
{
  const { paths } = makePosix();
  const result = paths.list();
  ok(result.root === BASE, 'list.root = baseDir');
  ok(result.defaultRoot === BASE, 'list.defaultRoot = baseDir');
  ok(result.configuredRoot === null, 'list.configuredRoot = null（默认）');
  ok(result.overridden === false, 'list.overridden = false（默认）');
  ok(result.rejected === null, 'list.rejected = null（默认）');
  ok(Array.isArray(result.subfolders), 'list.subfolders 是数组');
  ok(result.subfolders.length === 9, 'list.subfolders 共 9 项');
  const keys = result.subfolders.map(s => s.key);
  ok(keys.includes('coatings'), 'subfolders 含 coatings');
  ok(keys.includes('integrals'), 'subfolders 含 integrals');
  ok(keys.includes('reportPresets'), 'subfolders 含 reportPresets');
}

// ── 22. load() 无配置 → 使用默认 ──────────────────────────────────────
{
  const { paths } = makeReal();
  paths.load({});
  ok(paths.rootDir === paths.baseDir, '无配置 → rootDir = baseDir');
  ok(paths.configuredRoot === null, '无配置 → configuredRoot = null');
  ok(paths.rejected === null, '无配置 → rejected = null');
  cleanTmp();
}

// ── 23. load() folders 为空对象 → 使用默认 ────────────────────────────
{
  const { paths } = makeReal();
  paths.load({ folders: {} });
  ok(paths.rootDir === paths.baseDir, '空 folders → rootDir = baseDir');
  ok(paths.configuredRoot === null, '空 folders → configuredRoot = null');
  cleanTmp();
}

// ── 24. load() cfg 为 null → 使用默认 ─────────────────────────────────
{
  const { paths } = makeReal();
  paths.load(null);
  ok(paths.rootDir === paths.baseDir, 'null cfg → rootDir = baseDir');
  cleanTmp();
}

// ── 25. applyRoot 清 rejected ──────────────────────────────────────────
{
  const { paths } = makeReal();
  paths.load({ folders: { root: 'Q:\\Bad' } });
  ok(paths.rejected !== null, 'setup: rejected 非空');
  paths.applyRoot('/data/new');
  ok(paths.rejected === null, 'applyRoot 后 rejected 被清');
}

// ── 26. applyRoot(baseDir) 将 configuredRoot 设为 null ────────────────
{
  const { paths } = makePosix();
  paths.applyRoot('/data/custom');
  ok(paths.configuredRoot === '/data/custom', 'applyRoot(custom) → configuredRoot = custom');
  paths.applyRoot(BASE);
  ok(paths.configuredRoot === null, 'applyRoot(baseDir) → configuredRoot = null');
}

// ── 27. setRoot 不触发验证（纯赋值）─────────────────────────────────────
{
  const { paths } = makePosix();
  // 即使传入不可达路径，setRoot 也不验证
  const result = paths.setRoot('/impossible/path');
  ok(result.success === true, 'setRoot 总是成功（纯赋值）');
  ok(paths.rootDir === '/impossible/path', 'setRoot 直接赋值 rootDir');
}

// ── 28. defaultPath 与 get 的关系 ──────────────────────────────────────
{
  const { paths } = makePosix();
  ok(paths.defaultPath('projects') === posixDefault('Projects'), 'defaultPath 返回 baseDir + subdir');
  paths.applyRoot('/data/new');
  ok(paths.get('projects') === '/data/new/Projects', 'get 返回 rootDir + subdir');
  ok(paths.defaultPath('projects') === posixDefault('Projects'), 'defaultPath 不受 applyRoot 影响');
}

// ── 29. ensureAll 不重复创建已存在的目录 ──────────────────────────────
{
  const { paths } = makeReal();
  paths.ensureAll();
  // 第二次调用不报错
  paths.ensureAll();
  for (const spec of FOLDER_SPECS) {
    ok(fs.existsSync(path.join(paths.rootDir, spec.subdir)), 'ensureAll 幂等：' + spec.subdir + ' 存在');
  }
  cleanTmp();
}

// ── 30. legacy keys 在无 root 时也检测 ─────────────────────────────────
{
  const { paths, logs } = makeReal();
  paths.load({ folders: { projects: '/old/Projects' } });
  ok(logs.some(m => m.includes('Legacy folder key "projects"')), '无 root 时 legacy keys 也被检测');
  ok(paths.rootDir === paths.baseDir, '无 root 时使用默认');
  cleanTmp();
}

// ── 31. 多次 load 切换有效/无效 root ───────────────────────────────────
{
  const { paths } = makeReal();
  // 有效 root
  const goodRoot1 = tmpDir('multi-1');
  paths.load({ folders: { root: goodRoot1 } });
  ok(paths.rootDir === goodRoot1, '第一次 load: 有效 root');
  ok(paths.rejected === null, '第一次 load: 无 rejected');

  // 无效 root
  paths.load({ folders: { root: 'Q:\\XBad' } });
  ok(paths.rootDir === paths.baseDir, '第二次 load: fallback');
  ok(paths.rejected !== null, '第二次 load: rejected 非空');

  // 有效 root
  const goodRoot2 = tmpDir('multi-2');
  paths.load({ folders: { root: goodRoot2 } });
  ok(paths.rootDir === goodRoot2, '第三次 load: 有效 root');
  ok(paths.rejected === null, '第三次 load: rejected 被清');
  cleanTmp();
}

console.log('user_paths: ' + passed + ' passed');
process.exit(0);
