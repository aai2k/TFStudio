/**
 * dataFolderMove.js — 单一 Data Folder 迁移逻辑（issue #75 收敛版）。
 *
 * 公共 API（最小）：
 *   createDataFolderMove({ fs, path }) => { checkTarget, moveTree }
 *
 * 内部 helper（不暴露）：
 *   tree traversal、file-count tally、byte tally、copy、verify、
 *   partial cleanup、safeRemove、delete。
 *
 * 设计原则：
 *   - async fs（RII mirror 约 4000 文件，避免阻塞窗口）；
 *   - checkTarget 纯检查，无 mkdir / 无写文件（无持久副作用）；
 *   - moveTree 不提前 stat.dev 判断磁盘；
 *   - 不在函数内部删除 src；不碰 settings。
 */

'use strict';

/**
 * 创建 dataFolderMove 实例。
 * @param {{ fs: object, path: object }} deps — 注入的 fs / path 模块
 * @returns {{ checkTarget: Function, moveTree: Function }}
 */
function createDataFolderMove({ fs: _fs, path: _path }) {

  // ── 路径归一化 ────────────────────────────────────────────────────────
  // resolve + 尾分隔符剥离；不做大小写折叠 / realpath（端口由调用方保证）。
  function normalize(p) {
    let r = _path.resolve(p);
    // 尾分隔符去掉（保持一致）
    if (r.length > 1 && (r.endsWith('/') || r.endsWith('\\'))) {
      r = r.slice(0, -1);
    }
    return r;
  }

  // ── checkTarget(current, target) ──────────────────────────────────────

  /**
   * 验证 target 是否可作为迁移目标。
   *
   * 规则：
   *   1. target 必须为空或不存在；
   *   2. target 不能在 current 内；
   *   3. current 不能在 target 内；
   *   4. 纯检查，不 mkdir，不写文件；
   *   5. target == current（normalize 后）→ no-op success；
   *   6. current root 不存在 → 'current root unavailable'。
   *
   * @param {string} current — 当前数据根目录
   * @param {string} target  — 拟迁移目标目录
   * @returns {{ ok: boolean, reason?: string }}
   */
  function checkTarget(current, target) {
    const cur = normalize(current);
    const tgt = normalize(target);

    // 5. target == current → no-op success
    if (cur === tgt) {
      return { ok: true };
    }

    // 6. current root 不存在
    try {
      const st = _fs.statSync(cur);
      if (!st.isDirectory()) {
        return { ok: false, reason: 'current root unavailable' };
      }
    } catch (_) {
      return { ok: false, reason: 'current root unavailable' };
    }

    // 2. target 不能在 current 内（先检查嵌套，再检查非空）
    if (tgt.startsWith(cur + _path.sep) || tgt.startsWith(cur + '/')) {
      return { ok: false, reason: 'target is inside current root' };
    }

    // 3. current 不能在 target 内
    if (cur.startsWith(tgt + _path.sep) || cur.startsWith(tgt + '/')) {
      return { ok: false, reason: 'current root is inside target' };
    }

    // 1. target 必须为空或不存在
    let tgtExists = false;
    try {
      _fs.statSync(tgt);
      tgtExists = true;
    } catch (_) {
      // 不存在 → 允许
    }

    // target 存在但非空 → 拒绝
    if (tgtExists) {
      try {
        const entries = _fs.readdirSync(tgt);
        if (entries.length > 0) {
          return { ok: false, reason: 'target is not empty' };
        }
      } catch (_) {
        // 读取失败（如无权限），视为非空
        return { ok: false, reason: 'target is not empty' };
      }
    }

    return { ok: true };
  }

  // ── 内部 helper ───────────────────────────────────────────────────────

  /**
   * 递归遍历目录树，异步收集文件/目录计数和字节数。
   * @returns {Promise<{ fileCount: number, dirCount: number, totalBytes: number }>}
   */
  async function traverseStats(dir) {
    let fileCount = 0;
    let dirCount = 0;
    let totalBytes = 0;

    async function walk(d) {
      const entries = await _fs.promises.readdir(d, { withFileTypes: true });
      for (const e of entries) {
        const full = _path.join(d, e.name);
        if (e.isDirectory()) {
          dirCount++;
          await walk(full);
        } else if (e.isFile() || e.isSymbolicLink()) {
          fileCount++;
          const st = await _fs.promises.stat(full);
          totalBytes += st.size;
        }
      }
    }

    await walk(dir);
    return { fileCount, dirCount, totalBytes };
  }

  /**
   * 递归拷贝目录树（stream/pipeline 不适用于目录结构，使用 async fs 逐文件拷贝）。
   * @param {string} srcDir
   * @param {string} dstDir
   */
  async function asyncCopyDir(srcDir, dstDir) {
    await _fs.promises.mkdir(dstDir, { recursive: true });
    const entries = await _fs.promises.readdir(srcDir, { withFileTypes: true });
    for (const e of entries) {
      const src = _path.join(srcDir, e.name);
      const dst = _path.join(dstDir, e.name);
      if (e.isDirectory()) {
        await asyncCopyDir(src, dst);
      } else if (e.isSymbolicLink()) {
        const link = await _fs.promises.readlink(src);
        await _fs.promises.symlink(link, dst);
      } else {
        // 文件：使用 fs.promises.copyFile（底层用 sendfile/CoW，性能足够）
        await _fs.promises.copyFile(src, dst);
      }
    }
  }

  /**
   * 验证拷贝完整性：fileCount + totalBytes（dirCount 附加）。
   * @returns {Promise<{ ok: boolean, reason?: string }>}
   */
  async function verifyCopy(fromDir, toDir) {
    const fromStats = await traverseStats(fromDir);
    const toStats = await traverseStats(toDir);

    if (fromStats.fileCount !== toStats.fileCount) {
      return {
        ok: false,
        reason: `fileCount mismatch: source=${fromStats.fileCount} target=${toStats.fileCount}`,
      };
    }
    if (fromStats.totalBytes !== toStats.totalBytes) {
      return {
        ok: false,
        reason: `totalBytes mismatch: source=${fromStats.totalBytes} target=${toStats.totalBytes}`,
      };
    }
    if (fromStats.dirCount !== toStats.dirCount) {
      return {
        ok: false,
        reason: `dirCount mismatch: source=${fromStats.dirCount} target=${toStats.dirCount}`,
      };
    }
    return { ok: true };
  }

  /**
   * 幂等 safeRemove：递归删除目录，不存在时不报错。
   * @returns {Promise<void>}
   */
  async function safeRemove(dir) {
    try {
      await _fs.promises.rm(dir, { recursive: true, force: true });
    } catch (err) {
      // force: true 本身应该不抛，但以防万一
      throw Object.assign(err, { residualPath: dir, cleanupPath: dir });
    }
  }

  /**
   * 检查路径是否为非空目录。
   */
  async function isNonEmptyDir(p) {
    try {
      const st = await _fs.promises.stat(p);
      if (!st.isDirectory()) return false;
      const entries = await _fs.promises.readdir(p);
      return entries.length > 0;
    } catch (_) {
      return false;
    }
  }

  // ── moveTree(from, to) ────────────────────────────────────────────────

  /**
   * 迁移目录树 from → to。
   *
   * 流程：
   *   try rename
   *     ↓  EXDEV → async copy → verify
   *     ↓  EPERM/EEXIST 且 target 为空目录 → rmdir(target) 后重试 rename → 仍失败降级 copy
   *
   * 不提前 stat.dev 判断磁盘。
   * copy 分支开头断言 to 不存在（TOCTOU 防御）。
   * copy 失败 → partial cleanup（safeRemove 幂等）。
   * 不在函数内部删除 src；不碰 settings。
   *
   * @param {string} from — 源目录
   * @param {string} to   — 目标目录
   * @returns {Promise<{ success: boolean, method?: string, error?: string, crossDevice?: boolean }>}
   */
  async function moveTree(from, to) {
    const resolvedFrom = normalize(from);
    const resolvedTo = normalize(to);

    // 目标 == 源 → no-op
    if (resolvedFrom === resolvedTo) {
      return { success: true, method: 'rename' };
    }

    // 尝试 rename
    try {
      await _fs.promises.rename(resolvedFrom, resolvedTo);
      return { success: true, method: 'rename' };
    } catch (err) {
      const code = err.code;

      // EXDEV → 跨盘，降级 copy
      if (code === 'EXDEV') {
        return await doCopyWithVerify(resolvedFrom, resolvedTo);
      }

      // EPERM/EEXIST 且 target 为空目录 → rmdir 重试 rename
      if (code === 'EPERM' || code === 'EEXIST') {
        const nonEmpty = await isNonEmptyDir(resolvedTo);
        if (nonEmpty) {
          // target 非空 → 不 rmdir、直接报错/降级
          return {
            success: false,
            error: `target directory is not empty (${code})`,
            crossDevice: false,
          };
        }
        // target 为空 → rmdir 后重试 rename
        try {
          await _fs.promises.rmdir(resolvedTo);
        } catch (_) {
          // rmdir 失败 → 降级 copy
          return await doCopyWithVerify(resolvedFrom, resolvedTo);
        }
        try {
          await _fs.promises.rename(resolvedFrom, resolvedTo);
          return { success: true, method: 'rename' };
        } catch (_) {
          // 重试仍失败 → 降级 copy
          return await doCopyWithVerify(resolvedFrom, resolvedTo);
        }
      }

      // 其他错误
      return {
        success: false,
        error: err.message || String(err),
        crossDevice: false,
      };
    }
  }

  /**
   * 跨盘 copy + verify 流程（内部分支）。
   * @returns {Promise<{ success: boolean, method?: string, error?: string, crossDevice?: boolean }>}
   */
  async function doCopyWithVerify(from, to) {
    // TOCTOU 防御（P1-3）：copy 分支开头断言 to 不存在（存在即抛）
    try {
      await _fs.promises.stat(to);
      // 如果 to 存在，检查是否非空
      const nonEmpty = await isNonEmptyDir(to);
      if (nonEmpty) {
        return {
          success: false,
          error: 'target directory already exists and is not empty (TOCTOU)',
          crossDevice: true,
        };
      }
      // 空目录 → 先删再 copy
      await _fs.promises.rmdir(to);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        return {
          success: false,
          error: err.message || String(err),
          crossDevice: true,
        };
      }
      // ENOENT → 不存在，正常
    }

    try {
      await asyncCopyDir(from, to);
    } catch (copyErr) {
      // copy 失败 → partial cleanup
      try {
        await safeRemove(to);
      } catch (cleanupErr) {
        return {
          success: false,
          error: `copy failed: ${copyErr.message}, cleanup failed: ${cleanupErr.message}, 残留路径: ${to}`,
          crossDevice: true,
        };
      }
      return {
        success: false,
        error: copyErr.message || String(copyErr),
        crossDevice: true,
      };
    }

    // verify（异常时 safeRemove 清理并返回 verify failed，防 broken symlink 导致 new root 残留）
    let vResult;
    try {
      vResult = await verifyCopy(from, to);
    } catch (verifyErr) {
      try { await safeRemove(to); } catch (_) {}
      return { success: false, error: `verify exception: ${verifyErr.message}`, crossDevice: true };
    }
    if (!vResult.ok) {
      // verify 失败 → partial cleanup
      try {
        await safeRemove(to);
      } catch (_) {
        // safeRemove 幂等——存在异常时仍报告 verify 错误
      }
      return {
        success: false,
        error: `verify failed: ${vResult.reason}`,
        crossDevice: true,
      };
    }

    return { success: true, method: 'copy' };
  }

  return { checkTarget, moveTree };
}

module.exports = { createDataFolderMove };
