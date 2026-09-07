// IPC: single Data Folder migration transaction coordinator.
//
// Four constraints:
//   1. mutate has no validation (applyRoot is a pure assignment; validation is front-loaded to checkTarget)
//   2. rollback: call applyRoot(previousRoot) directly to restore memory (no longer relies on loadOverrides)
//   3. onUserPathsChanged short-circuit: never triggered on compensation-failure paths (incl. prepareMaterialsDir seed side effects)
//   4. compensation double-flip: same-disk compensation failure → switch memory back to new (direct assignment)
//
// CommonJS, Electron-free (deps via ctx), move factory injectable (testability).

const { writeMainOwnedKey } = require('../settingsFile');

// ── move mutex ────────────────────────────────────────────────────────────
let moveInProgress = false;

// ── Handler contract ──────────────────────────────────────────────────────
//
// paths:list → { success, folders: { root, defaultRoot, configuredRoot,
//                overridden, rejected, subfolders: [9 entries] } }
// paths:choose → { success, canceled?, path } (returns path only, does not trigger set)
// paths:set(dir) → transaction return (incl. warning / critical variants)
// paths:reset → equivalent to set(defaultPath) (no-op when already default)
// paths:reveal(key?) → both root and subdirectories can be opened

function register(ipcMain, ctx, moveFactory) {
  ipcMain.handle('paths:list', async () => handleList(ctx));
  ipcMain.handle('paths:choose', async (event, key) => handleChoose(ctx, key));
  ipcMain.handle('paths:set', async (event, key, dir) => handleSet(ctx, key, dir));
  ipcMain.handle('paths:reset', async (event, key) => handleReset(ctx, key));
  ipcMain.handle('paths:reveal', async (event, key) => handleReveal(ctx, key));
  // inject move factory (default uses the real dataFolderMove)
  ctx.moveFactory = moveFactory || null;
}

// ── internal: get the move factory instance ──────────────────────────────
function getMove(ctx) {
  if (ctx.moveFactory) return ctx.moveFactory;
  // default: lazy require, avoids circular dependency + test injection
  const { createDataFolderMove } = require('../dataFolderMove');
  const deps = { fs: require('fs'), path: require('path') };
  return createDataFolderMove(deps);
}

// ── persist: writeMainOwnedKey whole-block replacement semantics ─────────
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

// ── paths:choose (returns the chosen path only, does not trigger set) ─────
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

// ── paths:set(dir) — core transaction coordinator ────────────────────────
// Inline transaction (snapshot → persist → rollback, replicating the old applyChange semantics):
async function handleSet(ctx, _key, dir) {
  const { userPaths, log } = ctx;

  // move mutex (shared by set / reset)
  if (moveInProgress) {
    return { success: false, error: 'data folder move already in progress' };
  }
  moveInProgress = true;

  try {
    const currentRoot = userPaths.rootDir;
    const move = getMove(ctx);

    // 1. checkTarget — pure check, no side effects
    const validation = move.checkTarget(currentRoot, dir);
    if (!validation.ok) {
      return { success: false, error: validation.reason, folders: userPaths.list() };
    }

    // 2. moveTree — async rename / copy+verify
    const moveResult = await move.moveTree(currentRoot, dir);

    if (!moveResult.success) {
      // moveTree failed (copy/verify failure already partial-cleaned)
      return { success: false, error: moveResult.error, folders: userPaths.list() };
    }

    // ── moveTree succeeded ───────────────────────────────────────────────
    const method = moveResult.method; // 'rename' | 'copy'
    const isSameDisk = method === 'rename';

    // 3. applyChange transaction: snapshot → temporary switch → persist → commit on success / rollback on failure
    // Key: applyRoot is called before persist (needs to serialize the new root); roll back immediately if persist fails.
    const previousRoot = userPaths.rootDir;
    userPaths.applyRoot(dir);

    const saved = persist(ctx);

    if (saved.success) {
      // persist succeeded → commit (ensureAll + notify + clean old directory)
      userPaths.ensureAll();
      ctx.onUserPathsChanged?.();

      // delete old (only needed on the cross-disk copy path; same-disk rename already moved it)
      let warning = null;
      if (!isSameDisk) {
        try {
          const { promises: fsp } = require('fs');
          await fsp.rm(currentRoot, { recursive: true, force: true });
        } catch (_) {
          warning = `old folder still exists at ${currentRoot}`;
        }
      }

      const result = { success: true, folders: userPaths.list() };
      if (warning) result.warning = warning;
      return result;
    }

    // ── persist failed → rollback ────────────────────────────────────────
    if (isSameDisk) {
      // same disk: data already renamed to dir, first roll back memory, then compensate rename(dir → currentRoot)
      userPaths.applyRoot(previousRoot);
      try {
        const { promises: fsp } = require('fs');
        await fsp.rename(dir, currentRoot);
        // compensation succeeded → three-way consistent (old), memory already rolled back
        return { success: false, error: saved.error, folders: userPaths.list() };
      } catch (_) {
        // compensation rename also failed → second persist(newRoot)
        // data is in dir, memory is previousRoot → switch to dir so persist writes newRoot
        userPaths.applyRoot(dir);
        const secondPersist = persist(ctx);
        if (secondPersist.success) {
          // second persist succeeded → warning (data in new, settings recovered)
          return {
            success: true,
            folders: userPaths.list(),
            warning: `data moved to ${dir} but settings were recovered`,
          };
        }
        // second persist still failed → memory switch to new + critical
        // constraint #4: direct internal assignment, not through applyChange
        userPaths.applyRoot(dir);
        userPaths.ensureAll();
        // critical writes rejected so list() reflects the warning trace
        userPaths.setRejected(currentRoot, 'settings could not be saved');
        // constraint #3: never trigger onUserPathsChanged
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
      // cross disk: copy done but persist failed → roll back memory + delete new copy, keep old
      userPaths.applyRoot(previousRoot);
      try {
        const { promises: fsp } = require('fs');
        await fsp.rm(dir, { recursive: true, force: true });
      } catch (cleanupErr) {
        // on cleanup failure, append the cleanup path info to the error
        return { success: false, error: `${saved.error} (cleanup of ${dir} failed: ${cleanupErr.message})`, folders: userPaths.list() };
      }
      return { success: false, error: saved.error, folders: userPaths.list() };
    }
  } finally {
    moveInProgress = false;
  }
}

// ── paths:reset — equivalent to set(defaultPath) ─────────────────────────
async function handleReset(ctx, _key) {
  const { userPaths } = ctx;
  const defaultPath = userPaths.baseDir;

  // already default and not fallback → no-op success
  if (userPaths.rootDir === defaultPath && userPaths.rejected === null) {
    return { success: true, folders: userPaths.list() };
  }

  // in fallback state (rejected != null), even if active is already defaultRoot,
  // still clear configuredRoot (user explicitly gives up the original config)
  if (userPaths.rootDir === defaultPath && userPaths.rejected !== null) {
    userPaths.clearOverride();
    persist(ctx);
    return { success: true, folders: userPaths.list() };
  }

  // delegate to handleSet (reuse the full transaction flow)
  return handleSet(ctx, null, defaultPath);
}

// ── paths:reveal(key?) — both root and subdirectories can be opened ──────
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
