// IPC: RefractiveIndex.info — fetch+parse remote YAML, read/write the offline
// mirror (Documents\TFStudio\Materials\refractiveindex-db), report status, and
// update the whole database from GitHub.
//
// CommonJS, Electron-free (deps via ctx). The dependency-free HTTPS download
// helper (httpGetBuffer) and the shared ZIP reader are only used by rii:update.
const { unzipEntries } = require('../zip');

// MP2: every remote fetch gets an inactivity timeout AND a size cap, so a
// stalled connection can't hang the awaiting renderer forever and a runaway
// response can't exhaust main-process memory.
const HTTP_TIMEOUT_MS  = 60000;
const MAX_ZIP_BYTES    = 300 * 1024 * 1024;  // whole refractiveindex repo ZIP
const MAX_YAML_BYTES   = 16  * 1024 * 1024;  // a single material YAML

const GITHUB_RII_ZIP = 'https://codeload.github.com/polyanskiy/refractiveindex.info-database/zip/refs/heads/main';

function httpGetBuffer(url, redirects = 0) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'TFStudio' } }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        res.resume(); return resolve(httpGetBuffer(res.headers.location, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); }
      const chunks = [];
      let total = 0;
      res.on('data', c => {
        total += c.length;
        if (total > MAX_ZIP_BYTES) { req.destroy(new Error('download exceeded size cap')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('request timed out')));
  });
}

// Text fetch with the same guards + redirect following (fetch-yaml previously
// followed none, inconsistent with httpGetBuffer).
function httpGetText(url, redirects = 0) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'TFStudio' } }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        res.resume(); return resolve(httpGetText(res.headers.location, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); }
      let body = '';
      let total = 0;
      res.setEncoding('utf-8');
      res.on('data', chunk => {
        total += Buffer.byteLength(chunk);
        if (total > MAX_YAML_BYTES) { req.destroy(new Error('response exceeded size cap')); return; }
        body += chunk;
      });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('request timed out')));
  });
}

function riiLocalDirOf(ctx) {
  return ctx.path.join(ctx.materialsDir, 'refractiveindex-db');
}

// ── RefractiveIndex.info offline mirror (Documents\TFStudio\Materials\refractiveindex-db) ──
// Relative paths are 'catalog-nk.yml' or 'data/<shelf>/<book>/<page>.yml'.
function riiSafePath(ctx, relPath) {
  const { path } = ctx;
  const riiLocalDir = riiLocalDirOf(ctx);
  const clean = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(riiLocalDir, clean);
  const riiBase = path.resolve(riiLocalDir);
  if (!resolved.startsWith(riiBase + path.sep) && resolved !== riiBase) throw new Error('Invalid RII path');
  return resolved;
}

function register(ipcMain, ctx) {
  ipcMain.handle('rii:fetch-yaml', async (event, url) => handleFetchYaml(ctx, url));
  ipcMain.handle('rii:read-local', async (event, relPath) => handleReadLocal(ctx, relPath));
  ipcMain.handle('rii:write-local', async (event, relPath, text) => handleWriteLocal(ctx, relPath, text));
  ipcMain.handle('rii:get-status', async () => handleGetStatus(ctx));
  ipcMain.handle('rii:update', async () => handleUpdate(ctx));
}

// ── RefractiveIndex.info: fetch a URL and parse its YAML ──────────────────
// The renderer cannot make raw HTTPS requests; we do it here in main.
// Returns { success, data } where data is the parsed YAML object.
async function handleFetchYaml(ctx, url) {
  const { log } = ctx;
  try {
    const yaml = require('js-yaml');
    const text = await httpGetText(url);   // MP2: timeout + size cap + redirects
    const data = yaml.load(text);
    return { success: true, data, text };
  } catch (err) {
    log(`rii:fetch-yaml error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Read a YAML file from the local mirror and parse it. { success, data }.
async function handleReadLocal(ctx, relPath) {
  const { fs } = ctx;
  try {
    const yaml = require('js-yaml');
    const text = fs.readFileSync(riiSafePath(ctx, relPath), 'utf-8');
    return { success: true, data: yaml.load(text) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Cache a fetched YAML into the local mirror so it is available offline next time.
async function handleWriteLocal(ctx, relPath, text) {
  const { fs, path } = ctx;
  try {
    const dst = riiSafePath(ctx, relPath);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, text, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Status for the "database last updated" indicator.
async function handleGetStatus(ctx) {
  const { fs, path, readJsonSafe } = ctx;
  const riiLocalDir = riiLocalDirOf(ctx);
  const manifest = readJsonSafe(path.join(riiLocalDir, 'manifest.json')) || {};
  const hasLocal = fs.existsSync(path.join(riiLocalDir, 'catalog-nk.yml'));
  return {
    success: true,
    hasLocal,
    lastUpdated: manifest.lastUpdated || null,
    materialCount: manifest.materialCount || 0,
    source: manifest.source || (hasLocal ? 'bundled' : 'none'),
  };
}

// Write one extracted ZIP entry into `staging` if it's a database YAML file
// (other repo files, e.g. LICENSE/README, are skipped). `state.count` tracks
// how many material files (under data/) were written; `state.written` tracks
// every file written, driving the periodic event-loop yield below.
async function writeDatabaseEntry(ctx, staging, ent, state) {
  const { fs, path } = ctx;
  const m = ent.name.match(/\/database\/(.+)$/);  // strip 'repo-main/database/'
  if (!m) return;
  const rel = m[1];
  if (!rel.endsWith('.yml')) return;
  const dst = path.join(staging, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, ent.data);
  if (rel.startsWith('data/')) state.count++;
  // MP8: ~4000 sync inflate+write entries would freeze ALL IPC (incl. the
  // window controls) until done. Yield to the event loop every batch so the
  // main process stays responsive during the extract.
  if (++state.written % 64 === 0) await new Promise(r => setImmediate(r));
}

// Download the latest database from GitHub and replace the local mirror.
async function handleUpdate(ctx) {
  const { fs, path, log, getMainWindow } = ctx;
  const riiLocalDir = riiLocalDirOf(ctx);
  const send = (phase, extra) => { try { getMainWindow()?.webContents.send('rii:update-progress', { phase, ...extra }); } catch (_) {} };
  try {
    send('downloading');
    const zip = await httpGetBuffer(GITHUB_RII_ZIP);
    send('extracting');
    // Extract only the 'database/' subtree into a staging dir, then swap in.
    const staging = riiLocalDir + '.new';
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    const state = { count: 0, written: 0 };
    for (const ent of unzipEntries(zip)) {
      await writeDatabaseEntry(ctx, staging, ent, state);
    }
    const count = state.count;
    if (!fs.existsSync(path.join(staging, 'catalog-nk.yml'))) {
      throw new Error('downloaded archive missing catalog-nk.yml');
    }
    const lastUpdated = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(staging, 'manifest.json'),
      JSON.stringify({ lastUpdated, materialCount: count, source: 'updated' }, null, 2), 'utf-8');
    // Atomic-ish swap: move old aside, promote staging, delete old.
    const backup = riiLocalDir + '.old';
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
    if (fs.existsSync(riiLocalDir)) fs.renameSync(riiLocalDir, backup);
    fs.renameSync(staging, riiLocalDir);
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
    send('done', { lastUpdated, materialCount: count });
    log(`RII database updated: ${count} materials, ${lastUpdated}`);
    return { success: true, lastUpdated, materialCount: count };
  } catch (err) {
    send('error', { error: err.message });
    log(`rii:update error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { register };
