/**
 * The bundled RefractiveIndex.info mirror ships as a single ZIP rather than 4000
 * loose files, because the portable build writes its whole payload to disk on
 * every launch and that cost tracks file count more than size. The archive is
 * written by tools/zip-writer.mjs at build time and read back by src/main/zip.js
 * on first run, so the two have to agree exactly.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createZip } from '../tools/zip-writer.mjs';

const require = createRequire(import.meta.url);
const { unzipEntries } = require('../src/main/zip.js');

const readBack = zip => new Map([...unzipEntries(zip)].map(e => [e.name, e.data]));

// ── Round trip ───────────────────────────────────────────────────────────────
// Nested paths, CRLF, non-ASCII, raw bytes, an empty file, and something big
// enough that deflate actually compresses it.
const cases = new Map([
    ['catalog-nk.yml', Buffer.from('SHELF:\n  - name: Main\n', 'utf8')],
    ['data/glass/schott/N-BK7.yml', Buffer.from('# n at 587.6 nm\r\nn: 1.5168\r\n', 'utf8')],
    ['data/main/SiO2/Malitson.yml', Buffer.from('comment: λ 0.21-6.7 µm\n', 'utf8')],
    ['data/raw.bin', Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0x1a, 0x00, 0x80])],
    ['data/empty.yml', Buffer.alloc(0)],
    ['manifest.json', Buffer.from('wavelength: 0.5876\n'.repeat(4000), 'utf8')],
]);

const entries = [...cases].map(([name, data]) => ({ name, data }));
const archive = createZip(entries);
const out = readBack(archive);

assert.deepEqual([...out.keys()].sort(), [...cases.keys()].sort(), 'every entry survives the round trip');
for (const [name, data] of cases) {
    assert.ok(out.get(name).equals(data), `${name} round-trips byte-for-byte`);
}

const big = cases.get('manifest.json');
assert.ok(archive.length < big.length, 'entries are deflated, not stored');

// The seed generator is deterministic by design (fixed entry order and
// timestamps), so an unchanged database must not produce a different archive.
assert.ok(createZip([...entries].reverse()).equals(archive),
    'the same content yields a byte-identical archive regardless of input order');

// ── The archive this checkout would actually ship ────────────────────────────
// Absent on a fresh clone and in CI, where `npm run seed` has not run and the
// refractiveindex-db submodule may not be checked out.
const seedDir = path.join(process.cwd(), 'build', 'seed');
const zipPath = path.join(seedDir, 'rii-db.zip');
if (!fs.existsSync(zipPath)) {
    console.log('SKIP: build/seed/rii-db.zip not present (run `npm run seed`)');
    process.exit(0);
}

assert.ok(!fs.existsSync(path.join(seedDir, 'rii-db')),
    'the loose rii-db/ tree is gone: shipping it would put 4000+ files back into every portable launch');

const shipped = readBack(fs.readFileSync(zipPath));
assert.ok(shipped.has('catalog-nk.yml'), 'the shipped mirror carries the catalog index');
assert.ok(shipped.has('manifest.json'), 'the shipped mirror carries its manifest');
assert.ok([...shipped.keys()].some(name => name.startsWith('data/')), 'the shipped mirror carries material data');

// First-run seeding decides whether to unpack by comparing the loose manifest
// beside the archive against the user's copy, without opening the archive. If
// the two manifests disagree, that decision is made on stale information.
const loose = JSON.parse(fs.readFileSync(path.join(seedDir, 'rii-db.manifest.json'), 'utf8'));
const inside = JSON.parse(shipped.get('manifest.json').toString('utf8'));
assert.deepEqual(loose, inside, 'the manifest beside the archive matches the one inside it');
assert.ok(loose.lastUpdated, 'the manifest carries a snapshot date for the newer-than check');

console.log(`RII seed archive passed (${shipped.size} entries).`);
