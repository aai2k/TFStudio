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
  const { userPaths, log, dataFolderMove: move } = ctx;
  const fsp = ctx.fs.promises;

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
      // persist succeeded → commit (ensureAll + notify + clean old directory)
      userPaths.ensureAll();
      ctx.onUserPathsChanged?.();

      // Only the copy path leaves an old folder behind; a rename already moved it.
      let warning = null;
      if (!isSameDisk) {
        try {
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
      // The files are already at dir. Roll memory back, then rename them back.
      userPaths.applyRoot(previousRoot);
      try {
        await fsp.rename(dir, currentRoot);
        return { success: false, error: saved.error, folders: userPaths.list() };
      } catch (_) {
        // The files could not be moved back either, so keep them where they are
        // and try once more to save settings that point at dir.
        userPaths.applyRoot(dir);
        const secondPersist = persist(ctx);
        if (secondPersist.success) {
          return {
            success: true,
            folders: userPaths.list(),
            warning: `data moved to ${dir} but settings were recovered`,
          };
        }
        // Settings still could not be written. The data is at dir and the app
        // runs from there for this session; the pane says so. onUserPathsChanged
        // stays unfired, so nothing re-seeds against a root that will not survive
        // a restart.
        userPaths.applyRoot(dir);
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
    } else {
      // The copy is complete but unreferenced. Drop it and keep the old folder.
      userPaths.applyRoot(previousRoot);
      try {
        await fsp.rm(dir, { recursive: true, force: true });
      } catch (cleanupErr) {
        return { success: false, error: `${saved.error} (cleanup of ${dir} failed: ${cleanupErr.message})`, folders: userPaths.list() };
      }
      return { success: false, error: saved.error, folders: userPaths.list() };
    }
  } finally {
    moveInProgress = false;
  }
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
