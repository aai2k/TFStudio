/**
 * The project tree the explorer draws, and everything the user does to it.
 *
 * This hook owns the folder list and the selection, reads both from disk at
 * startup, and hands the rest to the action hooks beside it: designs, deletion,
 * imports and folders. They all work through the same primitives kept here:
 * the names taken in a folder, putting a new design into the tree, and what a
 * deleted design leaves behind.
 *
 * The operations below take `p`: the tree's own state setters, plus the design
 * store they have to keep in step.
 */

import { folderDesignNames } from '../utils/io/designNaming.js';
import { idsLeavingTree } from '../components/panels/projectExplorerModel.js';
import { loadSession } from '../utils/io/appSession.js';
import { parseFoldersResult } from '../utils/io/projectPersistence.js';
import { mergeSessionOverDisk, storeMergedSession } from '../utils/io/sessionMerge.js';
import { useProjectPersistence } from './useProjectPersistence.js';
import { useDesignActions } from './useDesignActions.js';
import { useProjectRemoval } from './useProjectRemoval.js';
import { useDesignImport } from './useDesignImport.js';
import { useFolderActions } from './useFolderActions.js';

const { useState, useEffect, useRef, useCallback } = React;

// Put a design into the tree and open it. The design store, the folder's item
// list and the selection move together, and the disk baseline is set so a
// design that matches its .tfs is not born dirty.
function commitDesign(p, design, targetFolder) {
    const newItem = { id: design.id, name: design.name, mtime: Date.now() };
    p.diskDesignsRef.current[design.id] = JSON.parse(JSON.stringify(design));
    p.setDesigns(d => ({ ...d, [design.id]: design }));
    p.setFolders(prev => prev.map(f =>
        f.id === targetFolder.id ? { ...f, items: [...f.items, newItem] } : f
    ));
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

async function loadFolders(p, { restoreSession = true, restoreLayout = true } = {}) {
    let diskDesigns   = {};
    let loadedFolders = [];
    // Every file in the Projects folder was read, so a design missing from it
    // is gone rather than unread.
    let readWhole     = false;

    if (window.electronAPI?.loadFolders) {
        const result = await window.electronAPI.loadFolders();
        if (result.success) {
            ({ diskDesigns, loadedFolders } = parseFoldersResult(result));
            readWhole = result.unreadable === 0;
        }
    }

    if (loadedFolders.length === 0) {
        loadedFolders = [{ id: 'My Designs', name: 'My Designs', expanded: true, items: [] }];
        if (window.electronAPI?.createFolder) {
            await window.electronAPI.createFolder('My Designs');
        }
    }

    // Disk is the dirty baseline. The .tfs on disk is the last explicit save;
    // an item is dirty iff the working copy differs from it CANONICALLY (key
    // order and the tfs_version wrapper are ignored — that asymmetry was the
    // cause of every file showing ● on startup).
    p.diskDesignsRef.current = { ...diskDesigns };

    // Merge session (unsaved working copies) over disk snapshots. A working copy
    // wins while its file is the one it was edited from, since it has the latest
    // edits even if the app was closed without saving; the undo/redo history
    // comes with it so it survives a restart. A file saved since wins over it.
    // Entries for designs with no file are removed only after a complete read
    // that found designs: an empty result is more likely a Projects folder that
    // is not there than one whose every design was deleted.
    const session = restoreSession ? loadSession() : null;
    const dropMissing = readWhole && Object.keys(diskDesigns).length > 0;
    const merged = mergeSessionOverDisk(diskDesigns, session?.entries || null, { dropMissing });
    p.historyRef.current = merged.history;

    p.setDesigns(merged.initialDesigns);
    p.setDirtyDesigns(merged.initialDirty);
    p.setFolders(loadedFolders);
    if (session) storeMergedSession(session, merged, diskDesigns);
    if (merged.replaced.length) {
        const names = merged.replaced.map(id => merged.initialDesigns[id].name).join(', ');
        p.setMessageNotification({ type: 'info', message: p.t.dialogs.savedElsewhere(names) });
    }

    if (!restoreSession) {
        // A live Projects-root change is a workspace switch, not a startup
        // restore. Keeping selections from the previous root would leave the
        // explorer showing one directory while commands target another.
        p.setActiveDesignId(null);
        p.setSelectedItem(null);
        p.setSelectedItems([]);
        p.setLastClickedItem(null);
    }

    // Startup: select a project FOLDER as the default target for new designs,
    // but do NOT auto-open any design. The workspace shows the empty-state
    // ("Create a project…") until the user creates or picks a design.
    p.setSelectedFolder(loadedFolders[0] || null);

    // Restore a previously saved docking layout if there is one; otherwise the
    // workspace stays empty (no preset) so the empty-state is shown.
    if (restoreLayout) p.onRestoreLayout();

    p.setFoldersLoaded(true);
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
        setDesigns: store.setDesigns, setDirtyDesigns: store.setDirtyDesigns,
        setActiveDesignId: store.setActiveDesignId, dropDesigns: store.dropDesigns,
        diskDesignsRef: store.diskDesignsRef, historyRef: store.historyRef,
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
    const existingDesignNames = useCallback(
        (folderId) => folderDesignNames(foldersRef.current, folderId), []);

    const commitNewDesign    = useCallback((design, folder) => commitDesign(p.current, design, folder), []);
    const evictDesigns       = useCallback((removedIds, isRemoved) => forgetDesigns(p.current, removedIds, isRemoved), []);
    const selectDesignInTree = useCallback((designId) => selectDesign(p.current, designId), []);
    const loadFoldersFromDisk = useCallback((opts) => loadFolders(p.current, opts), []);
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
        existingDesignNames, commitNewDesign, evictDesigns, selectDesignInTree,
    };

    const designs = useDesignActions({ store, tree, persistChange, setInputDialog, setMessageNotification, t });
    const removal = useProjectRemoval({ tree, persistChange });
    const imports = useDesignImport({
        tree, addItemFromDesign: designs.addItemFromDesign, openTool, setMessageNotification, t,
    });
    const folderActions = useFolderActions({
        tree, persistChange, setInputDialog, setMessageNotification, t,
    });

    return {
        folders, selectedFolder, selectedItem, selectedItems, setSelectedFolder, setSelectedItem,
        handleItemClick, toggleFolderExpanded, loadFoldersFromDisk,
        ...designs, ...removal, ...imports, ...folderActions,
    };
}
