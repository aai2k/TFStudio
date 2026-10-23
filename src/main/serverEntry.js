/**
 * TFStudio.exe --mcp and TFStudio.exe --api: a server on stdin and stdout, with
 * no window, on the data folder the app itself uses, so it sees the user's
 * catalogs. --mcp starts the MCP server (src/mcp/server.js), --api the API
 * server (src/apiServer/server.js).
 *
 * On Windows the main process of an Electron app gets no piped stdin, so the
 * server runs in a child of it started as plain Node (ELECTRON_RUN_AS_NODE),
 * which takes over this process's stdin, stdout and stderr; this process waits
 * and ends with it. The child runs serverChild.js, which loads the server: an
 * installed app's bundle (build/app/<folder>/, made by
 * tools/build-renderer.mjs and kept outside the asar archive so the threads it
 * starts can load it), or src/<folder>/ in a source checkout.
 *
 * CommonJS, like the rest of the main process.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createUserPaths } = require('./userPaths');
const { readJsonSafe } = require('./paths');

// Each server by the kind main.js names it: the folder its module is in, under
// src/ and under build/app/, and what the log calls it.
const SERVERS = {
  mcp: { folder: 'mcp', name: 'MCP server' },
  api: { folder: 'apiServer', name: 'API server' },
};

// The data folder the app would run from, or null when it holds no Materials
// folder yet (the app makes one on its first start). Read only: the server
// creates and moves nothing.
function dataFolder({ app, exeDir, settingsPath, log }) {
  const userPaths = createUserPaths({ documentsDir: app.getPath('documents'), fs, path, exeDir, log });
  userPaths.load(readJsonSafe(settingsPath));
  const materials = userPaths.get('materials');
  return fs.existsSync(materials) ? path.dirname(materials) : null;
}

/**
 * Starts the server of `kind` ('mcp' or 'api') and ends the app with the
 * server's exit code once the client has closed stdin. It runs on `dataDir`
 * when given, otherwise on the app's data folder, which `settingsPath` (the
 * app's settings.json) says where it is. `liveFile`, given with --live, is the
 * live link file the open app writes, which links the server to it
 * (liveProtocol.js); null otherwise. `program` is the name --program gives,
 * which the app shows for the program the server serves, or null.
 */
function startServer({ kind, app, isPackaged, exeDir, settingsPath, dataDir, liveFile, program, log }) {
  const { folder, name } = SERVERS[kind];
  const options = {
    dataDir: dataDir ?? dataFolder({ app, exeDir, settingsPath, log }),
    version: app.getVersion(),
    wasmPath: isPackaged ? path.join(process.resourcesPath, 'tmm_kernel.wasm') : undefined,
    live: liveFile ? { file: liveFile, program } : undefined,
    server: isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'app', folder, 'server.js')
      : path.join(__dirname, '..', folder, 'server.js'),
    bundled: isPackaged,
  };
  const child = spawn(process.execPath, [path.join(__dirname, 'serverChild.js'), JSON.stringify(options)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true,
  });
  child.on('error', err => { log(`${name} could not start: ${err.message}`); app.exit(1); });
  child.on('exit', code => app.exit(code ?? 1));
}

module.exports = { startServer };
