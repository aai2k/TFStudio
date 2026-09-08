/**
 * Moving the data folder from one place to another.
 *
 *   createDataFolderMove({ fs, path }) => { checkTarget, moveTree }
 *
 * checkTarget decides whether a folder may be moved to, and writes nothing.
 * moveTree does the work: a rename where the file system allows one, otherwise
 * copy and verify. It never deletes the source and never touches settings, so
 * the caller still holds a complete copy whatever the outcome.
 *
 * The file operations are async because the bundled refractiveindex mirror
 * alone is around 4000 files and the window must stay responsive.
 */

'use strict';

/**
 * @param {{ fs: object, path: object }} deps — fs and path, injected for testing
 * @returns {{ checkTarget: Function, moveTree: Function }}
 */
function createDataFolderMove({ fs: _fs, path: _path }) {

  // ── Path normalization ────────────────────────────────────────────────────
  // Absolute form with any trailing separator removed. Case is left alone and
  // symlinks are not resolved; the paths come from the directory picker.
  function normalize(p) {
    let r = _path.resolve(p);
    if (r.length > 1 && (r.endsWith('/') || r.endsWith('\\'))) {
      r = r.slice(0, -1);
    }
    return r;
  }

  // ── checkTarget(current, target) ──────────────────────────────────────

  /**
   * Whether the data folder may be moved to target.
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
   * Walk a tree and tally what is in it, for the copy check.
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
   * Copy a tree file by file, recreating symlinks as links.
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
        await _fs.promises.copyFile(src, dst);
      }
    }
  }

  /**
   * The copy is accepted only when file count, byte count and directory count
   * all match the source.
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
   * Remove a directory if it is there. Carries the path on the error so the
   * caller can name what was left behind.
   * @returns {Promise<void>}
   */
  async function safeRemove(dir) {
    try {
      await _fs.promises.rm(dir, { recursive: true, force: true });
    } catch (err) {
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
   * Move a tree from → to.
   *
   * A rename is tried first and is what happens within one volume: it is
   * instant and cannot leave half a folder behind. Whether the two paths are
   * on the same volume is left to the file system to answer rather than
   * guessed from device numbers, which are unreliable across mounts and
   * mapped drives. EXDEV means they are not, and the move becomes a copy that
   * is verified before the caller is told it succeeded. Windows answers EPERM
   * or EEXIST when the target directory already exists, so an empty one is
   * removed and the rename tried again.
   *
   * A failed copy takes its own partial output with it. The source is never
   * deleted here.
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

      // Different volume.
      if (code === 'EXDEV') {
        return await doCopyWithVerify(resolvedFrom, resolvedTo);
      }

      // The target directory is in the way.
      if (code === 'EPERM' || code === 'EEXIST') {
        const nonEmpty = await isNonEmptyDir(resolvedTo);
        if (nonEmpty) {
          return {
            success: false,
            error: `target directory is not empty (${code})`,
            crossDevice: false,
          };
        }
        try {
          await _fs.promises.rmdir(resolvedTo);
        } catch (_) {
          return await doCopyWithVerify(resolvedFrom, resolvedTo);
        }
        try {
          await _fs.promises.rename(resolvedFrom, resolvedTo);
          return { success: true, method: 'rename' };
        } catch (_) {
          return await doCopyWithVerify(resolvedFrom, resolvedTo);
        }
      }

      return {
        success: false,
        error: err.message || String(err),
        crossDevice: false,
      };
    }
  }

  /**
   * Copy and verify, for a target on another volume.
   * @returns {Promise<{ success: boolean, method?: string, error?: string, crossDevice?: boolean }>}
   */
  async function doCopyWithVerify(from, to) {
    // The target was checked before the move started, so check again: something
    // may have written into it since, and a copy into an occupied folder would
    // mix two sets of data.
    try {
      await _fs.promises.stat(to);
      const nonEmpty = await isNonEmptyDir(to);
      if (nonEmpty) {
        return {
          success: false,
          error: 'target directory already exists and is not empty',
          crossDevice: true,
        };
      }
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

    // A copy that cannot be verified is removed, so a half-written folder is
    // never left standing next to the original.
    let vResult;
    try {
      vResult = await verifyCopy(from, to);
    } catch (verifyErr) {
      try { await safeRemove(to); } catch (_) {}
      return { success: false, error: `verify exception: ${verifyErr.message}`, crossDevice: true };
    }
    if (!vResult.ok) {
      try {
        await safeRemove(to);
      } catch (_) {
        // Removing it failed too; the verify failure is the useful half.
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
