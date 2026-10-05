// A design copied outside the app keeps its id: a .tfs or a whole project
// folder copied in the file manager. The app keys designs by id, so one id in
// two folders would be one design behind two rows, and a save through one row
// would write into the other folder's file. The loader therefore gives such a
// copy an id of its own.
//
// Folders are read in tree order, and the first file to hold an id keeps it. A
// later file in another folder gets a fresh id, written into it once, so the
// copy is its own design at every start. Two copies in one folder never get
// here: the loader sets the older one aside first (loadDesignFile).
//
// Two links to one file are one design and keep sharing the id. A link to a
// different file gets its fresh id in memory only, because the atomic write
// would replace the link with a plain file.
//
// CommonJS, Electron-free (deps via ctx).

// Same shape as the ids the renderer gives new designs (makeDefaultDesign).
function freshDesignId() {
  return `design-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// `items` are one folder's designs, `seenIds` maps each id to the file it was
// read from, and `ctx.treeIds` maps every id taken so far in the tree to the
// file holding it. Changes `items` in place.
function giveCopiesTheirOwnIds(ctx, items, seenIds) {
  const { fs, path, log } = ctx;
  for (const item of items) {
    const file = seenIds.get(item.id).file;
    const holder = ctx.treeIds.get(item.id);
    if (holder === undefined) { ctx.treeIds.set(item.id, file); continue; }
    if (fs.realpathSync(holder) === fs.realpathSync(file)) continue;
    const id = freshDesignId();
    log(`${path.basename(file)} holds design id ${item.id}, which another folder already has; it now has ${id}`);
    item.id = id;
    item.design.id = id;
    ctx.treeIds.set(id, file);
    if (!fs.lstatSync(file).isSymbolicLink()) writeId(ctx, file, id);
  }
}

// The file as it is on disk with only its id changed: the design read for the
// tree has had load-time cleanups applied that are not this write's to keep.
function writeId(ctx, file, id) {
  try {
    const onDisk = JSON.parse(ctx.fs.readFileSync(file, 'utf-8'));
    ctx.writeFileAtomic(file, JSON.stringify({ ...onDisk, id }, null, 2), 'utf-8');
  } catch (err) {
    ctx.log(`Could not write the new id into ${file}: ${err.message}`);
  }
}

module.exports = { giveCopiesTheirOwnIds };
