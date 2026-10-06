/**
 * Deleting: one design, the designs the explorer has selected, or a whole
 * project folder with everything filed under it.
 *
 * Each design leaves the same trace behind: the selection, the dirty flag, the
 * disk baseline and any window showing it. `evictDesigns` is where that is
 * cleared. What differs is only which designs go and what happens to the folder
 * list.
 *
 * A design is deleted by its folder and name, which is how its file is named,
 * and its id goes with them: the main process leaves alone a file that holds
 * another design by now.
 */

import { folderSubtree, isFolderWithin, rowFileFailure } from '../components/panels/projectExplorerModel.js';

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
            ? () => window.electronAPI.deleteItem(folder.id, item.name, item.id)
            : null,
        () => {
            a.setFolders(prev => prev.map(f => f.id === folderId
                ? { ...f, items: f.items.filter(i => i.id !== itemId) }
                : f));
            a.evictDesigns(new Set([itemId]), (f, i) => f.id === folderId && i.id === itemId);
        },
        (error) => rowFileFailure(a.t, error, item.name),
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
    // updates cannot retarget a later delete in the batch. The name is the
    // row's own: a selection made before a rename still holds the old one.
    const deletions = toRemove.map(item => {
        const folder = a.foldersRef.current.find(f => f.items.some(s => s.id === item.id));
        const row = folder?.items.find(s => s.id === item.id);
        return row ? { id: item.id, folderId: folder.id, itemName: row.name } : null;
    }).filter(Boolean);

    const removedIds = new Set();
    for (const d of deletions) {
        await a.persistChange(
            window.electronAPI?.deleteItem
                ? () => window.electronAPI.deleteItem(d.folderId, d.itemName, d.id)
                : null,
            () => removedIds.add(d.id),
            (error) => rowFileFailure(a.t, error, d.itemName),
        );
    }
    if (removedIds.size === 0) return;

    a.setFolders(prev => prev.map(f => ({
        ...f, items: f.items.filter(item => !removedIds.has(item.id)),
    })));
    a.evictDesigns(removedIds, (f, item) => removedIds.has(item.id));
}

// Deleting a folder deletes everything below it, subfolders included. Where the
// main process could not move it to the Recycle Bin, it deletes only the
// designs, and the user hears about the other files it kept.
function removeFolderTree(a, folderId) {
    const folder = a.foldersRef.current.find(f => f.id === folderId);
    if (!folder) return;
    const subtree = folderSubtree(a.foldersRef.current, folderId);
    const removedIds = new Set(subtree.flatMap(f => f.items.map(item => item.id)));
    return a.persistChange(
        window.electronAPI?.deleteFolder
            ? () => window.electronAPI.deleteFolder(folderId)
            : null,
        (result) => {
            a.setFolders(prev => prev.filter(f => !isFolderWithin(f.id, folderId)));
            a.setSelectedFolder(prev => (prev && isFolderWithin(prev.id, folderId)
                ? a.foldersRef.current.find(f => !isFolderWithin(f.id, folderId)) || null
                : prev));
            a.evictDesigns(removedIds, f => isFolderWithin(f.id, folderId));
            // Files left behind stay on disk, the unreadable designs among them,
            // so their names stay taken; a folder gone whole takes them along.
            if (result?.filesLeft > 0) {
                a.setMessageNotification({
                    type: 'info',
                    message: a.t.explorer.folderFilesLeft(folder.name, result.filesLeft),
                });
            } else {
                a.forgetUnreadNames(folderId);
            }
        },
    );
}

export function useProjectRemoval({ tree, persistChange, setMessageNotification, t }) {
    const a = useRef({});
    a.current = { ...tree, persistChange, setMessageNotification, t };

    return {
        removeItem:          useCallback((folderId, itemId) => removeOne(a.current, folderId, itemId), []),
        removeSelectedItems: useCallback((explicitList) => removeSelection(a.current, explicitList), []),
        removeFolder:        useCallback((folderId) => removeFolderTree(a.current, folderId), []),
    };
}
