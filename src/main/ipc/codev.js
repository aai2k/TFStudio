// IPC: CODE V MULTILAYER (MUL) coating import / export.
//   codev:pick-coating-file: open dialog for a .seq command file or a .mul file
//                            saved by CODE V, return its text for the renderer
//                            to parse.
//   codev:save-coating-file: save dialog, write generated .seq text (UTF-8).
//
// Parsing and generation live in the renderer (utils/io/codevCoatingFile.js);
// these handlers only do file I/O. CommonJS, Electron-free (deps via ctx).

const { saveTextFile } = require('./saveTextFile');

function register(ipcMain, ctx) {
  ipcMain.handle('codev:pick-coating-file', async () => handlePickCoatingFile(ctx));
  ipcMain.handle('codev:save-coating-file', async (event, text, suggestedName) => handleSaveCoatingFile(ctx, text, suggestedName));
}

async function handlePickCoatingFile(ctx) {
  const { dialog, getMainWindow, path, log, readTextAuto } = ctx;
  try {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Import CODE V Coating (.seq, .mul)',
      filters: [
        { name: 'CODE V Coating', extensions: ['seq', 'mul', 'SEQ', 'MUL'] },
        { name: 'CODE V Sequence File', extensions: ['seq', 'SEQ'] },
        { name: 'CODE V MUL File', extensions: ['mul', 'MUL'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
    const filePath = result.filePaths[0];
    const text = readTextAuto(filePath);
    return { success: true, text, fileName: path.basename(filePath), filePath };
  } catch (err) {
    log(`codev:pick-coating-file error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function handleSaveCoatingFile(ctx, text, suggestedName) {
  return saveTextFile(ctx, 'codev:save-coating-file', text, {
    title: 'Export CODE V Coating',
    defaultPath: suggestedName || 'coating.seq',
    filters: [{ name: 'CODE V Sequence File', extensions: ['seq'] }],
  });
}

module.exports = { register };
