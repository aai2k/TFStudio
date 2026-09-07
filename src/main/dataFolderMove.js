/**
 * dataFolderMove.js — Single Data Folder migration logic (issue #75 consolidated version).
 *
 * Public API (minimal):
 *   createDataFolderMove({ fs, path }) => { checkTarget, moveTree }
 *
 * Internal helpers (not exposed):
 *   tree traversal, file-count tally, byte tally, copy, verify,
 *   partial cleanup, safeRemove, delete.
 *
 * Design principles:
 *   - async fs (RII mirror ~4000 files, avoid blocking the window);
 *   - checkTarget pure check, no mkdir / no writing files (no persistent side effects);
 *   - moveTree doesn't pre-stat.dev disk judgment;
 *   - Don't delete src inside functions; don't touch settings.
 */

'use strict';

/**
 * Create dataFolderMove instance.
 * @param {{ fs: object, path: object }} deps — Injected fs / path modules
 * @returns {{ checkTarget: Function, moveTree: Function }}
 */
function createDataFolderMove({ fs: _fs, path: _path }) {

  // ── Path normalization ────────────────────────────────────────────────────
  // resolve + trailing separator strip; no case folding / realpath (caller ensures canonical port).
  function normalize(p) {
    let r = _path.resolve(p);
    // Trailing separator removal (keep consistent)
    if (r.length > 1 && (r.endsWith('/') || r.endsWith('\\'))) {
      r = r.slice(0, -1);
    }
    return r;
  }

  // ── checkTarget(current, target) ──────────────────────────────────────

  /**
   * Validate whether target can be a migration target.
   *
   * Rules:
   *   1. target must be empty or non-existent;
   *   2. target must not be inside current;
   *   3. current must not be inside target;
   *   4. Pure check, no mkdir, no writing files;
   *   5. target == current (after normalize) → no-op success;
   *   6. current root does not exist → 'current root unavailable'.
   *
   * @param {string} current — Current data root directory
   * @param {string} target — Target migration directory
   * @returns {{ ok: boolean, reason?: string }}
   */
  function checkTarget(current, target) {
    const cur = normalize(current);
    const tgt = normalize(target);

    // 5. target == current → no-op success
    if (cur === tgt) {
      return { ok: true };
    }

    // 6. current root does not exist
    try {
      const st = _fs.statSync(cur);
      if (!st.isDirectory()) {
        return { ok: false, reason: 'current root unavailable' };
      }
    } catch (_) {
      return { ok: false, reason: 'current root unavailable' };
    }

    // 2. target must not be inside current (check nested first, then check non-empty)
    if (tgt.startsWith(cur + _path.sep) || tgt.startsWith(cur + '/')) {
      return { ok: false, reason: 'target is inside current root' };
    }

    // 3. current must not be inside target
    if (cur.startsWith(tgt + _path.sep) || cur.startsWith(tgt + '/')) {
      return { ok: false, reason: 'current root is inside target' };
    }

    // 1. target must be empty or non-existent
    let tgtExists = false;
    try {
      _fs.statSync(tgt);
      tgtExists = true;
    } catch (_) {
      // does not exist → allowed
    }

    // target exists but non-empty → reject
    if (tgtExists) {
      try {
        const entries = _fs.readdirSync(tgt);
        if (entries.length > 0) {
          return { ok: false, reason: 'target is not empty' };
        }
      } catch (_) {
        // read failure (e.g., no permission) → considered non-empty
        return { ok: false, reason: 'target is not empty' };
      }
    }

    return { ok: true };
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Recursively traverse directory tree, async collect file/dir counts and byte counts.
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
   * Recursively copy directory tree (stream/pipeline not suitable for directory structure, use async fs to copy file by file).
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
        // File: use fs.promises.copyFile (underlying sendfile/CoW, performance sufficient)
        await _fs.promises.copyFile(src, dst);
      }
    }
  }

  /**
   * Verify copy integrity: fileCount + totalBytes (dirCount appended).
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
   * Idempotent safeRemove: recursively delete directory, no error if not exists.
   * @returns {Promise<void>}
   */
  async function safeRemove(dir) {
    try {
      await _fs.promises.rm(dir, { recursive: true, force: true });
    } catch (err) {
      // force: true should not throw in itself, but just in case
      throw Object.assign(err, { residualPath: dir, cleanupPath: dir });
    }
  }

  /**
   * Check if path is a non-empty directory.
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
   * Migrate directory tree from → to.
   *
   * Flow:
   *   try rename
   *     ↓  EXDEV → async copy → verify
   *     ↓  EPERM/EEXIST and target is empty directory → rmdir(target) then retry rename → still failed downgrade copy
   *
   * Don't pre-stat.dev disk judgment.
   * copy branch asserts to does not exist at start (TOCTOU defense).
   * copy fails → partial cleanup (safeRemove idempotent).
   * Don't delete src inside function; don't touch settings.
   *
   * @param {string} from — Source directory
   * @param {string} to — Target directory
   * @returns {Promise<{ success: boolean, method?: string, error?: string, crossDevice?: boolean }>}
   */
  async function moveTree(from, to) {
    const resolvedFrom = normalize(from);
    const resolvedTo = normalize(to);

    // target == source → no-op
    if (resolvedFrom === resolvedTo) {
      return { success: true, method: 'rename' };
    }

    // try rename
    try {
      await _fs.promises.rename(resolvedFrom, resolvedTo);
      return { success: true, method: 'rename' };
    } catch (err) {
      const code = err.code;

      // EXDEV → cross-disk, downgrade to copy
      if (code === 'EXDEV') {
        return await doCopyWithVerify(resolvedFrom, resolvedTo);
      }

      // EPERM/EEXIST and target is empty directory → rmdir retry rename
      if (code === 'EPERM' || code === 'EEXIST') {
        const nonEmpty = await isNonEmptyDir(resolvedTo);
        if (nonEmpty) {
          // target non-empty → don't rmdir, directly report/downgrade
          return {
            success: false,
            error: `target directory is not empty (${code})`,
            crossDevice: false,
          };
        }
        // target empty → rmdir then retry rename
        try {
          await _fs.promises.rmdir(resolvedTo);
        } catch (_) {
          // rmdir failed → downgrade copy
          return await doCopyWithVerify(resolvedFrom, resolvedTo);
        }
        try {
          await _fs.promises.rename(resolvedFrom, resolvedTo);
          return { success: true, method: 'rename' };
        } catch (_) {
          // retry still failed → downgrade copy
          return await doCopyWithVerify(resolvedFrom, resolvedTo);
        }
      }

      // other errors
      return {
        success: false,
        error: err.message || String(err),
        crossDevice: false,
      };
    }
  }

  /**
   * Cross-disk copy + verify process (internal branch).
   * @returns {Promise<{ success: boolean, method?: string, error?: string, crossDevice?: boolean }>}
   */
  async function doCopyWithVerify(from, to) {
    // TOCTOU defense (P1-3): copy branch asserts to does not exist (throw if exists)
    try {
      await _fs.promises.stat(to);
      // If to exists, check if non-empty
      const nonEmpty = await isNonEmptyDir(to);
      if (nonEmpty) {
        return {
          success: false,
          error: 'target directory already exists and is not empty (TOCTOU)',
          crossDevice: true,
        };
      }
      // Empty directory → delete then copy
      await _fs.promises.rmdir(to);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        return {
          success: false,
          error: err.message || String(err),
          crossDevice: true,
        };
      }
      // ENOENT → does not exist, normal
    }

    try {
      await asyncCopyDir(from, to);
    } catch (copyErr) {
      // copy failure → partial cleanup
      try {
        await safeRemove(to);
      } catch (cleanupErr) {
        return {
          success: false,
          error: `copy failed: ${copyErr.message}, cleanup failed: ${cleanupErr.message}, residual path: ${to}`,
          crossDevice: true,
        };
      }
      return {
        success: false,
        error: copyErr.message || String(copyErr),
        crossDevice: true,
      };
    }

    // verify (when an exception occurs, safeRemove cleans up and returns verify failed, preventing broken symlink from causing new root residual)
    let vResult;
    try {
      vResult = await verifyCopy(from, to);
    } catch (verifyErr) {
      try { await safeRemove(to); } catch (_) {}
      return { success: false, error: `verify exception: ${verifyErr.message}`, crossDevice: true };
    }
    if (!vResult.ok) {
      // verify failed → partial cleanup
      try {
        await safeRemove(to);
      } catch (_) {
        // safeRemove idempotent — report verify error even during exception
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
