// IPC: user-configurable data folders (designs, materials, presets, branding).
//
// Overrides are persisted into the existing settings.json under a `folders`
// key so the app keeps one settings file. The renderer's save-settings payload
// does not carry `folders`, so writes here go through readJsonSafe + merge and
// projects.js preserves the key on its own writes.
//
// CommonJS, Electron-free (deps via ctx).
const { writeMainOwnedKey } = require('../settingsFile');

function register(ipcMain, ctx) {
  ipcMain.handle('paths:list', async () => handleList(ctx));
  ipcMain.handle('paths:choose', async (event, key) => handleChoose(ctx, key));
  ipcMain.handle('paths:set', async (event, key, dir) => handleSet(ctx, key, dir));
  ipcMain.handle('paths:reset', async (event, key) => handleReset(ctx, key));
  ipcMain.handle('paths:reveal', async (event, key) => handleReveal(ctx, key));
}

// Write the current override set back into settings.json without disturbing the
// renderer-owned keys already in the file.
function persist(ctx) {
  try {
    writeMainOwnedKey(ctx, 'folders', ctx.userPaths.toSettings());
    return { success: true };
  } catch (err) {
    ctx.log(`paths persist error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function handleList(ctx) {
  return { success: true, folders: ctx.userPaths.list() };
}

async function handleChoose(ctx, key) {
  const { dialog, getMainWindow, userPaths } = ctx;
  const current = userPaths.get(key);
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: 'Choose folder',
    defaultPath: current,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  return handleSet(ctx, key, result.filePaths[0]);
}

// Applying a change re-runs directory creation and material seeding so the new
// folder is populated before anything reads from it.
function applyChange(ctx, outcome) {
  if (!outcome.success) return outcome;
  ctx.onUserPathsChanged?.();
  const saved = persist(ctx);
  if (!saved.success) return saved;
  return { ...outcome, folders: ctx.userPaths.list() };
}

function handleSet(ctx, key, dir) {
  return applyChange(ctx, ctx.userPaths.set(key, dir));
}

function handleReset(ctx, key) {
  return applyChange(ctx, ctx.userPaths.reset(key));
}

async function handleReveal(ctx, key) {
  const { shell, userPaths, log } = ctx;
  try {
    const error = await shell.openPath(userPaths.get(key));
    // openPath resolves with a non-empty string to report failure.
    if (error) return { success: false, error };
    return { success: true };
  } catch (err) {
    log(`paths:reveal error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { register };
