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

export function updateExplorerItemMtime(folders, itemId, mtime) {
  return folders.map((folder) => {
    if (!folder.items.some((item) => item.id === itemId)) return folder;
    return {
      ...folder,
      items: folder.items.map((item) => item.id === itemId ? { ...item, mtime } : item),
    };
  });
}
