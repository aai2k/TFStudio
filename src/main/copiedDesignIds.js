// Which file keeps a design id when more than one file holds it, and an id
// for a design file that holds none.
//
// A design copied outside the app keeps its id: a .tfs copied beside the
// original or into another folder, or a whole project folder copied in the
// file manager. The app keys designs by id, so one id in two files would be
// one design behind two rows, and a save through one row would write into the
// other row's file. Every copy therefore gets an id of its own, written into
// it once, so the copy is its own design at every start.
//
// The original keeps the id, and with it the unsaved work and history the
// session keeps under that id. The original is the file where the renderer
// last saw the design, when it recorded one; else the file named after the
// design, since a file-manager copy is named "D1 - Copy" or "AR (2)"; else the
// first in tree order.
//
// Two links to one file are one design and keep sharing the id. A new id is
// written through a link into the file it points at (writeFileAtomic).
//
// A design written by a script or by hand with no id gets one the same way.
//
// CommonJS, Electron-free (deps via ctx).
const { decodeText } = require('./paths');

// Same shape as the ids the renderer gives new designs (makeDefaultDesign).
function freshDesignId() {
  return `design-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function isDesignId(id) {
  return typeof id === 'string' && id !== '';
}

// Two places under Projects ('Archive/AR.tfs') naming one file. Windows
// matches names without case, so a path typed in another case is the same
// file there.
function sameLocation(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function sameFile(ctx, a, b) {
  try {
    return ctx.fs.realpathSync(a) === ctx.fs.realpathSync(b);
  } catch (_) {
    return false;
  }
}

// The file as it is on disk with only its id changed: the design read for the
// tree has had load-time cleanups applied that are not this write's to keep.
// The record's time is read again, since the write changed it.
function writeId(ctx, record, id) {
  try {
    const onDisk = JSON.parse(decodeText(ctx.fs.readFileSync(record.file)));
    ctx.writeFileAtomic(record.file, JSON.stringify({ ...onDisk, id }, null, 2), 'utf-8');
    record.mtime = ctx.fs.statSync(record.file).mtimeMs;
  } catch (err) {
    ctx.log(`Could not write the new id into ${record.file}: ${err.message}`);
  }
}

function giveFreshId(ctx, record, why) {
  const id = freshDesignId();
  ctx.log(`${record.location} ${why}; it now has ${id}`);
  record.design.id = id;
  writeId(ctx, record, id);
}

function originalOf(holders, seenAt) {
  return (typeof seenAt === 'string' && holders.find(record => sameLocation(record.location, seenAt)))
    || holders.find(record => record.named)
    || holders[0];
}

function groupById(records) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.design.id)) groups.set(record.design.id, []);
    groups.get(record.design.id).push(record);
  }
  return groups;
}

// `records` are every design file read in the tree, in tree order, each as
// { file, location, named, mtime, design }: the full path, the path under
// Projects ('Archive/AR.tfs'), whether the file is named after the design, the
// file's modification time and the parsed design. Ids and times are changed in
// place. `lastSeen` maps a design id to the location the renderer last saw it
// at, and may be absent.
function settleDesignIds(ctx, records, lastSeen) {
  for (const record of records) {
    if (!isDesignId(record.design.id)) giveFreshId(ctx, record, 'holds no design id');
  }
  for (const [id, holders] of groupById(records)) {
    if (holders.length < 2) continue;
    const original = originalOf(holders, lastSeen?.[id]);
    for (const record of holders) {
      if (record === original || sameFile(ctx, record.file, original.file)) continue;
      giveFreshId(ctx, record, `holds design id ${id}, which ${original.location} keeps`);
    }
  }
}

// A design opened by path from inside the tree, checked against the rows the
// renderer shows: `rows` maps each design id to the location of its row's
// file. A file holding no id, or the id of a row whose file is another one, is
// a design of its own and gets an id the way the loader gives one.
function settleOpenedDesign(ctx, record, rows) {
  const { id } = record.design;
  if (!isDesignId(id)) {
    giveFreshId(ctx, record, 'holds no design id');
    return;
  }
  const rowAt = rows?.[id];
  if (typeof rowAt !== 'string' || sameLocation(rowAt, record.location)) return;
  if (sameFile(ctx, ctx.path.join(ctx.projectsDir, ...rowAt.split('/')), record.file)) return;
  giveFreshId(ctx, record, `holds design id ${id}, which ${rowAt} keeps`);
}

module.exports = { settleDesignIds, settleOpenedDesign };
