// Main-process path / fs helpers — pure, no Electron dependency.
//
// CommonJS. Shared by the IPC handlers (safeName/safeFilePath, ~30 call sites)
// and seeding/RII code (readJsonSafe).
const fs = require('fs');
const path = require('path');

// Sanitize a user-supplied name for use as a single filename component.
function safeName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_');
}

// Resolve base + parts, refusing to escape `base` (path-traversal guard).
function safeFilePath(base, ...parts) {
  const resolved = path.resolve(base, ...parts);
  const base_ = path.resolve(base);
  if (!resolved.startsWith(base_ + path.sep) && resolved !== base_) throw new Error('Invalid path');
  return resolved;
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (_) { return null; }
}

// Atomic write: serialize to a sibling temp file, then rename into place. Rename
// is atomic on the same filesystem, so a crash/power-loss mid-write can never
// leave a truncated or partially-written file — a truncated .tfs/.json is
// silently skipped at load, which reads to the user as a "vanished" design or
// lost settings (MP4). The temp is cleaned up if anything throws.
function writeFileAtomic(filePath, data, encoding) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, data, encoding);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

// Read a text file, auto-detecting its encoding. Handles the three BOM-marked
// encodings AND BOM-less UTF-16 (Notepad/instrument exports often omit the BOM):
// ASCII-range text encoded as UTF-16 has a NUL in every other byte, so we sniff
// whether NULs cluster at odd offsets (little-endian) or even (big-endian).
// (Deduped from three identical copies in spectrum.js / zemax.js / catalogs.js.)
function readTextAuto(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le').slice(1);
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) { buf.swap16(); return buf.toString('utf16le').slice(1); }
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.toString('utf8').slice(1);
  // BOM-less UTF-16 heuristic (even-length files only).
  const n = Math.min(buf.length, 1024);
  if (n >= 4 && buf.length % 2 === 0) {
    let evenNul = 0, oddNul = 0, even = 0, odd = 0;
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) { even++; if (buf[i] === 0) evenNul++; }
      else            { odd++;  if (buf[i] === 0) oddNul++; }
    }
    // Plain UTF-8/ASCII has ~no NULs — require a strong, lopsided signal.
    if (oddNul > odd * 0.3 && oddNul > evenNul * 4) return buf.toString('utf16le');           // LE
    if (evenNul > even * 0.3 && evenNul > oddNul * 4) { buf.swap16(); return buf.toString('utf16le'); }  // BE
  }
  return buf.toString('utf8');
}

module.exports = { safeName, safeFilePath, readJsonSafe, writeFileAtomic, readTextAuto };
