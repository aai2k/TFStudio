// IPC: the data folder move.
//
// A move runs as check → move the files → switch the in-memory root → write
// settings. Everything that can refuse a target is decided by checkTarget
// before a single file is touched, so applyRoot is a plain assignment. Every
// failure after the files have moved is compensated, and the user is always
// left with one complete copy of the data and settings that point at it.

const { writeMainOwnedKey } = require('../settingsFile');

// ── move mutex ────────────────────────────────────────────────────────────
let moveInProgress = false;

// ── Handler contract ──────────────────────────────────────────────────────
//
// paths:list → { success, folders: { root, defaultRoot, configuredRoot,
//                overridden, rejected, subfolders: [9 entries] } }
// paths:choose → { success, canceled?, path } (picks only, does not move)
// paths:set(dir) → transaction result, with warning and critical variants
// paths:reset → set(defaultPath), a no-op when already default
// paths:reveal(key?) → opens the root, or one subfolder

function register(ipcMain, ctx) {
  ipcMain.handle('paths:list', async () => handleList(ctx));
  ipcMain.handle('paths:choose', async () => handleChoose(ctx));
  ipcMain.handle('paths:set', async (event, key, dir) => handleSet(ctx, key, dir));
  ipcMain.handle('paths:reset', async (event, key) => handleReset(ctx, key));
  ipcMain.handle('paths:reveal', async (event, key) => handleReveal(ctx, key));
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
async function handleChoose(ctx) {
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

// ── paths:set(dir) ────────────────────────────────────────────────────────
async function handleSet(ctx, _key, dir) {
  const { userPaths, dataFolderMove: move } = ctx;

  // One move at a time, shared by set and reset.
  if (moveInProgress) {
    return { success: false, error: 'data folder move already in progress' };
  }
  moveInProgress = true;

  try {
    const currentRoot = userPaths.rootDir;

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

    // 3. Switch the in-memory root before persisting, since toSettings()
    //    serializes what is in memory. A failed write is rolled back at once.
    const previousRoot = userPaths.rootDir;
    userPaths.applyRoot(dir);

    const saved = persist(ctx);

    if (saved.success) {
      return await commitMove(ctx, { currentRoot, isSameDisk });
    }
    return isSameDisk
      ? await rollbackRename(ctx, { dir, currentRoot, previousRoot, error: saved.error })
      : await rollbackCopy(ctx, { dir, previousRoot, error: saved.error });
  } finally {
    moveInProgress = false;
  }
}

// The settings write succeeded: create anything missing under the new root,
// tell the renderer, and drop the old folder. Only the copy path leaves one
// behind, and a folder that will not delete is a warning, not a failure.
async function commitMove(ctx, { currentRoot, isSameDisk }) {
  const { userPaths } = ctx;
  userPaths.ensureAll();
  ctx.onUserPathsChanged?.();

  if (isSameDisk) return { success: true, folders: userPaths.list() };

  try {
    await ctx.fs.promises.rm(currentRoot, { recursive: true, force: true });
  } catch (_) {
    return {
      success: true,
      folders: userPaths.list(),
      warning: `old folder still exists at ${currentRoot}`,
    };
  }
  return { success: true, folders: userPaths.list() };
}

// The settings write failed after a rename. The files are at dir, so move them
// back. If that fails they stay where they are and settings are written a
// second time to match.
async function rollbackRename(ctx, { dir, currentRoot, previousRoot, error }) {
  const { userPaths, log } = ctx;
  userPaths.applyRoot(previousRoot);
  try {
    await ctx.fs.promises.rename(dir, currentRoot);
    return { success: false, error, folders: userPaths.list() };
  } catch (_) {
    userPaths.applyRoot(dir);
    if (persist(ctx).success) {
      return {
        success: true,
        folders: userPaths.list(),
        warning: `data moved to ${dir} but settings were recovered`,
      };
    }
    // Neither write went through. The data is at dir and the app runs from
    // there for this session; the pane says so. onUserPathsChanged stays
    // unfired, so nothing re-seeds against a root that will not survive a
    // restart.
    userPaths.ensureAll();
    userPaths.setRejected(currentRoot, 'settings could not be saved');
    log(`CRITICAL: data at ${dir}, settings could not be saved`);
    return {
      success: false,
      critical: true,
      dataLocation: dir,
      reason: 'settings could not be saved',
      folders: userPaths.list(),
    };
  }
}

// The settings write failed after a copy. The copy is complete but nothing
// refers to it, so drop it and keep the old folder.
async function rollbackCopy(ctx, { dir, previousRoot, error }) {
  const { userPaths } = ctx;
  userPaths.applyRoot(previousRoot);
  try {
    await ctx.fs.promises.rm(dir, { recursive: true, force: true });
  } catch (cleanupErr) {
    return {
      success: false,
      error: `${error} (cleanup of ${dir} failed: ${cleanupErr.message})`,
      folders: userPaths.list(),
    };
  }
  return { success: false, error, folders: userPaths.list() };
}

// ── paths:reset — set(defaultPath) ───────────────────────────────────────
async function handleReset(ctx, _key) {
  const { userPaths } = ctx;
  const defaultPath = userPaths.baseDir;

  if (userPaths.rootDir === defaultPath && userPaths.rejected === null) {
    return { success: true, folders: userPaths.list() };
  }

  // Running from the default because the configured folder was unusable. There
  // is nothing to move; Reset means the user gives that folder up for good.
  if (userPaths.rootDir === defaultPath && userPaths.rejected !== null) {
    userPaths.clearOverride();
    const saved = persist(ctx);
    if (!saved.success) {
      return { success: false, error: saved.error, folders: userPaths.list() };
    }
    return { success: true, folders: userPaths.list() };
  }

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
