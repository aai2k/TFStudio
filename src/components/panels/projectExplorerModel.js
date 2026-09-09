/**
 * The project tree the explorer draws.
 *
 * Project folders nest to any depth, and a folder is identified by its path
 * under the Projects root ('Archive/2026/Q3'), the same string every
 * folder-addressed IPC call takes. The tree itself is held flat, one entry per
 * folder, because that id already carries the folder's place in it: sorting,
 * moving a design and marking a save all keep working on a plain list, and only
 * the row builder below has to know about depth.
 */

const FOLDER_SEPARATOR = '/';

/** The id of the folder holding `folderId`; null for a top-level folder. */
export function parentFolderId(folderId) {
  const cut = String(folderId ?? '').lastIndexOf(FOLDER_SEPARATOR);
  return cut < 0 ? null : String(folderId).slice(0, cut);
}

/** The folder's own name: the last segment of its id. */
export function folderLeafName(folderId) {
  const cut = String(folderId ?? '').lastIndexOf(FOLDER_SEPARATOR);
  return cut < 0 ? String(folderId ?? '') : String(folderId).slice(cut + 1);
}

/** The id a folder named `name` has under `parentId` (null for the top level). */
export function joinFolderId(parentId, name) {
  return parentId ? `${parentId}${FOLDER_SEPARATOR}${folderSegment(name)}` : folderSegment(name);
}

/**
 * A folder name as a single path component. A separator inside a name would
 * read as a level of nesting, so it is replaced the same way the main process
 * replaces the characters a filename cannot hold.
 */
export function folderSegment(name) {
  return String(name ?? '').replace(/[/\\]+/g, '_');
}

/** Whether `folderId` is `ancestorId` itself or a folder below it. */
export function isFolderWithin(folderId, ancestorId) {
  return folderId === ancestorId
    || String(folderId).startsWith(`${ancestorId}${FOLDER_SEPARATOR}`);
}

/** A folder and every folder below it. */
export function folderSubtree(folders, folderId) {
  return (folders || []).filter((folder) => isFolderWithin(folder.id, folderId));
}

/** Where `folderId` ends up once the folder at `fromId` has moved to `toId`. */
export function rehomedFolderId(folderId, fromId, toId) {
  return isFolderWithin(folderId, fromId) ? toId + String(folderId).slice(fromId.length) : folderId;
}

/**
 * Move the folder at `folderId` to `newId`, carrying everything below it: a
 * folder id is a path, so re-homing 'Archive' takes 'Archive/2026' with it.
 * A rename and a move are the same operation here, differing only in whether
 * the new id keeps the old parent or the old name.
 */
export function rehomeExplorerFolder(folders, folderId, newId) {
  if (!folderId || !newId || folderId === newId) return folders;
  if (!(folders || []).some((folder) => folder.id === folderId)) return folders;
  // Into itself or below itself: every descendant would be rewritten onto the
  // new prefix and land a level deeper, on ids matching nothing on disk.
  if (isFolderWithin(newId, folderId)) return folders;
  return folders.map((folder) => {
    if (!isFolderWithin(folder.id, folderId)) return folder;
    const id = rehomedFolderId(folder.id, folderId, newId);
    return { ...folder, id, name: folderLeafName(id) };
  });
}

/**
 * The folders a folder could be moved into: every folder except itself, the
 * ones below it (which would take the destination away with the source), and
 * the one already holding it. Drives the drop highlight and the context menu,
 * as dropTargetFolders does for designs.
 */
export function folderDropTargets(folders, folderId) {
  const parent = parentFolderId(folderId);
  return (folders || []).filter((folder) =>
    !isFolderWithin(folder.id, folderId) && folder.id !== parent);
}

export function sortExplorerItems(items, mode) {
  const sorted = (items || []).slice();
  const byName = (a, b) => (a.name || '').localeCompare(
    b.name || '', undefined, { numeric: true, sensitivity: 'base' });
  const byDateOldest = (a, b) => ((a.mtime || 0) - (b.mtime || 0)) || byName(a, b);
  const byDateNewest = (a, b) => ((b.mtime || 0) - (a.mtime || 0)) || byName(a, b);

  switch (mode) {
    case 'name-desc': return sorted.sort((a, b) => byName(b, a));
    case 'date-new':  return sorted.sort(byDateNewest);
    case 'date-old':  return sorted.sort(byDateOldest);
    default:          return sorted.sort(byName);
  }
}

/**
 * The folders a search leaves on screen.
 *
 * A folder whose own name matches is kept whole, and so is everything filed
 * under it. Elsewhere only the designs whose names match are kept, and the
 * folders above one of those survive as the path to it. Without them the match
 * would have nowhere to sit.
 */
export function filterExplorerFolders(folders, query) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle) return folders || [];
  const list = folders || [];
  const matches = (text) => String(text || '').toLocaleLowerCase().includes(needle);

  const byId = new Map(list.map((folder) => [folder.id, folder]));
  const wholeById = new Map();
  const isWhole = (folderId) => {
    if (!wholeById.has(folderId)) {
      // Answered before recursing, so a tree that somehow loops cannot hang
      // the search.
      wholeById.set(folderId, false);
      const folder = byId.get(folderId);
      wholeById.set(folderId, !!folder && (matches(folder.name) || isWhole(parentFolderId(folderId))));
    }
    return wholeById.get(folderId);
  };

  const kept = list.map((folder) => {
    const whole = isWhole(folder.id);
    return {
      folder,
      whole,
      items: whole ? (folder.items || []) : (folder.items || []).filter((item) => matches(item.name)),
    };
  });

  const keptIds = new Set();
  for (const entry of kept) {
    if (!entry.whole && entry.items.length === 0) continue;
    for (let id = entry.folder.id; id; id = parentFolderId(id)) keptIds.add(id);
  }
  return kept
    .filter((entry) => keptIds.has(entry.folder.id))
    .map((entry) => ({ ...entry.folder, expanded: true, items: entry.items }));
}

/**
 * The rows the explorer draws, in the order they appear on screen: at each
 * level the subfolders first and then the designs, both in the active sort.
 *
 * `depth` is the folder's distance from the top level, and a design row carries
 * the depth of the folder holding it, so one indent step covers both. Rows below
 * a collapsed folder are left out unless `allExpanded` is set, which is what a
 * search does to reveal a match deep in the tree.
 */
export function explorerRows(folders, { sortMode, allExpanded = false } = {}) {
  const childFolders = new Map();
  for (const folder of folders || []) {
    const parent = parentFolderId(folder.id) ?? '';
    if (!childFolders.has(parent)) childFolders.set(parent, []);
    childFolders.get(parent).push(folder);
  }

  const rows = [];
  const walk = (parentId, depth) => {
    for (const folder of sortExplorerItems(childFolders.get(parentId) || [], sortMode)) {
      rows.push({ key: `folder-${folder.id}`, type: 'folder', depth, folder });
      if (!allExpanded && !folder.expanded) continue;
      walk(folder.id, depth + 1);
      for (const item of sortExplorerItems(folder.items || [], sortMode)) {
        rows.push({ key: `item-${item.id}`, type: 'item', depth, folder, item });
      }
    }
  };
  walk('', 0);

  // A folder whose parent is not in the list has nothing to hang on, and
  // walking down from the top level alone would take it and everything below it
  // off screen without a word. It is drawn at the top level instead, so the
  // designs in it stay reachable.
  const present = new Set((folders || []).map((folder) => folder.id));
  for (const parentId of childFolders.keys()) {
    if (parentId !== '' && !present.has(parentId)) walk(parentId, 0);
  }
  return rows;
}

/**
 * The folders that dropping `itemIds` would actually move something into: every
 * folder that does not already hold all of them. Drives both the drop highlight
 * and the list of folders the context menu offers.
 */
export function dropTargetFolders(folders, itemIds) {
  const ids = itemIds || [];
  if (ids.length === 0) return [];
  return folders.filter((folder) =>
    ids.some((id) => !folder.items.some((item) => item.id === id)));
}

/**
 * Move the designs in `itemIds` into `targetFolderId`, appending them in the
 * order the folders hold them. Ids already in the target, and ids in no folder
 * at all, change nothing. Returns the original array when there is nothing to
 * move, so a no-op drop does not re-render the tree.
 */
export function moveExplorerItems(folders, itemIds, targetFolderId) {
  const ids = new Set(itemIds || []);
  if (ids.size === 0) return folders;
  if (!folders.some((folder) => folder.id === targetFolderId)) return folders;

  const moved = folders
    .filter((folder) => folder.id !== targetFolderId)
    .flatMap((folder) => folder.items.filter((item) => ids.has(item.id)));
  if (moved.length === 0) return folders;

  const movedIds = new Set(moved.map((item) => item.id));
  return folders.map((folder) => {
    if (folder.id === targetFolderId) return { ...folder, items: [...folder.items, ...moved] };
    if (!folder.items.some((item) => movedIds.has(item.id))) return folder;
    return { ...folder, items: folder.items.filter((item) => !movedIds.has(item.id)) };
  });
}

export function updateExplorerItemMtime(folders, itemId, mtime) {
  return folders.map((folder) => {
    if (!folder.items.some((item) => item.id === itemId)) return folder;
    return {
      ...folder,
      items: folder.items.map((item) => item.id === itemId ? { ...item, mtime } : item),
    };
  });
}
