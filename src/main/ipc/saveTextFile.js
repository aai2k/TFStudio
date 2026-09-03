// Save dialog followed by one UTF-8 text write, the shape every text export
// handler shares. `options` are the dialog's title, defaultPath and filters;
// `channel` names the handler in the log. Returns `{ success, filePath }`,
// `{ success: false, canceled: true }` when the dialog is dismissed, or
// `{ success: false, error }`.
//
// CommonJS, Electron-free (deps via ctx).
async function saveTextFile(ctx, channel, text, options) {
  const { dialog, getMainWindow, fs, log } = ctx;
  try {
    if (typeof text !== 'string' || text.length === 0) return { success: false, error: 'Nothing to write' };
    const result = await dialog.showSaveDialog(getMainWindow(), options);
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    fs.writeFileSync(result.filePath, text, 'utf-8');
    return { success: true, filePath: result.filePath };
  } catch (err) {
    log(`${channel} error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { saveTextFile };
