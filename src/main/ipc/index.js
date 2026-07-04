// IPC registry — fans out a shared `ctx` to each domain handler module.
//
// main.js builds `ctx` once (shared services: app, shell, dialog, fs, path, log,
// getMainWindow, helpServer, safe* path helpers, dir paths, …) and
// calls registerAllIpc(ipcMain, ctx). Each module exports register(ipcMain, ctx).
const appWindow = require('./appWindow');
const wasm = require('./wasm');
const projects = require('./projects');
const catalogs = require('./catalogs');
const integrals = require('./integrals');
const qualifiers = require('./qualifiers');
const meritPresets = require('./meritPresets');
const report = require('./report');
const processFiles = require('./process');
const rii = require('./rii');
const zemax = require('./zemax');
const spectrum = require('./spectrum');

function registerAllIpc(ipcMain, ctx) {
  appWindow.register(ipcMain, ctx);
  wasm.register(ipcMain, ctx);
  projects.register(ipcMain, ctx);
  catalogs.register(ipcMain, ctx);
  integrals.register(ipcMain, ctx);
  qualifiers.register(ipcMain, ctx);
  meritPresets.register(ipcMain, ctx);
  report.register(ipcMain, ctx);
  processFiles.register(ipcMain, ctx);
  rii.register(ipcMain, ctx);
  zemax.register(ipcMain, ctx);
  spectrum.register(ipcMain, ctx);
}

module.exports = { registerAllIpc };
