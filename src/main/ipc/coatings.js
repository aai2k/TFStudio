// IPC: Coating library entries (Documents\TFStudio\Coatings\<name>.tfsc). Each
// coating a user saves from the Design Editor or the Coating Library window is
// its own JSON file: `{ ver:1, name, type, use, substrate, band, layers, ... }`,
// the entry shape documented in src/utils/coatingLibrary/entryModel.js.
//
// CommonJS, Electron-free (deps via ctx).
const { registerJsonPresetStore } = require('./jsonPresetStore');

function register(ipcMain, ctx) {
  registerJsonPresetStore(ipcMain, ctx, 'coatings');
}

module.exports = { register };
