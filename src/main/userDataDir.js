// The folder Electron keeps its userData in: the Chromium profile, whose
// localStorage holds the session of unsaved designs, and settings.json.
//
// The portable build and a run from source keep it beside the exe as AppData,
// in the directory resolveExeDir (paths.js) returns. An installed build keeps
// it in the per-user application data folder, because an update runs the
// previous version's uninstaller, which deletes the install folder and
// everything in it. build/installer.nsh copies an older install's AppData into
// this same folder before that happens.
//
// CommonJS, Electron-free.
const path = require('path');

// The folder an installer put the app in, which the next update's uninstaller
// deletes with everything in it. Null for the portable build and a run from
// source, whose folders no uninstaller touches.
function resolveInstallDir({ portableDir, isPackaged, exeDir }) {
  return portableDir || !isPackaged ? null : exeDir;
}

function resolveUserDataDir({ portableDir, isPackaged, exeDir, appDataDir }) {
  if (!resolveInstallDir({ portableDir, isPackaged, exeDir })) return path.join(exeDir, 'AppData');
  return path.join(appDataDir, 'TFStudio');
}

module.exports = { resolveUserDataDir, resolveInstallDir };
