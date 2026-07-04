// Local HTTP server for the bundled help site. Starlight emits directory routes
// (`design/design-editor/index.html`) and uses Pagefind for search, which loads
// its WASM + index chunks via fetch(). Both require an HTTP origin — browsers do
// not auto-resolve directory URLs under file://, and they block fetch() from
// file:// origins. We bind to 127.0.0.1 on an OS-chosen free port and only serve
// the help directory.
//
// CommonJS. The server state is module-private; the help:open IPC handler reads
// it via getHelpServerPort()/getHelpServerRoot().
const fs = require('fs');
const path = require('path');
const http = require('http');
const urlMod = require('url');
const { log } = require('./logger');

let helpServer = null;
let helpServerPort = null;
let helpServerRoot = null;

const HELP_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  // Pagefind index shards — opaque binary blobs fetched as ArrayBuffer.
  '.pf_meta': 'application/octet-stream',
  '.pf_index': 'application/octet-stream',
  '.pf_fragment': 'application/octet-stream',
};

function resolveHelpRoot(isPackaged, srcDir) {
  return isPackaged
    ? path.join(process.resourcesPath, 'help')
    : path.resolve(srcDir, '..', 'docs-site', 'dist');
}

function startHelpServer({ isPackaged, srcDir }) {
  const root = resolveHelpRoot(isPackaged, srcDir);
  if (!fs.existsSync(root)) {
    log(`Help server not started: root missing (${root}). Run "npm run docs:build".`);
    return;
  }
  helpServerRoot = path.resolve(root);

  const server = http.createServer((req, res) => {
    try {
      const parsed = urlMod.parse(req.url || '/');
      let urlPath;
      try { urlPath = decodeURIComponent(parsed.pathname || '/'); }
      catch (_) { res.writeHead(400); res.end('Bad request'); return; }

      // Normalize and prevent directory traversal: resolved path must stay
      // within helpServerRoot.
      const joined = path.join(helpServerRoot, urlPath);
      const resolved = path.resolve(joined);
      if (resolved !== helpServerRoot && !resolved.startsWith(helpServerRoot + path.sep)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }

      let filePath = resolved;
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': HELP_MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      log(`Help server request error: ${err.message}`);
      try { res.writeHead(500); res.end('Server error'); } catch (_) {}
    }
  });

  server.on('error', (err) => log(`Help server error: ${err.message}`));
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    helpServerPort = typeof addr === 'object' && addr ? addr.port : null;
    helpServer = server;
    log(`Help server listening on http://127.0.0.1:${helpServerPort} (root: ${helpServerRoot})`);
  });
}

function stopHelpServer() {
  if (helpServer) {
    try { helpServer.close(); } catch (_) {}
    helpServer = null;
    helpServerPort = null;
  }
}

function getHelpServerPort() { return helpServerPort; }
function getHelpServerRoot() { return helpServerRoot; }

module.exports = { startHelpServer, stopHelpServer, getHelpServerPort, getHelpServerRoot };
