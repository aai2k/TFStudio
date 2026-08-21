// IPC: the portable preferences file (src/main/preferencesFile.js).
//
// One channel per block rather than one whole-file write, so a window saving
// its defaults cannot overwrite a colour the Settings pane changed a moment
// earlier: each save re-reads the file and replaces only its own block.
//
// CommonJS, Electron-free (deps via ctx).
const preferencesFile = require('../preferencesFile');

function register(ipcMain, ctx) {
  ipcMain.handle('prefs:load', async () => handleLoad(ctx));
  ipcMain.handle('prefs:save-analysis', async (event, block) => handleSave(ctx, 'analysis', block));
  ipcMain.handle('prefs:save-windows', async (event, block) => handleSave(ctx, 'windows', block));
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
