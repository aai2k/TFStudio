/**
 * FoldersPane 逻辑测试 + preload API 契约验证（issue #75 Phase E）。
 *
 * 覆盖：
 *   - preload.js IPC 契约（setUserPath/resetUserPath/chooseUserPath 签名对齐 Phase C）
 *   - renderer.js handleUserPathChanged 无 key 参数
 *   - SubfolderList 从 subfolders 数组渲染（map，不写死数量）
 *   - FolderRow moving 状态按钮 disabled
 *   - FoldersPane 数据流：listUserPaths → subfolders 派生
 *   - FoldersPane 内联状态：rejected / error / warning / critical / moving
 *
 * ESM + createRequire 加载 CJS 模块。
 * Run: node tests/folders_pane.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);

// ── 断言框架 ──────────────────────────────────────────────────────────
let P = 0, F = 0;
function ok(c, m) { if (!c) { F++; console.error('FAIL:', m); } else P++; }
function eq(a, b, m) { ok(a === b, `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function includes(s, sub, m) { ok(typeof s === 'string' && s.includes(sub), `${m}: expected string containing '${sub}', got ${JSON.stringify(s)}`); }

// ═══════════════════════════════════════════════════════════════════════
// 1. preload.js IPC 契约验证
// ═══════════════════════════════════════════════════════════════════════
{
  // 验证 preload.js 源码中的 API 签名
  const preloadSrc = fs.readFileSync(path.join(process.cwd(), 'src/preload.js'), 'utf8');

  // setUserPath(dir) — 不再接受 key 参数
  includes(preloadSrc, 'setUserPath:', 'preload exports setUserPath');
  ok(!preloadSrc.includes('setUserPath:            (key, dir)'),
    'setUserPath 不再接受 key 参数');

  // resetUserPath() — 不再接受 key 参数
  includes(preloadSrc, 'resetUserPath:', 'preload exports resetUserPath');
  ok(!preloadSrc.includes('resetUserPath:          (key)'),
    'resetUserPath 不再接受 key 参数');

  // chooseUserPath() — 不再接受 key 参数
  includes(preloadSrc, 'chooseUserPath:', 'preload exports chooseUserPath');
  ok(!preloadSrc.includes('chooseUserPath:         (key)'),
    'chooseUserPath 不再接受 key 参数');

  // revealUserPath(key) — 保留 key 参数
  includes(preloadSrc, 'revealUserPath:', 'preload exports revealUserPath');
  ok(preloadSrc.includes('revealUserPath:         (key)'),
    'revealUserPath 保留 key 参数');

  // listUserPaths 保留
  includes(preloadSrc, 'listUserPaths:', 'preload exports listUserPaths');

  // 旧 API 已移除
  ok(!preloadSrc.includes('setUserPathRoot:'), 'setUserPathRoot 已移除');
  ok(!preloadSrc.includes('listSubfolders:'), 'listSubfolders 已移除');
}

// ═══════════════════════════════════════════════════════════════════════
// 2. ipc/paths.js handler 契约验证
// ═══════════════════════════════════════════════════════════════════════
{
  const pathsSrc = fs.readFileSync(path.join(process.cwd(), 'src/main/ipc/paths.js'), 'utf8');

  // paths:set 接受 (event, key, dir)，其中 key 被忽略（_key）
  includes(pathsSrc, 'async function handleSet(ctx, _key, dir)',
    'handleSet 接受 _key 参数（兼容旧签名但忽略）');

  // paths:reset 不接受 key
  includes(pathsSrc, 'async function handleReset(ctx, _key)',
    'handleReset 接受 _key 参数（兼容但忽略）');

  // paths:choose 不接受 key
  includes(pathsSrc, 'async function handleChoose(ctx, key)',
    'handleChoose 接受 key 参数但不使用');

  // paths:list 返回 folders 对象含 subfolders
  includes(pathsSrc, "return { success: true, folders: ctx.userPaths.list() }",
    'handleList 返回 folders.list()');

  // listSubfolders 兼容 handler 保留
  includes(pathsSrc, "ipcMain.handle('paths:listSubfolders'",
    'listSubfolders 兼容 handler 保留');

  // paths:setRoot 兼容 handler 保留
  includes(pathsSrc, "ipcMain.handle('paths:setRoot'",
    'setRoot 兼容 handler 保留');
}

// ═══════════════════════════════════════════════════════════════════════
// 3. renderer.js handleUserPathChanged 签名验证
// ═══════════════════════════════════════════════════════════════════════
{
  const rendererSrc = fs.readFileSync(path.join(process.cwd(), 'src/renderer.js'), 'utf8');

  // handleUserPathChanged 不再接受 key 参数
  includes(rendererSrc, 'const handleUserPathChanged = async () =>',
    'handleUserPathChanged 不再接受 key 参数');

  // 统一 reload（不再按 key 分发）
  includes(rendererSrc, 'await loadFoldersFromDisk({ restoreSession: false, restoreLayout: false })',
    'handleUserPathChanged 调 loadFoldersFromDisk');
  includes(rendererSrc, 'await loadCatalogsFromDisk()',
    'handleUserPathChanged 调 loadCatalogsFromDisk');
}

// ═══════════════════════════════════════════════════════════════════════
// 4. FoldersPane 组件结构验证
// ═══════════════════════════════════════════════════════════════════════
{
  const foldersPaneSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/dialogs/settings/FoldersPane.js'), 'utf8');

  // 使用 SubfolderList 组件
  includes(foldersPaneSrc, "import { SubfolderList } from './SubfolderList.js'",
    'FoldersPane 导入 SubfolderList');

  // 使用 FolderRow 组件
  includes(foldersPaneSrc, "import { FolderRow } from './FolderRow.js'",
    'FoldersPane 导入 FolderRow');

  // 从 listUserPaths 获取数据（不使用 listSubfolders）
  includes(foldersPaneSrc, 'listUserPaths',
    'FoldersPane 使用 listUserPaths 获取数据');
  ok(!foldersPaneSrc.includes('listSubfolders'),
    'FoldersPane 不使用旧的 listSubfolders');

  // subfolders 从 folders.subfolders 派生
  includes(foldersPaneSrc, 'folders?.subfolders',
    'FoldersPane 从 folders.subfolders 派生子目录');

  // Moving… busy state
  includes(foldersPaneSrc, 'moving',
    'FoldersPane 有 moving 状态');
  includes(foldersPaneSrc, 'setMoving',
    'FoldersPane 有 setMoving setter');

  // inline 状态
  includes(foldersPaneSrc, 'rejected',
    'FoldersPane 处理 rejected 状态');
  includes(foldersPaneSrc, 'error',
    'FoldersPane 处理 error 状态');
  includes(foldersPaneSrc, 'critical',
    'FoldersPane 处理 critical 状态');
  includes(foldersPaneSrc, 'warning',
    'FoldersPane 处理 warning 状态');

  // unsaved-designs guard（canChangeUserPath）
  includes(foldersPaneSrc, 'canChangeUserPath',
    'FoldersPane 使用 canChangeUserPath 守卫');

  // confirm dialog（window.confirm 回退）
  includes(foldersPaneSrc, 'window.confirm',
    'FoldersPane 有 window.confirm 回退');
}

// ═══════════════════════════════════════════════════════════════════════
// 5. FolderRow moving 状态验证
// ═══════════════════════════════════════════════════════════════════════
{
  const folderRowSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/dialogs/settings/FolderRow.js'), 'utf8');

  // FolderRow 接受 moving prop
  includes(folderRowSrc, 'moving',
    'FolderRow 接受 moving prop');

  // 按钮 disabled 与 moving 联动
  includes(folderRowSrc, 'disabled: moving',
    'Browse 按钮在 moving 时 disabled');
  includes(folderRowSrc, "(!entry.overridden || moving)",
    'Reset 按钮在 moving 或非 overridden 时 disabled');
}

// ═══════════════════════════════════════════════════════════════════════
// 6. SubfolderList 从 subfolders 数组渲染（不写死数量）
// ═══════════════════════════════════════════════════════════════════════
{
  const subfolderListSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/dialogs/settings/SubfolderList.js'), 'utf8');

  // SubfolderList 接受 onOpen prop
  includes(subfolderListSrc, 'onOpen',
    'SubfolderList 接受 onOpen prop');

  // SubfolderList 接受 moving prop
  includes(subfolderListSrc, 'moving',
    'SubfolderList 接受 moving prop');

  // 使用 map 渲染（不写死数量）
  includes(subfolderListSrc, '.map(sf',
    'SubfolderList 使用 map 渲染（不写死数量）');

  // 有 Open 按钮
  includes(subfolderListSrc, 'onOpen',
    'SubfolderList 每行有 Open 按钮');
}

// ═══════════════════════════════════════════════════════════════════════
// 7. userPaths.list() 返回结构验证（Phase C 契约）
// ═══════════════════════════════════════════════════════════════════════
{
  const { createUserPaths, FOLDER_SPECS } = require('../src/main/userPaths.js');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-pane-test-'));
  const docs = path.join(TMP, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  const up = createUserPaths({ documentsDir: docs, fs, path, exeDir: TMP });
  up.load({});
  up.ensureAll();

  const list = up.list();

  // 验证 list 返回结构
  ok(typeof list.root === 'string', 'list.root 是字符串');
  ok(typeof list.defaultRoot === 'string', 'list.defaultRoot 是字符串');
  ok('configuredRoot' in list, 'list 含 configuredRoot');
  ok(typeof list.overridden === 'boolean', 'list.overridden 是布尔');
  ok('rejected' in list, 'list 含 rejected');
  ok(Array.isArray(list.subfolders), 'list.subfolders 是数组');
  eq(list.subfolders.length, 9, 'subfolders 共 9 项');

  // 验证每个 subfolder 的结构
  for (const sf of list.subfolders) {
    ok(typeof sf.key === 'string', `subfolder ${sf.key} 有 key`);
    ok(typeof sf.path === 'string', `subfolder ${sf.key} 有 path`);
    ok(typeof sf.exists === 'boolean', `subfolder ${sf.key} 有 exists`);
  }

  // 验证 9 个 key 与 FOLDER_SPECS 一致
  const keys = list.subfolders.map(sf => sf.key);
  for (const spec of FOLDER_SPECS) {
    ok(keys.includes(spec.key), `subfolders 包含 ${spec.key}`);
  }

  // 验证 overridden 行为
  eq(list.overridden, false, '默认 overridden=false');

  up.applyRoot('/data/custom-root');
  const list2 = up.list();
  ok(list2.overridden, '自定义 root 后 overridden=true');

  up.applyRoot(list2.defaultRoot);
  const list3 = up.list();
  eq(list3.overridden, false, '恢复默认后 overridden=false');

  // 清理
  fs.rmSync(TMP, { recursive: true, force: true });
}

// ═══════════════════════════════════════════════════════════════════════
// 8. ipc/paths.js 事务流程验证（关键路径）
// ═══════════════════════════════════════════════════════════════════════
{
  const { createUserPaths } = require('../src/main/userPaths.js');
  const { register } = require('../src/main/ipc/paths.js');

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-ipc-test-'));
  const docs = path.join(TMP, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  const up = createUserPaths({ documentsDir: docs, fs, path, exeDir: TMP });
  up.load({});
  up.ensureAll();

  let changeCount = 0;
  const ctx = {
    userPaths: up, log: () => {},
    settingsPath: path.join(TMP, 's.json'), readJsonSafe: () => null,
    writeFileAtomic: () => {},
    onUserPathsChanged: () => { changeCount++; },
    dialog: { async showOpenDialog() { return { canceled: true }; } },
    getMainWindow: () => ({}), shell: { async openPath() { return ''; } },
    _dir: TMP,
  };

  const handlers = {};
  const fakeIpcMain = { handle(ch, fn) { handlers[ch] = fn; } };

  // mock move 工厂（同盘 rename 成功）
  const fakeMove = {
    checkTarget: () => ({ ok: true }),
    async moveTree(from, to) {
      fs.cpSync(from, to, { recursive: true });
      fs.rmSync(from, { recursive: true, force: true });
      return { success: true, method: 'rename' };
    },
  };

  register(fakeIpcMain, ctx, fakeMove);

  // paths:list 返回结构
  const listResult = await handlers['paths:list']();
  ok(listResult.success, 'paths:list 返回 success');
  ok(listResult.folders.root === up.rootDir, 'paths:list 返回当前 root');
  ok(listResult.folders.subfolders.length === 9, 'paths:list 返回 9 个 subfolders');

  // paths:set(dir) 成功
  const newRoot = path.join(TMP, 'new-root');
  fs.mkdirSync(newRoot, { recursive: true });
  const setResult = await handlers['paths:set'](null, null, newRoot);
  ok(setResult.success, 'paths:set 成功');
  ok(setResult.folders.root === newRoot, 'paths:set 返回新 root');
  ok(changeCount === 1, 'onUserPathsChanged 被调用 1 次');

  // paths:reset → no-op（已 default）
  const resetResult = await handlers['paths:reset']();
  ok(resetResult.success, 'paths:reset no-op 成功');

  // paths:reveal — 不抛异常
  const revealResult = await handlers['paths:reveal']();
  ok(typeof revealResult.success === 'boolean', 'paths:reveal 返回结果');

  // paths:choose — 取消
  const chooseResult = await handlers['paths:choose']();
  ok(chooseResult.success, 'paths:choose 取消返回 success');
  ok(chooseResult.canceled, 'paths:choose 取消返回 canceled');

  // 清理
  fs.rmSync(TMP, { recursive: true, force: true });
}

// ═══════════════════════════════════════════════════════════════════════
// 9. critical recovery 不触发 onUserPathChanged
// ═══════════════════════════════════════════════════════════════════════
{
  const { createUserPaths } = require('../src/main/userPaths.js');
  const { register } = require('../src/main/ipc/paths.js');

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-crit-test-'));
  const docs = path.join(TMP, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  const up = createUserPaths({ documentsDir: docs, fs, path, exeDir: TMP });
  up.load({});
  up.ensureAll();

  let changeCount = 0;
  const ctx = {
    userPaths: up, log: () => {},
    settingsPath: path.join(TMP, 's.json'), readJsonSafe: () => null,
    writeFileAtomic: () => { throw new Error('disk full'); },
    onUserPathsChanged: () => { changeCount++; },
    dialog: { async showOpenDialog() { return { canceled: true }; } },
    getMainWindow: () => ({}), shell: { async openPath() { return ''; } },
    _dir: TMP,
  };

  const handlers = {};
  const fakeIpcMain = { handle(ch, fn) { handlers[ch] = fn; } };

  // mock move 工厂：rename 成功但 persist 失败 + compensation 失败 → critical
  const criticalMove = {
    checkTarget: () => ({ ok: true }),
    async moveTree(from, to) {
      fs.cpSync(from, to, { recursive: true });
      fs.rmSync(from, { recursive: true, force: true });
      // 模拟补偿 rename 也失败
      fs.rmSync(to, { recursive: true, force: true });
      return { success: true, method: 'rename' };
    },
  };

  register(fakeIpcMain, ctx, criticalMove);

  const newRoot = path.join(TMP, 'crit-root');
  fs.mkdirSync(newRoot, { recursive: true });
  const r = await handlers['paths:set'](null, null, newRoot);
  ok(!r.success, 'critical 返回 success=false');
  ok(r.critical === true, 'critical 返回 critical=true');
  ok(r.dataLocation, 'critical 返回 dataLocation');
  eq(changeCount, 0, 'critical 不触发 onUserPathChanged');

  fs.rmSync(TMP, { recursive: true, force: true });
}

// ── 结果汇总 ───────────────────────────────────────────────────────
console.log(`\nfolders_pane: ${P} passed, ${F} failed`);
process.exit(F > 0 ? 1 : 0);
