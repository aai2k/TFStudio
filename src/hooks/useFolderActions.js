/**
 * Project folders: creating one, renaming it, moving it, and moving designs
 * between them. Deleting one is in the removal hook, with the other deletes.
 *
 * A folder id is its path under Projects, so renaming or moving a folder is one
 * directory rename on disk and rewrites the ids of every folder below it.
 */

import { designFileKey } from '../utils/io/designNaming.js';
import { persistThenCommit } from '../utils/io/projectPersistence.js';
import {
    folderLeafName, isFolderWithin, joinFolderId, moveExplorerItems,
    parentFolderId, rehomeExplorerFolder, rehomedFolderId,
} from '../components/panels/projectExplorerModel.js';

const { useRef, useCallback } = React;

// Windows caps the length of a directory path unless long paths are turned on,
// and nesting is what gets a project tree there. The main process answers with
// a code rather than a sentence, so the message is worded here.
function folderWriteFailure(t, error) {
    return error === 'path-too-long' ? t.dialogs.folder.pathTooLong : null;
}

// The designs a move would actually shift: an id in no folder at all, and an id
// already in the target, move nothing.
function plannedMoves(folders, itemIds, targetFolderId) {
    return (itemIds || []).map((itemId) => {
        const source = folders.find(f => f.items.some(i => i.id === itemId));
        if (!source || source.id === targetFolderId) return null;
        const item = source.items.find(i => i.id === itemId);
        return item ? { item, sourceId: source.id } : null;
    }).filter(Boolean);
}

// A design is addressed on disk by its filename, so a name already taken in the
// target would put one design on top of another. Two designs in the batch can
// carry the same name as well, having come from different folders, so each name
// joins the taken set as it is checked. The first clash refuses the whole move
// rather than half of it (see designNaming.js).
function firstNameClash(moves, target) {
    const taken = new Set(target.items.map(i => designFileKey(i.name)));
    for (const move of moves) {
        const key = designFileKey(move.item.name);
        if (taken.has(key)) return move;
        taken.add(key);
    }
    return null;
}

// A new project folder, at the top level or inside `parentFolder`. The name has
// to be free among that folder's siblings only: two folders under different
// parents are two directories and may share a name.
function askNewFolder(a, parentFolder) {
    const parentId = parentFolder?.id || null;
    const fd = a.t.dialogs.folder;
    a.setInputDialog({
        title: parentId ? fd.newSubfolderTitle(parentFolder.name) : fd.newFolderTitle,
        defaultValue: fd.newFolderName,
        validate: (name) => {
            if (!name?.trim()) return fd.folderNameEmpty;
            const id = joinFolderId(parentId, name.trim());
            if (a.foldersRef.current.some(f => f.id.toLowerCase() === id.toLowerCase()))
                return fd.folderExists;
            return '';
        },
        onConfirm: async (name) => {
            const created = name?.trim() ? await createFolder(a, parentId, name.trim()) : true;
            if (created) a.setInputDialog(null);
        },
        onCancel: () => a.setInputDialog(null)
    });
}

function createFolder(a, parentId, name) {
    const id = joinFolderId(parentId, name);
    const newFolder = { id, name: folderLeafName(id), expanded: true, items: [] };
    return a.persistChange(
        window.electronAPI?.createFolder
            ? () => window.electronAPI.createFolder(id)
            : null,
        () => {
            // The parent is opened with it, or the new folder is created out of
            // sight.
            a.setFolders(prev => [
                ...prev.map(f => (f.id === parentId ? { ...f, expanded: true } : f)),
                newFolder,
            ]);
            a.setSelectedFolder(newFolder);
        },
        (error) => folderWriteFailure(a.t, error),
    );
}

/**
 * Move designs into another project folder, from a drag or the explorer's
 * context menu. The design id and name do not change, so an open design keeps
 * its unsaved edits and its undo history; the next save follows it, because
 * saveDesignToDisk looks its folder up by item id each time.
 */
async function moveDesignsTo(a, itemIds, targetFolderId) {
    const target = a.foldersRef.current.find(f => f.id === targetFolderId);
    if (!target) return false;
    const moves = plannedMoves(a.foldersRef.current, itemIds, targetFolderId);
    if (moves.length === 0) return false;

    const clash = firstNameClash(moves, target);
    if (clash) {
        a.setMessageNotification({
            type: 'error',
            message: a.t.explorer.moveNameTaken(clash.item.name, target.id),
        });
        return false;
    }

    // Each design is committed to the tree as its own file lands, and the ref is
    // moved with it rather than waiting for the render: a save fired while the
    // batch is still running resolves the design's folder from this ref, and
    // would otherwise write it back into the folder it left. The batch reports
    // its own failures, so persistThenCommit is used directly and every design
    // that did not move is named.
    const movedIds = new Set();
    const failed = [];
    for (const move of moves) {
        const result = await persistThenCommit(
            window.electronAPI?.moveItem
                ? () => window.electronAPI.moveItem(move.sourceId, target.id, move.item.name)
                : null,
            () => {
                movedIds.add(move.item.id);
                a.foldersRef.current = moveExplorerItems(a.foldersRef.current, [move.item.id], targetFolderId);
                a.setFolders(prev => moveExplorerItems(prev, [move.item.id], targetFolderId));
            },
        );
        if (!result.success) failed.push(move.item.name);
    }
    reportMoveFailures(a, movedIds, failed);
    if (movedIds.size === 0) return false;

    // Selection follows the design the user was working on, so the folder shown
    // as selected still holds the open design.
    if (movedIds.has(a.selectedItem?.id)) a.setSelectedFolder(target);
    return true;
}

function reportMoveFailures(a, movedIds, failed) {
    if (failed.length === 1 && movedIds.size === 0) {
        a.setMessageNotification({ type: 'error', message: a.t.explorer.moveFailed(failed[0]) });
    } else if (failed.length > 0) {
        a.setMessageNotification({
            type: 'error',
            message: a.t.explorer.movedPartly(movedIds.size, failed.length),
        });
    }
}

// The tree is put in the ref as well as in state, for the same reason a design
// move is: a save fired before the render resolves its folder from the ref, and
// would otherwise write to the path the folder no longer has.
function applyRehome(a, folderId, newId) {
    const rehomed = rehomeExplorerFolder(a.foldersRef.current, folderId, newId);
    a.foldersRef.current = rehomed;
    // Applied to whatever the tree is when React commits, not to the copy taken
    // above: a save committing in the same batch has its own update queued, and
    // replacing the list outright would drop it.
    a.setFolders(prev => rehomeExplorerFolder(prev, folderId, newId));
    a.setSelectedFolder(prev => {
        if (!prev) return prev;
        const id = rehomedFolderId(prev.id, folderId, newId);
        return id === prev.id ? prev : (rehomed.find(f => f.id === id) || prev);
    });
}

function renameFolderTo(a, folderId, newName) {
    const folder = a.foldersRef.current.find(f => f.id === folderId);
    if (!folder) return;
    const newId = joinFolderId(parentFolderId(folderId), newName);
    // Compared without case on every platform, for the reason design names are
    // (see designNaming.js): Windows reaches one directory from either spelling,
    // and a data folder that relies on the difference stops making sense the
    // moment it is opened there.
    const collides = a.foldersRef.current.some(candidate =>
        candidate.id !== folderId && candidate.id.toLowerCase() === newId.toLowerCase());
    if (collides) {
        a.setMessageNotification({ type: 'error', message: a.t.dialogs.folder.folderExists });
        return false;
    }
    return a.persistChange(
        window.electronAPI?.renameFolder
            ? () => window.electronAPI.renameFolder(folderId, newId)
            : null,
        () => applyRehome(a, folderId, newId),
        (error) => folderWriteFailure(a.t, error),
    );
}

// The top level always takes a folder. Anywhere else has to be a folder that is
// in the tree and is not the folder itself or one below it, since that move
// would take its own destination with it.
function canMoveInto(folders, folderId, targetParentId) {
    if (targetParentId === null) return true;
    return folders.some(f => f.id === targetParentId) && !isFolderWithin(targetParentId, folderId);
}

// Move a project folder into another one, or back to the top level with a null
// parent. The folder keeps its name and everything below it; only where it sits
// changes, which on disk is one directory rename.
function moveFolderTo(a, folderId, targetParentId) {
    const folder = a.foldersRef.current.find(f => f.id === folderId);
    if (!folder || !canMoveInto(a.foldersRef.current, folderId, targetParentId)) return false;
    const newId = joinFolderId(targetParentId, folder.name);
    if (newId === folderId) return false;
    if (a.foldersRef.current.some(f => f.id.toLowerCase() === newId.toLowerCase())) {
        a.setMessageNotification({ type: 'error', message: a.t.dialogs.folder.folderExists });
        return false;
    }
    return a.persistChange(
        window.electronAPI?.renameFolder
            ? () => window.electronAPI.renameFolder(folderId, newId)
            : null,
        () => {
            applyRehome(a, folderId, newId);
            // Opened, or the folder lands somewhere the user cannot see.
            if (targetParentId !== null) {
                a.setFolders(prev => prev.map(f =>
                    f.id === targetParentId ? { ...f, expanded: true } : f));
            }
        },
        (error) => folderWriteFailure(a.t, error) || a.t.explorer.moveFailed(folder.name),
    );
}

export function useFolderActions({ tree, persistChange, setInputDialog, setMessageNotification, t }) {
    const a = useRef({});
    a.current = { ...tree, persistChange, setInputDialog, setMessageNotification, t };

    return {
        addFolder:         useCallback((parentFolder) => askNewFolder(a.current, parentFolder), []),
        renameFolder:      useCallback((folderId, newName) => renameFolderTo(a.current, folderId, newName), []),
        moveFolder:        useCallback((folderId, parentId) => moveFolderTo(a.current, folderId, parentId), []),
        moveItemsToFolder: useCallback((itemIds, targetId) => moveDesignsTo(a.current, itemIds, targetId), []),
    };
}
