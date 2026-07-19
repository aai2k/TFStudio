// IPC: Zemax OpticStudio COATING.DAT import / export.
//   zemax:pick-coating-file — open dialog, read a .dat (UTF-16/UTF-8 aware),
//                             return its text for the renderer to parse.
//   zemax:save-coating-file — save dialog, write generated .dat text (UTF-8).
//
// Parsing/generation live in the renderer (utils/io/zemaxCoatingFile.js); these
// handlers only do file I/O. CommonJS, Electron-free (deps via ctx).

// Decode honoring a byte-order mark — the sample COATING.DAT Zemax ships is
// UTF-16 LE with a BOM, which decodes to NUL-interleaved garbage as UTF-8.
// Best-effort default folder: the standard Zemax coatings directory.
function defaultZemaxDir(fs, path) {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (!home) return undefined;
  const dir = path.join(home, 'Documents', 'Zemax', 'Coatings');
  try { if (fs.existsSync(dir)) return dir; } catch (_) {}
  return undefined;
}

function register(ipcMain, ctx) {
  ipcMain.handle('zemax:pick-coating-file', async () => handlePickCoatingFile(ctx));
  ipcMain.handle('zemax:save-coating-file', async (event, text, suggestedName) => handleSaveCoatingFile(ctx, text, suggestedName));
}

async function handlePickCoatingFile(ctx) {
  const { dialog, getMainWindow, fs, path, log, readTextAuto } = ctx;
  try {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Import Zemax Coating File (COATING.DAT)',
      defaultPath: defaultZemaxDir(fs, path),
      filters: [
        { name: 'Zemax Coating File', extensions: ['dat', 'DAT'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
    const filePath = result.filePaths[0];
    const text = readTextAuto(filePath);
    return { success: true, text, fileName: path.basename(filePath), filePath };
  } catch (err) {
    log(`zemax:pick-coating-file error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function handleSaveCoatingFile(ctx, text, suggestedName) {
  const { dialog, getMainWindow, fs, log } = ctx;
  try {
    if (typeof text !== 'string' || text.length === 0) return { success: false, error: 'Nothing to write' };
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: 'Export Zemax Coating File',
      defaultPath: suggestedName || 'COATING.DAT',
      filters: [{ name: 'Zemax Coating File', extensions: ['dat'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    fs.writeFileSync(result.filePath, text, 'utf-8');
    return { success: true, filePath: result.filePath };
  } catch (err) {
    log(`zemax:save-coating-file error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { register };
