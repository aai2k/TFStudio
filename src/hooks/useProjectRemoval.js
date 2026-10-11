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
 *
 * Deleted files go to the Recycle Bin. Where the bin refuses them, nothing is
 * deleted and the user is asked once per delete whether to delete for good.
 */

import { folderSubtree, isFolderWithin, rowFileFailure } from '../components/panels/projectExplorerModel.js';

const { useRef, useCallback } = React;

// The main process's answer when the Recycle Bin refused a delete.
const NO_BIN = 'no-bin';

// Ask whether to delete for good what the Recycle Bin refused.
function askDeleteForGood(a, question, confirmLabel, deleteForGood) {
    a.setInputDialog({
        confirm: true, danger: true,
        title: question,
        confirmLabel,
        onConfirm: () => { a.setInputDialog(null); deleteForGood(); },
        onCancel: () => a.setInputDialog(null),
    });
}

// Delete one SPECIFIC design by id — used by the explorer's per-row delete
// button/key. Must NOT route through "select, then delete the selection":
// selection state updates asynchronously, so that path deleted the
// previously-active design and failed on the first click.
function removeOne(a, folderId, itemId) {
    const folder = a.foldersRef.current.find(f => f.id === folderId);
    const item   = folder?.items.find(i => i.id === itemId);
    if (!item) return;
    return removeDesigns(a, [{ id: item.id, folderId: folder.id, itemName: item.name }]);
}

// Delete each design's file, one call at a time; `options`, when given, go with
// every call. The files the Recycle Bin refused stay, and the user is asked
// about all of them in one question. A row is its folder and its id: two
// folders can show one design through linked files, and deleting the file of
// one row leaves the other row and the design it shows.
async function removeDesigns(a, deletions, ...options) {
    const removedIds = new Set();
    const removedRows = new Set();
    const refused = [];
    for (const d of deletions) {
        await a.persistChange(
            window.electronAPI?.deleteItem
                ? () => window.electronAPI.deleteItem(d.folderId, d.itemName, d.id, ...options)
                : null,
            () => { removedIds.add(d.id); removedRows.add(`${d.folderId}\n${d.id}`); },
            (error) => {
                if (error !== NO_BIN) return rowFileFailure(a.t, error, d.itemName);
                refused.push(d);
                return false;
            },
        );
    }
    if (removedRows.size > 0) {
        const isRemoved = (f, item) => removedRows.has(`${f.id}\n${item.id}`);
        a.setFolders(prev => prev.map(f => ({ ...f, items: f.items.filter(item => !isRemoved(f, item)) })));
        a.evictDesigns(removedIds, isRemoved);
    }
    if (refused.length === 0) return;
    const { noBin, deleteDesign, deleteDesigns } = a.t.dialogs;
    const one = refused.length === 1;
    askDeleteForGood(a,
        one ? noBin.one(refused[0].itemName) : noBin.several(refused.length),
        (one ? deleteDesign : deleteDesigns).confirm,
        () => removeDesigns(a, refused, { permanent: true }));
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
    return removeDesigns(a, deletions);
}

// Deleting a folder deletes everything below it, subfolders included. Where the
// Recycle Bin refuses it, the user is asked whether to delete it for good. A
// folder deleted for good loses only its designs, and the user hears about the
// other files kept.
function removeFolderTree(a, folderId, ...options) {
    const folder = a.foldersRef.current.find(f => f.id === folderId);
    if (!folder) return;
    const subtree = folderSubtree(a.foldersRef.current, folderId);
    const removedIds = new Set(subtree.flatMap(f => f.items.map(item => item.id)));
    return a.persistChange(
        window.electronAPI?.deleteFolder
            ? () => window.electronAPI.deleteFolder(folderId, ...options)
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
        (error) => {
            if (error !== NO_BIN) return null;
            askDeleteForGood(a, a.t.dialogs.noBin.one(folder.name), a.t.dialogs.deleteProject.confirm,
                () => removeFolderTree(a, folderId, { permanent: true }));
            return false;
        },
    );
}

export function useProjectRemoval({ tree, persistChange, setInputDialog, setMessageNotification, t }) {
    const a = useRef({});
    a.current = { ...tree, persistChange, setInputDialog, setMessageNotification, t };

    return {
        removeItem:          useCallback((folderId, itemId) => removeOne(a.current, folderId, itemId), []),
        removeSelectedItems: useCallback((explicitList) => removeSelection(a.current, explicitList), []),
        removeFolder:        useCallback((folderId) => removeFolderTree(a.current, folderId), []),
    };
}
