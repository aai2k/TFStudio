// IPC: Coating library entries (Documents\TFStudio\Coatings\<name>.tfsc). Each
// coating a user saves from the Design Editor or the Coating Library window is
// its own JSON file: `{ ver:1, name, type, use, substrate, band, layers, ... }`,
// the entry shape documented in src/utils/coatingLibrary/entryModel.js.
//
//   coatings:pack — save dialog, write one entry as a .json file the user can
//   attach to a contribution issue or an email.
//
// CommonJS, Electron-free (deps via ctx).
const { registerJsonPresetStore } = require('./jsonPresetStore');
const { saveTextFile } = require('./saveTextFile');

function register(ipcMain, ctx) {
  registerJsonPresetStore(ipcMain, ctx, 'coatings');
  ipcMain.handle('coatings:pack', async (event, text, suggestedName) => handlePack(ctx, text, suggestedName));
}

function handlePack(ctx, text, suggestedName) {
  return saveTextFile(ctx, 'coatings:pack', text, {
    title: 'Save Coating for Sending',
    defaultPath: suggestedName || 'coating.tfsc.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
}

module.exports = { register };
