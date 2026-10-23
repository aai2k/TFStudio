// The server a launch asks for (serverEntry.js): TFStudio.exe --mcp the MCP
// server, TFStudio.exe --api the API server, --data <folder> the data folder
// it runs on in place of the app's, and --program <name> the program it
// serves, as the open app names that program to its user.
//
// CommonJS, Electron-free.
const path = require('path');

/**
 * What `argv` asks for: { kind, dataDir }, kind 'mcp', 'api' or null for the
 * app itself, dataDir the folder --data names, made absolute, or null. A launch
 * that asks for both servers, or names no folder after --data, gets
 * { refusal }, which says why.
 */
function serverLaunch(argv) {
  const mcp = argv.includes('--mcp');
  const api = argv.includes('--api');
  if (mcp && api) return { refusal: '--mcp and --api each start a server; give one of them' };
  const kind = mcp ? 'mcp' : api ? 'api' : null;
  const at = argv.indexOf('--data');
  if (!kind || at < 0) return { kind, dataDir: null };
  const folder = argv[at + 1];
  if (!folder || folder.startsWith('--')) return { refusal: '--data names a data folder: --data <folder>' };
  return { kind, dataDir: path.resolve(folder) };
}

/** The name --program in `argv` gives, or null when there is none. */
function launchProgram(argv) {
  const at = argv.indexOf('--program');
  const name = at < 0 ? null : argv[at + 1];
  return name && !name.startsWith('--') ? name : null;
}

module.exports = { serverLaunch, launchProgram };
