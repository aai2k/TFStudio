// IPC: 单一 Data Folder 迁移事务协调（issue #75 收敛版，Phase C + P1-1 消除）。
//
// 四约束：
//   1. mutate 无验证（setRoot 是纯赋值，验证前置到 checkTarget）
//   2. 回滚：直接调用 setRoot(previousRoot) 恢复内存（不再依赖 loadOverrides）
//   3. onUserPathsChanged 短路：补偿失败路径绝不触发（含 prepareMaterialsDir seed 副作用）
//   4. 补偿二次翻转：同盘补偿失败 → 内存再切回 new（直接赋值）
//
// CommonJS, Electron-free（deps via ctx），move 工厂可注入（可测性）。

const { writeMainOwnedKey } = require('../settingsFile');

// ── move mutex ────────────────────────────────────────────────────────────
let moveInProgress = false;

// ── Handler 契约（Step 2b，已定稿）────────────────────────────────────────
//
// paths:list → { success, folders: { root, defaultRoot, configuredRoot,
//                overridden, rejected, subfolders: [9 项] } }
// paths:choose → { success, canceled?, path }（只返回路径，不触发 set）
// paths:set(dir) → 事务返回（含 warning / critical 变体）
// paths:reset → 等价 set(defaultPath)（已 default 时 no-op）
// paths:reveal(key?) → root 和子目录都能 Open
// paths:listSubfolders → 兼容旧 renderer，折入 list 的 subfolders

function register(ipcMain, ctx, moveFactory) {
  ipcMain.handle('paths:list', async () => handleList(ctx));
  ipcMain.handle('paths:choose', async (event, key) => handleChoose(ctx, key));
  ipcMain.handle('paths:set', async (event, key, dir) => handleSet(ctx, key, dir));
  ipcMain.handle('paths:reset', async (event, key) => handleReset(ctx, key));
  ipcMain.handle('paths:reveal', async (event, key) => handleReveal(ctx, key));
  // 兼容旧 renderer（preload.js 仍注册这些 API）
  ipcMain.handle('paths:setRoot', async (event, dir) => handleSet(ctx, null, dir));
  ipcMain.handle('paths:listSubfolders', async () => handleListSubfolders(ctx));
  // 注入 move 工厂（默认用真实 dataFolderMove）
  ctx._moveFactory = moveFactory || null;
}

// ── 内部：获取 move 工厂实例 ──────────────────────────────────────────────
function getMove(ctx) {
  if (ctx._moveFactory) return ctx._moveFactory;
  // 默认：延迟 require，避免循环依赖 + 测试可注入
  const { createDataFolderMove } = require('../dataFolderMove');
  const deps = { fs: require('fs'), path: require('path') };
  return createDataFolderMove(deps);
}

// ── persist：writeMainOwnedKey 整块替换语义 ───────────────────────────────
function persist(ctx) {
  try {
    writeMainOwnedKey(ctx, 'folders', ctx.userPaths.toSettings());
    return { success: true };
  } catch (err) {
    ctx.log(`paths persist error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ── paths:list ────────────────────────────────────────────────────────────
function handleList(ctx) {
  return { success: true, folders: ctx.userPaths.list() };
}

// ── paths:listSubfolders（兼容旧 renderer）────────────────────────────────
function handleListSubfolders(ctx) {
  const folders = ctx.userPaths.list();
  return { success: true, subfolders: folders.subfolders };
}

// ── paths:choose（只返回选择路径，不触发 set）──────────────────────────────
async function handleChoose(ctx, key) {
  const { dialog, getMainWindow, userPaths } = ctx;
  const defaultPath = userPaths.rootDir;
  const result = await dialog.showOpenDialog(getMainWindow(), {
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: true, canceled: true };
  }
  return { success: true, path: result.filePaths[0] };
}

// ── paths:set(dir) — 核心事务协调 ────────────────────────────────────────
// 内联事务（快照→persist→回滚，语义复刻旧 applyChange）：
async function handleSet(ctx, _key, dir) {
  const { userPaths, log } = ctx;

  // move mutex（set / reset 共用）
  if (moveInProgress) {
    return { success: false, error: 'data folder move already in progress' };
  }
  moveInProgress = true;

  try {
    const currentRoot = userPaths.rootDir;
    const move = getMove(ctx);

    // 1. checkTarget — 纯检查，无副作用
    const validation = move.checkTarget(currentRoot, dir);
    if (!validation.ok) {
      return { success: false, error: validation.reason, folders: userPaths.list() };
    }

    // 2. moveTree — async rename / copy+verify
    const moveResult = await move.moveTree(currentRoot, dir);

    if (!moveResult.success) {
      // moveTree 失败（copy/verify 失败已 partial cleanup）
      return { success: false, error: moveResult.error, folders: userPaths.list() };
    }

    // ── moveTree 成功 ────────────────────────────────────────────────────
    const method = moveResult.method; // 'rename' | 'copy'
    const isSameDisk = method === 'rename';

    // 3. applyChange 事务：快照 → 临时切换 → persist → 成功则 commit / 失败则回滚
    // 关键：setRoot 在 persist 前调用（需序列化 new root），persist 失败立即回滚。
    const previousRoot = userPaths.rootDir;
    userPaths.setRoot(dir);

    const saved = persist(ctx);

    if (saved.success) {
      // persist 成功 → commit（ensureAll + 通知 + 清理旧目录）
      userPaths.ensureAll();
      ctx.onUserPathsChanged?.();

      // delete old（仅跨盘 copy 路径需要；同盘 rename 已移走）
      let warning = null;
      if (!isSameDisk) {
        try {
          const fs = require('fs');
          // 用 sync rm 避免 Windows 上 promises.rm 可能的挂起
          fs.rmSync(currentRoot, { recursive: true, force: true });
        } catch (_) {
          warning = `old folder still exists at ${currentRoot}`;
        }
      }

      const result = { success: true, folders: userPaths.list() };
      if (warning) result.warning = warning;
      return result;
    }

    // ── persist 失败 → 回滚 ──────────────────────────────────────────────
    if (isSameDisk) {
      // 同盘：数据已 rename 到 dir，先回滚内存，再补偿 rename(dir → currentRoot)
      userPaths.setRoot(previousRoot);
      try {
        const fs = require('fs');
        fs.renameSync(dir, currentRoot);
        // 补偿成功 → 三方一致（old），内存已回滚
        return { success: false, error: saved.error, folders: userPaths.list() };
      } catch (_) {
        // 补偿 rename 也失败 → 二次 persist(newRoot)
        // 此时数据在 dir，内存在 previousRoot → 需切到 dir 使 persist 写 newRoot
        userPaths.setRoot(dir);
        const secondPersist = persist(ctx);
        if (secondPersist.success) {
          // 二次 persist 成功 → warning（数据在 new，设置已恢复）
          return {
            success: true,
            folders: userPaths.list(),
            warning: `data moved to ${dir} but settings were recovered`,
          };
        }
        // 二次 persist 仍失败 → 内存切 new + critical
        // 四约束 #4：直接内部赋值，不走 applyChange
        userPaths.setRoot(dir);
        userPaths.ensureAll();
        // P1-4：critical 写 rejected，确保 list() 能反映警示痕迹
        userPaths.setRejected(currentRoot, 'settings could not be saved');
        // 四约束 #3：绝不触发 onUserPathsChanged
        log(`CRITICAL: data at ${dir}, settings could not be saved`);
        return {
          success: false,
          critical: true,
          dataLocation: dir,
          reason: 'settings could not be saved',
          folders: userPaths.list(),
        };
      }
    } else {
      // 跨盘：copy 已完成但 persist 失败 → 回滚内存 + 删除 new copy，保留 old
      userPaths.setRoot(previousRoot);
      try {
        const fs = require('fs');
        // 用 sync rm 避免 Windows 上 promises.rm 可能的挂起
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (cleanupErr) {
        // P2-4：清理失败时 error 附加清理路径信息
        return { success: false, error: `${saved.error} (cleanup of ${dir} failed: ${cleanupErr.message})`, folders: userPaths.list() };
      }
      return { success: false, error: saved.error, folders: userPaths.list() };
    }
  } finally {
    moveInProgress = false;
  }
}

// ── paths:reset — 等价 set(defaultPath)（设计 §9.1）───────────────────────
async function handleReset(ctx, _key) {
  const { userPaths } = ctx;
  const defaultPath = userPaths.baseDir;

  // 已 default 且非 fallback → no-op success
  if (userPaths.rootDir === defaultPath && userPaths.rejected === null) {
    return { success: true, folders: userPaths.list() };
  }

  // fallback 状态下（rejected != null）即使 active 已是 defaultRoot，
  // 仍需清除 configuredRoot（用户显式放弃原配置）
  if (userPaths.rootDir === defaultPath && userPaths.rejected !== null) {
    userPaths.clearOverride();
    persist(ctx);
    return { success: true, folders: userPaths.list() };
  }

  // 委托给 handleSet（复用完整事务流程）
  return handleSet(ctx, null, defaultPath);
}

// ── paths:reveal(key?) — root 和子目录都能 Open ──────────────────────────
async function handleReveal(ctx, key) {
  const { shell, userPaths, log } = ctx;
  try {
    let targetPath;
    if (key) {
      targetPath = userPaths.get(key);
    } else {
      targetPath = userPaths.rootDir;
    }
    const error = await shell.openPath(targetPath);
    if (error) return { success: false, error };
    return { success: true };
  } catch (err) {
    log(`paths:reveal error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { register };
