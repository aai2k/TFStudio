/**
 * zip-writer.mjs — build-time ZIP writer (deflate, no ZIP64).
 *
 * Produces archives that src/main/zip.js can read: one local header plus
 * deflated data per file, a central directory, and an end-of-central-directory
 * record. Directory entries are not emitted; the extractor creates parents.
 *
 * Entry order and timestamps are fixed so the same input always yields a
 * byte-identical archive, keeping `npm run seed` reproducible.
 */
import zlib from 'node:zlib';

// 1980-01-01 00:00 in DOS date/time. A real mtime would change the archive on
// every run for unchanged content.
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;
const UTF8_NAMES = 0x0800;

function localHeader(name, crc, compSize, size) {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);            // version needed
  h.writeUInt16LE(UTF8_NAMES, 6);
  h.writeUInt16LE(8, 8);             // deflate
  h.writeUInt16LE(DOS_TIME, 10);
  h.writeUInt16LE(DOS_DATE, 12);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(compSize, 18);
  h.writeUInt32LE(size, 22);
  h.writeUInt16LE(Buffer.byteLength(name), 26);
  return Buffer.concat([h, Buffer.from(name, 'utf8')]);
}

function centralHeader(name, crc, compSize, size, offset) {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(20, 4);            // version made by
  h.writeUInt16LE(20, 6);            // version needed
  h.writeUInt16LE(UTF8_NAMES, 8);
  h.writeUInt16LE(8, 10);            // deflate
  h.writeUInt16LE(DOS_TIME, 12);
  h.writeUInt16LE(DOS_DATE, 14);
  h.writeUInt32LE(crc, 16);
  h.writeUInt32LE(compSize, 20);
  h.writeUInt32LE(size, 24);
  h.writeUInt16LE(Buffer.byteLength(name), 28);
  h.writeUInt32LE(offset, 42);
  return Buffer.concat([h, Buffer.from(name, 'utf8')]);
}

/**
 * Build a ZIP archive from `[{ name, data }]`, where `name` is a forward-slash
 * path relative to the archive root and `data` is a Buffer. Returns the archive
 * as one Buffer.
 */
export function createZip(entries) {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of sorted) {
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const local = localHeader(name, crc, comp.length, data.length);
    central.push(centralHeader(name, crc, comp.length, data.length, offset));
    parts.push(local, comp);
    offset += local.length + comp.length;
  }

  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(sorted.length, 8);
  eocd.writeUInt16LE(sorted.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);

  if (sorted.length > 0xffff) throw new Error('too many entries for a non-ZIP64 archive');
  if (offset + cd.length + 22 > 0xffffffff) throw new Error('archive too large for non-ZIP64');

  return Buffer.concat([...parts, cd, eocd]);
}
