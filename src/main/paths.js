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

// Decode a buffer that begins with a UTF BOM. Returns null if no recognized
// BOM is present.
function decodeByBom(buf) {
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le').slice(1);
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) { buf.swap16(); return buf.toString('utf16le').slice(1); }
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.toString('utf8').slice(1);
  return null;
}

// Detect BOM-less UTF-16 (even-length files only) by sniffing whether NULs
// cluster at odd byte offsets (little-endian) or even offsets (big-endian) in
// the first 1KB. Returns null if the signal isn't strong enough to call it UTF-16.
function decodeBomlessUtf16(buf) {
  const n = Math.min(buf.length, 1024);
  if (n < 4 || buf.length % 2 !== 0) return null;
  let evenNul = 0, oddNul = 0, even = 0, odd = 0;
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) { even++; if (buf[i] === 0) evenNul++; }
    else            { odd++;  if (buf[i] === 0) oddNul++; }
  }
  // Plain UTF-8/ASCII has ~no NULs — require a strong, lopsided signal.
  if (oddNul > odd * 0.3 && oddNul > evenNul * 4) return buf.toString('utf16le');           // LE
  if (evenNul > even * 0.3 && evenNul > oddNul * 4) { buf.swap16(); return buf.toString('utf16le'); }  // BE
  return null;
}

// TextDecoder labels of the Windows ANSI code pages whose number is not a
// label of its own.
const CODE_PAGE_LABELS = { 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 874: 'windows-874' };

// The system's ANSI code page as a TextDecoder label ('windows-1251' on a
// Russian Windows), read once from the registry. Null off Windows, or when the
// registry cannot be read or the page has no decoder.
let ansiLabel;
function ansiCodePage() {
  if (ansiLabel !== undefined) return ansiLabel;
  ansiLabel = null;
  if (process.platform === 'win32') {
    try {
      const out = require('child_process').execFileSync('reg',
        ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'ACP'],
        { encoding: 'ascii', windowsHide: true, timeout: 3000 });
      const m = /\bACP\s+REG_SZ\s+(\d+)/.exec(out);
      if (m) {
        const label = CODE_PAGE_LABELS[m[1]] || `windows-${m[1]}`;
        new TextDecoder(label);
        ansiLabel = label;
      }
    } catch (_) { /* no registry, or no decoder for the page */ }
  }
  return ansiLabel;
}

// The system's OEM code page as a TextDecoder, read once from the registry;
// reg.exe writes its output in that page when it is not attached to a
// console. Null off Windows, when the registry cannot be read, or for a page
// the platform has no decoder for (the western OEM pages 437 and 850 among
// them, which are exact for ASCII under the UTF-8 fallback anyway).
let oemDecoder;
function oemTextDecoder() {
  if (oemDecoder !== undefined) return oemDecoder;
  oemDecoder = null;
  if (process.platform === 'win32') {
    try {
      const out = require('child_process').execFileSync('reg',
        ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'OEMCP'],
        { encoding: 'ascii', windowsHide: true, timeout: 3000 });
      const m = /\bOEMCP\s+REG_SZ\s+(\d+)/.exec(out);
      const label = m && (m[1] === '866' ? 'ibm866' : CODE_PAGE_LABELS[m[1]]);
      if (label) oemDecoder = new TextDecoder(label);
    } catch (_) { /* no registry, or no decoder for the page */ }
  }
  return oemDecoder;
}

// A string value under a registry key, or null when the value is absent, the
// registry cannot be read, or this is not Windows. The output is decoded in
// the OEM page reg.exe writes, so a path under a Cyrillic or CJK profile
// survives; an expandable value has its %VAR% references filled from the
// environment; the value name is matched whatever its case.
function registryValue(key, name) {
  if (process.platform !== 'win32') return null;
  try {
    const raw = require('child_process').execFileSync('reg', ['query', key, '/v', name],
      { windowsHide: true, timeout: 3000 });
    const out = (oemTextDecoder() || new TextDecoder('utf-8')).decode(raw);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`^\\s*${escaped}\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$`, 'mi').exec(out);
    return m ? m[1].replace(/%([^%]+)%/g, (whole, variable) => process.env[variable] ?? whole) : null;
  } catch (_) { return null; }
}

// Decode bytes that are not UTF-8 as a Windows code page. Older coating
// programs (TFCalc among them) write text in the system's ANSI code page, so
// a Cyrillic material name written on a Russian Windows arrives as
// windows-1251 bytes and reads back through the same page. The label defaults
// to the system's own page, and to windows-1252 where there is none.
function decodeAnsi(buf, label = ansiCodePage() || 'windows-1252') {
  return new TextDecoder(label).decode(buf);
}

// Read a text file, auto-detecting its encoding. Handles the three BOM-marked
// encodings AND BOM-less UTF-16 (Notepad/instrument exports often omit the BOM):
// ASCII-range text encoded as UTF-16 has a NUL in every other byte, so we sniff
// whether NULs cluster at odd offsets (little-endian) or even (big-endian).
// Bytes that are not valid UTF-8 are read as an ANSI code page.
function readTextAuto(filePath) {
  const buf = fs.readFileSync(filePath);
  const byBom = decodeByBom(buf);
  if (byBom !== null) return byBom;
  const bomless = decodeBomlessUtf16(buf);
  if (bomless !== null) return bomless;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (_) {
    return decodeAnsi(buf);
  }
}

// The directory the portable AppData folder and app-debug.log sit beside.
//
// The portable build is a self-extracting archive: its launcher unpacks the
// application into a temporary directory, runs it from there, and deletes that
// directory again on exit. process.execPath therefore points somewhere that
// does not outlive the session, and anything written next to it — settings, the
// window layout, the Chromium profile and its compiled-code cache — is lost
// between runs and rebuilt cold on the next launch. The launcher sets
// PORTABLE_EXECUTABLE_DIR to the folder holding the .exe the user actually
// double-clicked, which is the location that persists.
function resolveExeDir({ portableDir, isPackaged, execPath, appPath }) {
  if (portableDir) return portableDir;
  return isPackaged ? path.dirname(execPath) : appPath;
}

module.exports = { safeName, safeFilePath, readJsonSafe, writeFileAtomic, readTextAuto, decodeAnsi, ansiCodePage, registryValue, resolveExeDir };
