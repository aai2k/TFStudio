/**
 * Reading the Projects folder into the project tree: once at startup, where
 * the stored session's working copies meet the files, and again on Refresh
 * all, where the designs in memory meet them in the same way.
 *
 * Both take `p`, the tree's state setters and the design store they keep in
 * step (see useProjectTree.js).
 */

import { loadSession } from '../utils/io/appSession.js';
import { designsEqual, parseFoldersResult } from '../utils/io/projectPersistence.js';
import {
    mergeSessionOverDisk, sameMaterialCopies, sessionEntryFor, storeMergedSession,
} from '../utils/io/sessionMerge.js';
import { followedDesigns } from '../utils/materials/catalogStamps.js';

// Where each design's file was when the tree was last seen. When two files
// hold one id (a design copied outside the app), the loader gives the id to
// the file at its recorded place, so the original keeps its unsaved work and
// history and the copy is the one renumbered.
export const LAST_SEEN_KEY = 'tfstudio:design-locations';

function lastSeenLocations() {
    try { return JSON.parse(localStorage.getItem(LAST_SEEN_KEY)) || undefined; } catch (_) { return undefined; }
}

// The design names of the files the loader could not read, by folder. They are
// taken: a new design under one of them would be refused, the file being
// another's.
function unreadNamesByFolder(files) {
    const byFolder = {};
    for (const file of files) {
        if (!file.endsWith('.tfs')) continue;
        const cut = file.lastIndexOf('/');
        (byFolder[file.slice(0, cut)] ||= []).push(file.slice(cut + 1, -4));
    }
    return byFolder;
}

// Read the Projects folder. `ok` is false when it could not be listed at all,
// and the rest is then empty.
async function readProjectsFolder() {
    const read = {
        ok: false, diskDesigns: {}, loadedFolders: [],
        // Every file in the Projects folder was read, so a design missing from
        // it is gone rather than unread.
        readWhole: false,
        // The chosen data folder was unusable at startup (a drive not plugged
        // in) and the app runs from the default one: the session's designs are
        // on that drive, not gone.
        fallback: false,
        unreadFiles: [],
    };
    if (!window.electronAPI?.loadFolders) return read;
    const result = await window.electronAPI.loadFolders(lastSeenLocations());
    if (!result.success) return read;
    return {
        ...read, ok: true, ...parseFoldersResult(result),
        readWhole: result.unreadable === 0,
        fallback: result.fallback === true,
        unreadFiles: result.unreadFiles || [],
    };
}

// An empty Projects folder gets the one folder a new design can go into.
async function withDefaultFolder(folders) {
    if (folders.length) return folders;
    if (window.electronAPI?.createFolder) await window.electronAPI.createFolder('My Designs');
    return [{ id: 'My Designs', name: 'My Designs', expanded: true, items: [] }];
}

// Entries for designs with no file are removed only after a complete read that
// found designs: an empty result is more likely a Projects folder that is not
// there than one whose every design was deleted.
function dropsMissing(read) {
    return read.readWhole && !read.fallback && Object.keys(read.diskDesigns).length > 0;
}

// What a merge of working copies over the files has to tell the user.
function reportMerge(p, merged, unreadFiles, refused) {
    if (merged.replaced.length) {
        const names = merged.replaced.map(id => merged.initialDesigns[id].name).join(', ');
        p.setMessageNotification({ type: 'info', message: p.t.dialogs.savedElsewhere(names) });
    }
    if (unreadFiles.length) {
        p.setMessageNotification({ type: 'error', message: p.t.dialogs.unreadDesignFiles(unreadFiles.join(', ')) });
    }
    // Shown last, over the notices above: unsaved work is at risk.
    if (refused.length) p.setMessageNotification({ type: 'error', message: p.t.dialogs.sessionFull });
}

export async function loadFolders(p, { restoreLayout = true } = {}) {
    const read = await readProjectsFolder();
    const { diskDesigns } = read;
    p.fallbackRef.current = read.fallback;
    p.unreadNamesRef.current = unreadNamesByFolder(read.unreadFiles);
    const loadedFolders = await withDefaultFolder(read.loadedFolders);

    // Disk is the dirty baseline. The .tfs on disk is the last explicit save;
    // an item is dirty iff the working copy differs from it canonically. Key
    // order and the tfs_version wrapper are ignored, or every file would show
    // ● on startup.
    p.diskDesignsRef.current = { ...diskDesigns };

    // Merge session (unsaved working copies) over disk snapshots. A working copy
    // wins while its file is the one it was edited from, since it has the latest
    // edits even if the app was closed without saving; the undo/redo history
    // comes with it so it survives a restart. A file saved since wins over it.
    const session = loadSession();
    const merged = mergeSessionOverDisk(diskDesigns, session?.entries || null, { dropMissing: dropsMissing(read) });
    p.historyRef.current = merged.history;

    // Copies that match a catalog loaded already take its stamp (followedDesigns);
    // catalogs that load later do the same through the store. Each load does it
    // again from the files, so nothing goes into the session for it.
    p.setDesigns(followedDesigns(merged.initialDesigns).designs);
    p.setDirtyDesigns(merged.initialDirty);
    p.setFolders(loadedFolders);
    const refused = session ? storeMergedSession(session, merged, diskDesigns) : [];
    reportMerge(p, merged, read.unreadFiles, refused);

    // Startup: select a project FOLDER as the default target for new designs,
    // but do NOT auto-open any design. The workspace shows the empty-state
    // ("Create a project…") until the user creates or picks a design.
    p.setSelectedFolder(loadedFolders[0] || null);

    // Restore a previously saved docking layout if there is one; otherwise the
    // workspace stays empty (no preset) so the empty-state is shown.
    if (restoreLayout) p.onRestoreLayout();

    p.setFoldersLoaded(true);
}

// A design in memory that matches the one just read keeps its object, so the
// windows showing it have nothing to recompute.
function sameOrFresh(live, fresh) {
    return live && designsEqual(live, fresh) && sameMaterialCopies(live, fresh) ? live : fresh;
}

// The session entries the designs in memory would have, from memory rather
// than storage, so an edit storage refused still counts. `ids` are the tree's
// designs and any other design in memory whose file was just read: one an
// earlier, incomplete read left out of the tree keeps its edits when its file
// can be read again.
function liveEntries(p, ids) {
    const entries = {};
    for (const id of ids) {
        const entry = sessionEntryFor(p.designsRef.current[id], p.historyRef.current[id], p.diskDesignsRef.current[id]);
        if (entry) entries[id] = entry;
    }
    return entries;
}

// The design store after a refresh. A working copy whose file is unchanged is
// left as it is in memory, history and all, except that it takes the file's
// name: a file renamed outside the app would otherwise be saved again under
// its old name, a second file holding the same design. The rest take what was
// read. A design the tree no longer shows is not touched here.
//
// Returns the ids of the designs in memory this changed, which count as edited
// (see announceRefreshAll): a synthesis window that cached one of them from
// before must not carry on from that.
function applyMergedDesigns(p, { fresh, entries, merged, diskDesigns }) {
    const replaced = id => !entries[id] || merged.rewrite.includes(id);
    const replacedIds = Object.keys(fresh).filter(replaced);
    const keptIds = Object.keys(fresh).filter(id => !replaced(id));
    const live = p.designsRef.current;
    const changedIds = [
        ...replacedIds.filter(id => live[id] && sameOrFresh(live[id], fresh[id]) !== live[id]),
        ...keptIds.filter(id => live[id] && live[id].name !== diskDesigns[id].name),
    ];
    for (const id of replacedIds) {
        if (merged.history[id]) p.historyRef.current[id] = merged.history[id];
        else delete p.historyRef.current[id];
    }
    p.diskDesignsRef.current = { ...p.diskDesignsRef.current, ...diskDesigns };
    p.setDesigns(prev => {
        const next = { ...prev };
        for (const id of replacedIds) next[id] = sameOrFresh(prev[id], fresh[id]);
        for (const id of keptIds) {
            const { name } = diskDesigns[id];
            if (prev[id] && prev[id].name !== name) next[id] = { ...prev[id], name };
        }
        return next;
    });
    p.setDirtyDesigns(prev => {
        const next = { ...prev };
        for (const id of Object.keys(fresh)) delete next[id];
        return { ...next, ...merged.initialDirty };
    });
    return changedIds;
}

// The new folder list in place of `before`, with the folders the user left
// open or closed as they were, and the selection moved onto its new rows.
function applyFolders(p, before, folders) {
    const wasExpanded = new Map(before.map(folder => [folder.id, folder.expanded]));
    const shown = folders.map(folder => (wasExpanded.has(folder.id)
        ? { ...folder, expanded: wasExpanded.get(folder.id) } : folder));
    const itemById = new Map(shown.flatMap(folder => folder.items.map(item => [item.id, item])));
    p.foldersRef.current = shown;
    p.setFolders(shown);
    p.setSelectedFolder(prev => shown.find(folder => folder.id === prev?.id) || shown[0] || null);
    p.setSelectedItem(prev => (prev && itemById.get(prev.id)) || null);
    p.setSelectedItems(prev => prev.map(item => itemById.get(item.id)).filter(Boolean));
}

/**
 * Read the Projects folder again with the app running, for a file added,
 * changed or deleted outside it. The designs in memory meet the files the way
 * the stored session does at startup (mergeSessionOverDisk): one whose file is
 * unchanged keeps its unsaved edits and undo history, and a file changed since
 * wins with the working copy one Ctrl+Z back. A new file joins the tree. A
 * deleted one leaves it, and the windows showing it, after a complete read; a
 * read that missed files keeps every design it did not find in memory. The
 * layout, the folders left open, the selection and the active design stay
 * while their design is there, and a read that fails changes nothing.
 *
 * `forget(ids, isRemoved)` takes designs whose file is gone out of the tree,
 * the store and the windows showing them.
 *
 * The catalogs are reloaded (`reloadCatalogs`) after the folder is read and
 * before anything read is applied. Everything is then applied in the same task
 * as the catalogs' own event, so the windows render once, with the new designs
 * and the new catalogs together, rather than first against the old catalogs.
 *
 * Before the tree is first read, or while a whole load runs (startup, a data
 * folder move), a refresh does nothing and returns null: the designs in memory
 * are not yet the ones that load will show, and the load reads the catalogs
 * too. A load that starts while a refresh reads has the last word: the refresh
 * drops what it read and returns null as well. Otherwise it returns the ids of
 * the designs in memory it changed.
 */
export async function refreshFolders(p, forget, reloadCatalogs) {
    if (!p.foldersLoaded || p.loadRef.current.busy) return null;
    const loads = p.loadRef.current.count;
    p.flushSession();
    const read = await readProjectsFolder();
    const folders = read.ok ? await withDefaultFolder(read.loadedFolders) : null;
    await reloadCatalogs();
    if (p.loadRef.current.count !== loads) return null;
    return read.ok ? applyRead(p, forget, read, folders) : [];
}

// Everything a refresh read, applied at once (see refreshFolders).
function applyRead(p, forget, read, folders) {
    const before = p.foldersRef.current;
    const treeIds = new Set(before.flatMap(folder => folder.items.map(item => item.id)));
    const inMemory = Object.keys(read.diskDesigns).filter(id => p.designsRef.current[id]);
    const entries = liveEntries(p, new Set([...treeIds, ...inMemory]));
    const dropMissing = dropsMissing(read);
    const merged = mergeSessionOverDisk(read.diskDesigns, entries, { dropMissing });
    const fresh = followedDesigns(merged.initialDesigns).designs;
    const gone = new Set([...treeIds].filter(id => !fresh[id]));
    if (dropMissing && gone.size) forget(gone, (_folder, item) => gone.has(item.id));

    const changedIds = applyMergedDesigns(p, { fresh, entries, merged, diskDesigns: read.diskDesigns });
    p.fallbackRef.current = read.fallback;
    p.unreadNamesRef.current = unreadNamesByFolder(read.unreadFiles);
    applyFolders(p, before, folders);

    const refused = storeMergedSession({ entries, legacy: false }, merged, read.diskDesigns);
    reportMerge(p, merged, read.unreadFiles, refused);
    return changedIds;
}
