/**
 * TFStudio.exe --mcp: the MCP server (src/mcp/server.js) on stdin and stdout,
 * with no window, on the data folder the app itself uses, so its tools see the
 * user's catalogs.
 *
 * On Windows the main process of an Electron app gets no piped stdin, so the
 * server runs in a child of it started as plain Node (ELECTRON_RUN_AS_NODE),
 * which takes over this process's stdin, stdout and stderr; this process waits
 * and ends with it. The child runs mcpChild.js, which loads the server: an
 * installed app's bundle (build/app/mcp/, made by tools/build-renderer.mjs and
 * kept outside the asar archive so its job threads can load it), or src/mcp/
 * in a source checkout.
 *
 * CommonJS, like the rest of the main process.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createUserPaths } = require('./userPaths');
const { readJsonSafe } = require('./paths');

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
 * Starts the server on the app's data folder, which `settingsPath` (the app's
 * settings.json) says where it is, and ends the app with the server's exit
 * code once the client has closed stdin. `liveFile`, for TFStudio.exe --mcp
 * --live, is the live link file the open app writes, which links the server
 * to it (liveProtocol.js); null otherwise.
 */
function startMcpServer({ app, isPackaged, exeDir, settingsPath, liveFile, log }) {
  const options = {
    dataDir: dataFolder({ app, exeDir, settingsPath, log }),
    version: app.getVersion(),
    wasmPath: isPackaged ? path.join(process.resourcesPath, 'tmm_kernel.wasm') : undefined,
    live: liveFile ? { file: liveFile } : undefined,
    server: isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'app', 'mcp', 'server.js')
      : path.join(__dirname, '..', 'mcp', 'server.js'),
    bundled: isPackaged,
  };
  const child = spawn(process.execPath, [path.join(__dirname, 'mcpChild.js'), JSON.stringify(options)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true,
  });
  child.on('error', err => { log(`MCP server could not start: ${err.message}`); app.exit(1); });
  child.on('exit', code => app.exit(code ?? 1));
}

module.exports = { startMcpServer };
