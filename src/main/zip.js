// Minimal ZIP reader — central-directory walk, store and deflate only.
//
// CommonJS, dependency-free (Node's zlib does the inflating). Used to unpack the
// bundled RefractiveIndex.info snapshot at first run and the archive that
// `rii:update` downloads from GitHub. Both are plain deflate archives well under
// the 4 GB / 65535-entry limits, so ZIP64 is rejected rather than handled.
const zlib = require('zlib');

// Read one ZIP central-directory entry at `off`. Returns the entry's name,
// its decompressed data (null for a directory entry), and the offset of the
// next central-directory record.
function readZipEntry(buf, off) {
  if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
  const method = buf.readUInt16LE(off + 10);
  const compSize = buf.readUInt32LE(off + 20);
  const nameLen = buf.readUInt16LE(off + 28);
  const extraLen = buf.readUInt16LE(off + 30);
  const commentLen = buf.readUInt16LE(off + 32);
  const localOff = buf.readUInt32LE(off + 42);
  const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
  const nextOff = off + 46 + nameLen + extraLen + commentLen;
  if (name.endsWith('/')) return { name, data: null, nextOff };
  if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('corrupt ZIP local header');
  const lNameLen = buf.readUInt16LE(localOff + 26);
  const lExtraLen = buf.readUInt16LE(localOff + 28);
  const dataStart = localOff + 30 + lNameLen + lExtraLen;
  const comp = buf.subarray(dataStart, dataStart + compSize);
  let data;
  if (method === 0) data = comp;
  else if (method === 8) data = zlib.inflateRawSync(comp);
  else throw new Error('unsupported ZIP compression method ' + method);
  return { name, data, nextOff };
}

// Iterate a ZIP buffer's central directory, yielding { name, data } per file entry.
function* unzipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP end-of-central-directory not found');
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (off === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  for (let e = 0; e < total; e++) {
    const { name, data, nextOff } = readZipEntry(buf, off);
    off = nextOff;
    if (data === null) continue;
    yield { name, data };
  }
}

module.exports = { unzipEntries };
