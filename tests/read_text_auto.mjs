/**
 * Text file decoding in the main process.
 *
 * Files from older coating programs are written in the system's ANSI code
 * page; TFStudio's own files are UTF-8, sometimes UTF-16 from an editor.
 * readTextAuto has to give the same characters back whichever it meets, and
 * the ANSI page must be the system's own, read from the registry on Windows,
 * with windows-1252 elsewhere.
 *
 * Run: node tests/read_text_auto.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { readTextAuto, decodeAnsi, ansiCodePage } = require('../src/main/paths.js');

let passed = 0;
function ok(condition, message) {
    if (!condition) throw new Error(message);
    passed++;
}

// windows-1251 bytes of a string: ASCII as is, А..я at 0xC0..0xFF, the rest
// from the page's upper half.
const CP1251_EXTRA = { 'Ё': 0xA8, 'ё': 0xB8, '«': 0xAB, '»': 0xBB, '№': 0xB9, '°': 0xB0, ' ': 0xA0 };
function cp1251(text) {
    return Buffer.from([...text].map(ch => {
        const cp = ch.codePointAt(0);
        if (cp < 0x80) return cp;
        if (cp >= 0x410 && cp <= 0x44F) return 0xC0 + cp - 0x410;
        if (ch in CP1251_EXTRA) return CP1251_EXTRA[ch];
        throw new Error(`no cp1251 byte for ${ch}`);
    }));
}
// windows-1252 bytes: Latin-1 characters map to their own code points.
function cp1252(text) {
    return Buffer.from([...text].map(ch => ch.codePointAt(0)));
}

const russian = 'Просветлённое покрытие «К8» №3, угол 45°';
ok(decodeAnsi(cp1251(russian), 'windows-1251') === russian, 'windows-1251 bytes with ё, «», № and ° read back');
const german = 'Glas für Prüfung, Ångström';
ok(decodeAnsi(cp1252(german), 'windows-1252') === german, 'windows-1252 bytes with umlauts read back');

const page = ansiCodePage();
ok(page === null || typeof page === 'string', 'the system page is a label or null');
if (page) {
    ok(new TextDecoder(page).encoding.length > 0, `the system page ${page} has a decoder`);
    ok(process.platform === 'win32', 'a system page is reported on Windows only');
}
// Without a label the system page decides; the result is at least a string
// of one character per byte for a single-byte page.
const bytes = cp1251('ТК21');
const decoded = decodeAnsi(bytes);
ok(typeof decoded === 'string' && (!page || !/^windows-125/.test(page) || decoded.length === bytes.length), 'the default label decodes');

// ── readTextAuto over real files ─────────────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-read-'));
const write = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; };
try {
    const text = 'ENVIRON*350*750*5*550*0*AIR*ТК21*';
    ok(readTextAuto(write('utf8.tfd', Buffer.from(text, 'utf8'))) === text, 'plain UTF-8');
    ok(readTextAuto(write('utf8bom.tfd', Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]))) === text, 'UTF-8 with a BOM');
    ok(readTextAuto(write('utf16le.tfd', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]))) === text, 'UTF-16 LE with a BOM');
    const ansi = readTextAuto(write('ansi.tfd', cp1251(text)));
    ok(typeof ansi === 'string' && ansi.startsWith('ENVIRON*350*750*5*550*0*AIR*'), 'bytes that are not UTF-8 read as the ANSI page without throwing');
    if (page === 'windows-1251') ok(ansi === text, 'on a Russian Windows the Cyrillic substrate name reads back');
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`read_text_auto: ${passed} passed`);
