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

export function filterExplorerFolders(folders, query) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle) return folders || [];

  return (folders || []).flatMap((folder) => {
    const folderMatches = String(folder.name || '').toLocaleLowerCase().includes(needle);
    const items = folderMatches
      ? (folder.items || [])
      : (folder.items || []).filter((item) =>
          String(item.name || '').toLocaleLowerCase().includes(needle));
    return folderMatches || items.length > 0 ? [{ ...folder, expanded: true, items }] : [];
  });
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
