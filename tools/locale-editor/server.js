// Localization editor server.
//   GET  /            -> the table UI
//   GET  /api/data    -> parsed model (rows, languages)
//   POST /api/save    -> apply edits surgically to locales.js, validate, write
//
// Run:  node tools/locale-editor/server.js   (then open http://localhost:4178)

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { buildModel, applyEdits, validateSource } from './locales-model.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_PATH = resolve(__dirname, '../../src/constants/locales.js');
const BACKUP_DIR = join(__dirname, 'backups');
const PORT = process.env.PORT ? Number(process.env.PORT) : 4178;

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 50e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function timestamp() {
  // Avoid Date in restricted contexts is irrelevant here (plain Node), but keep simple.
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/data') {
      const model = buildModel(LOCALES_PATH);
      sendJSON(res, 200, {
        ok: true,
        path: LOCALES_PATH,
        languages: model.languages,
        rows: model.rows,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/save') {
      const raw = await readBody(req);
      const { edits } = JSON.parse(raw || '{}');
      if (!Array.isArray(edits) || edits.length === 0) {
        sendJSON(res, 400, { ok: false, error: 'No edits provided.' });
        return;
      }
      // Rebuild model from the CURRENT file so offsets are fresh.
      const model = buildModel(LOCALES_PATH);
      let newSrc;
      try {
        newSrc = applyEdits(model, edits);
        validateSource(newSrc);
      } catch (err) {
        sendJSON(res, 400, { ok: false, error: `Edit produced invalid JS: ${err.message}` });
        return;
      }
      // Backup, then write.
      if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
      const bak = join(BACKUP_DIR, `locales.${timestamp()}.js`);
      copyFileSync(LOCALES_PATH, bak);
      writeFileSync(LOCALES_PATH, newSrc, 'utf8');
      sendJSON(res, 200, { ok: true, written: edits.length, backup: bak });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: err.message });
  }
});

// Listen, and if the port is busy, walk forward to the next free one so a
// stray previous instance never blocks startup. Set PORT to force a fixed port.
function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`  port ${port} busy — trying ${port + 1}…`);
      listen(port + 1, attemptsLeft - 1);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`\n  Could not bind a port near ${PORT}. ` +
        `Another locale-editor is probably already running — open it, or stop it first.\n`);
      process.exit(1);
    } else {
      throw err;
    }
  });
  server.listen(port, () => {
    console.log(`\n  TFStudio Localization Editor`);
    console.log(`  editing: ${LOCALES_PATH}`);
    console.log(`  open:    http://localhost:${port}\n`);
  });
}
listen(PORT, 10);
