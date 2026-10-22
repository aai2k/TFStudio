/**
 * The process TFStudio.exe --mcp starts the MCP server in (mcpEntry.js): plain
 * Node on the app's own runtime. Its one argument is the JSON of { dataDir,
 * version, wasmPath, live, server, bundled }: `server` is the server module, the
 * CommonJS bundle when `bundled`, the ES module in src/mcp/ otherwise.
 *
 * CommonJS, like the rest of the main process.
 */
const { pathToFileURL } = require('url');

const { server, bundled, ...options } = JSON.parse(process.argv[2]);
const load = bundled ? Promise.resolve().then(() => require(server)) : import(pathToFileURL(server).href);

load
  .then(({ serve }) => serve(options))
  .catch(err => {
    process.stderr.write(`[tfstudio-mcp] ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
