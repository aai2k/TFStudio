// IPC: Qualifier Presets (Documents\TFStudio\Qualifiers\<name>.tfsq). Each saved
// Specification preset lives in its own JSON file (.tfsq). Format
// `{ ver:1, name, description?, qualifiers: [...] }` — the qualifiers array
// matches design.qualifiers in shape.
//
// CommonJS, Electron-free (deps via ctx).
const { registerJsonPresetStore } = require('./jsonPresetStore');

function register(ipcMain, ctx) {
  registerJsonPresetStore(ipcMain, ctx, 'qualifiers');
}

module.exports = { register };
