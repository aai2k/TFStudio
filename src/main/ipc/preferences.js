// IPC: the portable preferences file (src/main/preferencesFile.js).
//
// A save replaces one named block and re-reads the file first, so the version
// and anything a later release adds beside it survive the write.
//
// CommonJS, Electron-free (deps via ctx).
const preferencesFile = require('../preferencesFile');

function register(ipcMain, ctx) {
  ipcMain.handle('prefs:load', async () => handleLoad(ctx));
  ipcMain.handle('prefs:save-analysis', async (event, block) => handleSave(ctx, 'analysis', block));
}

function handleLoad(ctx) {
  try {
    return { success: true, prefs: preferencesFile.load(ctx) };
  } catch (err) {
    ctx.log(`prefs:load error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function handleSave(ctx, name, block) {
  try {
    return { success: true, prefs: preferencesFile.saveBlock(ctx, name, block) };
  } catch (err) {
    ctx.log(`prefs:save-${name} error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { register };
