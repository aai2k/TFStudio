// IPC: display defaults for the analysis windows (curve colours, ranges).
//
// Stored under the `analysis` key in settings.json. The renderer sends the
// whole override block; validation of individual fields happens in the renderer
// against the registry (src/constants/analysisDefaults.js), and again when the
// block is resolved for a window, so a malformed value can never reach a plot.
// Reading is covered by the existing load-settings channel.
//
// CommonJS, Electron-free (deps via ctx).
const { writeMainOwnedKey } = require('../settingsFile');

function register(ipcMain, ctx) {
  ipcMain.handle('analysis:save-settings', async (event, block) => handleSave(ctx, block));
}

function handleSave(ctx, block) {
  try {
    writeMainOwnedKey(ctx, 'analysis', block && typeof block === 'object' ? block : {});
    return { success: true };
  } catch (err) {
    ctx.log(`analysis:save-settings error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { register };
