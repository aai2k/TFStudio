// IPC: measured-spectrum text import / export.
//   spectrum:pick-file — open dialog, read a text spectrum (.csv/.txt/.asc/.dx/
//                        .jdx/.prn/.dat, BOM-aware), return raw text for the
//                        renderer to parse (parsing lives in
//                        utils/io/spectrumTable.js — pure + testable).
//   spectrum:save-file — save dialog, write generated CSV text (UTF-8).
//
// Mirrors the Zemax COATING.DAT handler: handlers do file I/O only.
// CommonJS, Electron-free (deps via ctx).

const { saveTextFile } = require('./saveTextFile');

function register(ipcMain, ctx) {
  ipcMain.handle('spectrum:pick-file', async () => handlePickFile(ctx));
  ipcMain.handle('spectrum:save-file', async (event, text, suggestedName) => handleSaveFile(ctx, text, suggestedName));
}

async function handlePickFile(ctx) {
  const { dialog, getMainWindow, path, log, readTextAuto } = ctx;
  try {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Import Measured Spectrum',
      filters: [
        { name: 'Spectrum Text Files', extensions: ['csv', 'txt', 'asc', 'prn', 'dx', 'jdx', 'dat', 'tsv'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
    const filePath = result.filePaths[0];
    const text = readTextAuto(filePath);
    return { success: true, text, fileName: path.basename(filePath), filePath };
  } catch (err) {
    log(`spectrum:pick-file error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function handleSaveFile(ctx, text, suggestedName) {
  return saveTextFile(ctx, 'spectrum:save-file', text, {
    title: 'Export Spectrum (CSV)',
    defaultPath: suggestedName || 'spectrum.csv',
    filters: [
      { name: 'CSV', extensions: ['csv'] },
      { name: 'JCAMP-DX', extensions: ['dx', 'jdx'] },
      { name: 'Text', extensions: ['txt'] },
    ],
  });
}

module.exports = { register };
