// IPC: RefractiveIndex.info — fetch+parse remote YAML, read/write the offline
// mirror (Documents\TFStudio\Materials\refractiveindex-db), report status, and
// update the whole database from GitHub.
//
// CommonJS, Electron-free (deps via ctx). The dependency-free HTTPS download +
// ZIP extraction helpers (httpGetBuffer / unzipEntries) are only used by
// rii:update. devDependencies (yauzl/extract-zip) are unavailable in the packaged
// app, so we extract zips with Node's built-in zlib (standard deflate, no ZIP64).

// MP2: every remote fetch gets an inactivity timeout AND a size cap, so a
// stalled connection can't hang the awaiting renderer forever and a runaway
// response can't exhaust main-process memory.
const HTTP_TIMEOUT_MS  = 60000;
const MAX_ZIP_BYTES    = 300 * 1024 * 1024;  // whole refractiveindex repo ZIP
const MAX_YAML_BYTES   = 16  * 1024 * 1024;  // a single material YAML

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

// Iterate a ZIP buffer's central directory, yielding { name, data } per file entry.
function* unzipEntries(buf) {
  const zlib = require('zlib');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP end-of-central-directory not found');
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (off === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  for (let e = 0; e < total; e++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('corrupt ZIP local header');
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = comp;
    else if (method === 8) data = zlib.inflateRawSync(comp);
    else throw new Error('unsupported ZIP compression method ' + method);
    yield { name, data };
  }
}

function register(ipcMain, ctx) {
  const { fs, path, log, readJsonSafe, materialsDir, getMainWindow } = ctx;
  const riiLocalDir = path.join(materialsDir, 'refractiveindex-db');

  // ── RefractiveIndex.info: fetch a URL and parse its YAML ──────────────────
  // The renderer cannot make raw HTTPS requests; we do it here in main.
  // Returns { success, data } where data is the parsed YAML object.
  ipcMain.handle('rii:fetch-yaml', async (event, url) => {
    try {
      const yaml = require('js-yaml');
      const text = await httpGetText(url);   // MP2: timeout + size cap + redirects
      const data = yaml.load(text);
      return { success: true, data, text };
    } catch (err) {
      log(`rii:fetch-yaml error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ── RefractiveIndex.info offline mirror (Documents\TFStudio\Materials\refractiveindex-db) ──
  // Relative paths are 'catalog-nk.yml' or 'data/<shelf>/<book>/<page>.yml'.
  const GITHUB_RII_ZIP = 'https://codeload.github.com/polyanskiy/refractiveindex.info-database/zip/refs/heads/main';

  function riiSafePath(relPath) {
    const clean = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const resolved = path.resolve(riiLocalDir, clean);
    const riiBase = path.resolve(riiLocalDir);
    if (!resolved.startsWith(riiBase + path.sep) && resolved !== riiBase) throw new Error('Invalid RII path');
    return resolved;
  }

  // Read a YAML file from the local mirror and parse it. { success, data }.
  ipcMain.handle('rii:read-local', async (event, relPath) => {
    try {
      const yaml = require('js-yaml');
      const text = fs.readFileSync(riiSafePath(relPath), 'utf-8');
      return { success: true, data: yaml.load(text) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Cache a fetched YAML into the local mirror so it is available offline next time.
  ipcMain.handle('rii:write-local', async (event, relPath, text) => {
    try {
      const dst = riiSafePath(relPath);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, text, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Status for the "database last updated" indicator.
  ipcMain.handle('rii:get-status', async () => {
    const manifest = readJsonSafe(path.join(riiLocalDir, 'manifest.json')) || {};
    const hasLocal = fs.existsSync(path.join(riiLocalDir, 'catalog-nk.yml'));
    return {
      success: true,
      hasLocal,
      lastUpdated: manifest.lastUpdated || null,
      materialCount: manifest.materialCount || 0,
      source: manifest.source || (hasLocal ? 'bundled' : 'none'),
    };
  });

  // Download the latest database from GitHub and replace the local mirror.
  ipcMain.handle('rii:update', async () => {
    const send = (phase, extra) => { try { getMainWindow()?.webContents.send('rii:update-progress', { phase, ...extra }); } catch (_) {} };
    try {
      send('downloading');
      const zip = await httpGetBuffer(GITHUB_RII_ZIP);
      send('extracting');
      // Extract only the 'database/' subtree into a staging dir, then swap in.
      const staging = riiLocalDir + '.new';
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });
      let count = 0;
      let written = 0;
      for (const ent of unzipEntries(zip)) {
        const m = ent.name.match(/\/database\/(.+)$/);  // strip 'repo-main/database/'
        if (!m) continue;
        const rel = m[1];
        if (!rel.endsWith('.yml')) continue;
        const dst = path.join(staging, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, ent.data);
        if (rel.startsWith('data/')) count++;
        // MP8: ~4000 sync inflate+write entries would freeze ALL IPC (incl. the
        // window controls) until done. Yield to the event loop every batch so the
        // main process stays responsive during the extract.
        if (++written % 64 === 0) await new Promise(r => setImmediate(r));
      }
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
  });
}

module.exports = { register };
