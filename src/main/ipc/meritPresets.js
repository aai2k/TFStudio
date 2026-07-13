// IPC: Merit-function Presets (Documents\TFStudio\MeritFunctions\<name>.tfsm). A
// reusable MF table saved independently of any design. Format
// `{ ver:1, name, description?, operands: [...] }` — the operands array matches
// design.meritOperands in shape.
//
// CommonJS, Electron-free (deps via ctx).
const { registerJsonPresetStore } = require('./jsonPresetStore');

function register(ipcMain, ctx) {
  registerJsonPresetStore(ipcMain, ctx, 'meritFunctions');
}

module.exports = { register };
