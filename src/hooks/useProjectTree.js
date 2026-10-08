/**
 * The project tree the explorer draws, and everything the user does to it.
 *
 * This hook owns the folder list and the selection, reads both from disk at
 * startup and again on Refresh all (projectTreeLoad.js), and hands the rest to
 * the action hooks beside it: designs, deletion, imports and folders. They all
 * work through the same primitives kept here: the names taken in a folder,
 * putting a new design into the tree, and what a deleted design leaves behind.
 *
 * The operations below take `p`: the tree's own state setters, plus the design
 * store they have to keep in step.
 */

import { folderDesignNames } from '../utils/io/designNaming.js';
import { designFileLocations, idsLeavingTree, isFolderWithin, rehomedFolderId } from '../components/panels/projectExplorerModel.js';
import { withFollowedCopies } from '../utils/materials/catalogStamps.js';
import { LAST_SEEN_KEY, loadFolders, refreshFolders } from './projectTreeLoad.js';
import { useProjectPersistence } from './useProjectPersistence.js';
import { useDesignActions } from './useDesignActions.js';
import { useProjectRemoval } from './useProjectRemoval.js';
import { useDesignImport } from './useDesignImport.js';
import { useFolderActions } from './useFolderActions.js';

const { useState, useEffect, useRef, useCallback } = React;

// Put a design into the tree and open it. The design store, the folder's item
// list and the selection move together, and the disk baseline is set so a
// design that matches its .tfs is not born dirty. `mtime` is the time of the
// file just written, which the next save checks the file against, or none when
// it could not be read; the tree the next save reads has the row at once. A
// file opened from disk can carry copies that match a catalog here, which take
// its stamp as at load (withFollowedCopies).
function commitDesign(p, design, targetFolder, mtime) {
    const newItem = { id: design.id, name: design.name, mtime: Number.isFinite(mtime) ? mtime : undefined };
    const withRow = folders => folders.map(f =>
        f.id === targetFolder.id ? { ...f, items: [...f.items, newItem] } : f);
    p.diskDesignsRef.current[design.id] = JSON.parse(JSON.stringify(design));
    p.setDesigns(d => ({ ...d, [design.id]: withFollowedCopies(design) }));
    p.foldersRef.current = withRow(p.foldersRef.current);
    p.setFolders(withRow);
    p.setSelectedFolder(targetFolder);
    p.setSelectedItem(newItem);
    p.setSelectedItems([newItem]);
    p.setActiveDesignId(design.id);
}

// What a removed design leaves behind everywhere but the folder list, which
// each caller filters its own way: the selection, the dirty flag, the disk
// baseline, and the windows still showing it. `isRemoved(folder, item)` names
// the tree rows the caller takes out; a design another row still shows keeps
// its working copy, history, dirty flag and disk baseline.
function forgetDesigns(p, removedIds, isRemoved) {
    const gone = idsLeavingTree(p.foldersRef.current, removedIds, isRemoved);
    p.setSelectedItem(prev => (removedIds.has(prev?.id) ? null : prev));
    p.setSelectedItems(prev => prev.filter(item => !removedIds.has(item.id)));
    p.setActiveDesignId(prev => (removedIds.has(prev) ? null : prev));
    p.setDirtyDesigns(prev => {
        const next = { ...prev };
        gone.forEach(id => delete next[id]);
        return next;
    });
    p.dropDesigns(gone);
    gone.forEach(id => { delete p.diskDesignsRef.current[id]; });
    removedIds.forEach(id => {
        window.dispatchEvent(new CustomEvent(
            'tfstudio:design-evict', { detail: { id } }));
    });
}

// Show a design the tree already holds. The selection is what makes a design
// active (see the activate effect below). False when no folder holds a design
// with that id.
function selectDesign(p, designId) {
    for (const folder of p.foldersRef.current) {
        const item = folder.items.find(it => it.id === designId);
        if (!item) continue;
        p.setSelectedFolder(folder);
        p.setSelectedItem(item);
        p.setSelectedItems([item]);
        return true;
    }
    return false;
}

/**
 * `orderedItems` is the flat list of rows in the exact order the user SEES them
 * — folder order, only expanded folders, each folder's items run through the
 * active sort. The explorer passes it in. A shift-range MUST slice this list and
 * not the raw tree order: computed over the unsorted, collapsed-folder-inclusive
 * data order, a shift-click selected a span the user never saw.
 */
function clickItem(p, { item, folder, event, orderedItems }) {
    p.setSelectedFolder(folder);
    const ctrl = event?.ctrlKey || event?.metaKey;
    if (ctrl) {
        p.setSelectedItems(prev =>
            prev.find(s => s.id === item.id) ? prev.filter(s => s.id !== item.id) : [...prev, item]
        );
        p.setSelectedItem(item);
        // Move the anchor to the ctrl-clicked row so a following shift-click
        // ranges from here (matches file-explorer behaviour).
        p.setLastClickedItem(item);
        return;
    }
    if (event?.shiftKey && p.lastClickedItem) {
        selectRange(p, item, orderedItems);
        return;
    }
    p.setSelectedItem(item);
    p.setSelectedItems([item]);
    p.setLastClickedItem(item);
}

function selectRange(p, item, orderedItems) {
    const list = (orderedItems && orderedItems.length)
        ? orderedItems
        : p.foldersRef.current.flatMap(f => f.items);
    const lastIdx = list.findIndex(s => s.id === p.lastClickedItem.id);
    const currIdx = list.findIndex(s => s.id === item.id);
    if (lastIdx === -1 || currIdx === -1) {
        // The anchor is no longer visible (folder collapsed, item gone) — fall
        // back to a fresh single selection and re-anchor.
        p.setSelectedItem(item);
        p.setSelectedItems([item]);
        p.setLastClickedItem(item);
        return;
    }
    const [start, end] = lastIdx < currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx];
    p.setSelectedItems(list.slice(start, end + 1));
    p.setSelectedItem(item);
    // The anchor stays put across shift-clicks (the range grows and shrinks
    // from it).
}

export function useProjectTree({
    store, openTool, onRestoreLayout, setInputDialog, setMessageNotification, t,
}) {
    const [folders,        setFolders]        = useState([]);
    const [selectedItem,   setSelectedItem]   = useState(null);
    const [selectedFolder, setSelectedFolder] = useState(null);
    const [selectedItems,  setSelectedItems]  = useState([]);
    const [lastClickedItem,setLastClickedItem]= useState(null);
    // Set once the project tree has been read, which is when a design named on
    // the command line can be opened.
    const [foldersLoaded,  setFoldersLoaded]  = useState(false);

    const foldersRef = useRef([]);
    useEffect(() => { foldersRef.current = folders; }, [folders]);
    const fallbackRef = useRef(false);
    const unreadNamesRef = useRef({});
    // Whether a whole load of the tree is running, and how many have started,
    // so a refresh never mixes its read with one (projectTreeLoad.js).
    const loadRef = useRef({ busy: false, count: 0 });

    // Record where each design's file is, after every change to the tree, but
    // not while the app runs from the default folder in place of an unusable
    // one: that tree is not the one the record is for.
    useEffect(() => {
        if (!foldersLoaded || fallbackRef.current) return;
        try { localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(designFileLocations(folders))); } catch (_) { /* storage blocked */ }
    }, [folders, foldersLoaded]);

    // What the operations above read, refreshed every render and read at call
    // time, so they never need rebuilding and never go stale. It is assigned in
    // the render body rather than in an effect because the mount effect below,
    // and the hooks under this one, must already find it filled. That holds
    // while rendering is synchronous, which it is here: the app uses no
    // concurrent feature that can start a render and then drop it.
    const p = useRef({});
    p.current = {
        foldersRef, setFolders, setSelectedFolder, setSelectedItem, setSelectedItems,
        setLastClickedItem, setFoldersLoaded, lastClickedItem, onRestoreLayout,
        fallbackRef, unreadNamesRef, loadRef, foldersLoaded,
        setDesigns: store.setDesigns, setDirtyDesigns: store.setDirtyDesigns,
        setActiveDesignId: store.setActiveDesignId, dropDesigns: store.dropDesigns,
        diskDesignsRef: store.diskDesignsRef, historyRef: store.historyRef,
        designsRef: store.designsRef, flushSession: store.flushSession,
        setMessageNotification, t,
    };

    const persistChange = useProjectPersistence(setMessageNotification, t);

    // ── Activate the design when the selected item ID changes ─────────────────
    const { activateDesign } = store;
    useEffect(() => {
        if (selectedItem?.id) activateDesign(selectedItem);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedItem?.id]);

    // The design names one project folder holds. New, imported and duplicated
    // designs are made unique against the names in the folder they are going
    // into: a name decides the .tfs filename, so a collision inside a folder
    // would overwrite the other design's file. Two folders are two directories
    // and may each hold the same name (see designNaming.js).
    // A file the loader could not read keeps its name taken.
    const existingDesignNames = useCallback((folderId) => [
        ...folderDesignNames(foldersRef.current, folderId), ...(unreadNamesRef.current[folderId] || []),
    ], []);
    // A folder renamed or moved takes its unread files with it on disk, and one
    // deleted whole takes them away.
    const rehomeUnreadNames = useCallback((folderId, newId) => {
        unreadNamesRef.current = Object.fromEntries(Object.entries(unreadNamesRef.current)
            .map(([id, names]) => [rehomedFolderId(id, folderId, newId), names]));
    }, []);
    const forgetUnreadNames = useCallback((folderId) => {
        unreadNamesRef.current = Object.fromEntries(Object.entries(unreadNamesRef.current)
            .filter(([id]) => !isFolderWithin(id, folderId)));
    }, []);

    const commitNewDesign    = useCallback((design, folder, mtime) => commitDesign(p.current, design, folder, mtime), []);
    const evictDesigns       = useCallback((removedIds, isRemoved) => forgetDesigns(p.current, removedIds, isRemoved), []);
    const selectDesignInTree = useCallback((designId) => selectDesign(p.current, designId), []);
    const loadFoldersFromDisk = useCallback(async (opts) => {
        const load = loadRef.current;
        load.busy = true;
        load.count += 1;
        try { await loadFolders(p.current, opts); } finally { load.busy = false; }
    }, []);
    const refreshFoldersFromDisk = useCallback(reloadCatalogs => refreshFolders(p.current,
        (removedIds, isRemoved) => forgetDesigns(p.current, removedIds, isRemoved), reloadCatalogs), []);
    const handleItemClick = useCallback((item, folder, event, orderedItems) =>
        clickItem(p.current, { item, folder, event, orderedItems }), []);
    const toggleFolderExpanded = useCallback((folderId) =>
        setFolders(prev => prev.map(f => f.id === folderId ? { ...f, expanded: !f.expanded } : f)),
    []);

    useEffect(() => { loadFoldersFromDisk(); }, [loadFoldersFromDisk]);

    const tree = {
        folders, foldersRef, setFolders, foldersLoaded,
        selectedFolder, setSelectedFolder, selectedItem, setSelectedItem,
        selectedItems, setSelectedItems,
        existingDesignNames, rehomeUnreadNames, forgetUnreadNames, commitNewDesign, evictDesigns, selectDesignInTree,
    };

    const designs = useDesignActions({ store, tree, persistChange, setInputDialog, setMessageNotification, t });
    const removal = useProjectRemoval({ tree, persistChange, setMessageNotification, t });
    const imports = useDesignImport({
        tree, addItemFromDesign: designs.addItemFromDesign, openTool, setMessageNotification, t,
    });
    const folderActions = useFolderActions({
        tree, persistChange, setInputDialog, setMessageNotification, t,
    });

    return {
        folders, selectedFolder, selectedItem, selectedItems, setSelectedFolder, setSelectedItem,
        handleItemClick, toggleFolderExpanded, loadFoldersFromDisk, refreshFoldersFromDisk,
        ...designs, ...removal, ...imports, ...folderActions,
    };
}
