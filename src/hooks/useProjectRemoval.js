/**
 * Deleting: one design, the designs the explorer has selected, or a whole
 * project folder with everything filed under it.
 *
 * Each design leaves the same trace behind: the selection, the dirty flag, the
 * disk baseline and any window showing it. `evictDesigns` is where that is
 * cleared. What differs is only which designs go and what happens to the folder
 * list.
 */

import { folderSubtree, isFolderWithin } from '../components/panels/projectExplorerModel.js';

const { useRef, useCallback } = React;

// Delete one SPECIFIC design by id — used by the explorer's per-row delete
// button/key. Must NOT route through "select, then delete the selection":
// selection state updates asynchronously, so that path deleted the
// previously-active design and failed on the first click.
function removeOne(a, folderId, itemId) {
    const folder = a.foldersRef.current.find(f => f.id === folderId);
    const item   = folder?.items.find(i => i.id === itemId);
    if (!item) return;
    return a.persistChange(
        window.electronAPI?.deleteItem
            ? () => window.electronAPI.deleteItem(folder.id, item.name)
            : null,
        () => {
            a.setFolders(prev => prev.map(f => f.id === folderId
                ? { ...f, items: f.items.filter(i => i.id !== itemId) }
                : f));
            a.evictDesigns(new Set([itemId]));
        },
    );
}

async function removeSelection(a, explicitList) {
    // `explicitList` lets the context menu delete a precise set without racing
    // the async selection state; falls back to the live selection.
    const toRemove = (Array.isArray(explicitList) && explicitList.length > 0)
        ? explicitList
        : (a.selectedItems.length > 0 ? a.selectedItems : (a.selectedItem ? [a.selectedItem] : []));
    if (toRemove.length === 0) return;
    // Resolve every disk target before awaiting so concurrent selection or tree
    // updates cannot retarget a later delete in the batch.
    const deletions = toRemove.map(item => {
        const folder = a.foldersRef.current.find(f => f.items.some(s => s.id === item.id));
        return folder ? { id: item.id, folderId: folder.id, itemName: item.name } : null;
    }).filter(Boolean);

    const removedIds = new Set();
    for (const d of deletions) {
        await a.persistChange(
            window.electronAPI?.deleteItem
                ? () => window.electronAPI.deleteItem(d.folderId, d.itemName)
                : null,
            () => removedIds.add(d.id),
        );
    }
    if (removedIds.size === 0) return;

    a.setFolders(prev => prev.map(f => ({
        ...f, items: f.items.filter(item => !removedIds.has(item.id)),
    })));
    a.evictDesigns(removedIds);
}

// Deleting a folder deletes everything below it, subfolders included.
function removeFolderTree(a, folderId) {
    const folder = a.foldersRef.current.find(f => f.id === folderId);
    if (!folder) return;
    const subtree = folderSubtree(a.foldersRef.current, folderId);
    const removedIds = new Set(subtree.flatMap(f => f.items.map(item => item.id)));
    return a.persistChange(
        window.electronAPI?.deleteFolder
            ? () => window.electronAPI.deleteFolder(folderId)
            : null,
        () => {
            a.setFolders(prev => prev.filter(f => !isFolderWithin(f.id, folderId)));
            a.setSelectedFolder(prev => (prev && isFolderWithin(prev.id, folderId)
                ? a.foldersRef.current.find(f => !isFolderWithin(f.id, folderId)) || null
                : prev));
            a.evictDesigns(removedIds);
        },
    );
}

export function useProjectRemoval({ tree, persistChange }) {
    const a = useRef({});
    a.current = { ...tree, persistChange };

    return {
        removeItem:          useCallback((folderId, itemId) => removeOne(a.current, folderId, itemId), []),
        removeSelectedItems: useCallback((explicitList) => removeSelection(a.current, explicitList), []),
        removeFolder:        useCallback((folderId) => removeFolderTree(a.current, folderId), []),
    };
}
