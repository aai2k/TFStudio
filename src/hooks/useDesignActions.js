/**
 * Creating, saving and renaming designs.
 *
 * Everything that puts a NEW design into the tree (a blank one, one a wizard
 * built, a duplicate, Save As) writes its .tfs first and reaches the tree
 * through the same commit, so a design that failed to write is never shown.
 *
 * Each operation takes `a`: the design store, the project tree, and the way to
 * persist a change and to speak to the user.
 */

import { makeDefaultDesign } from '../state/DesignContext.js';
import { designFileKey, isUnusableDesignName, uniqueDesignName } from '../utils/io/designNaming.js';
import { writeDesignFile, copyDesignWithFreshIds } from '../utils/io/designFiles.js';
import { embedDesignMaterials } from '../utils/materials/designMaterials.js';
import { updateDirtyDesigns } from '../utils/io/projectPersistence.js';
import { sameMaterialCopies } from '../utils/io/sessionMerge.js';
import { rowFileFailure, updateExplorerItemMtime } from '../components/panels/projectExplorerModel.js';

const { useRef, useCallback } = React;

// The write half of a create, or null where there is no disk to write to (the
// browser demo), which leaves the commit to run on its own.
function writeIfPossible(folderId, design) {
    return window.electronAPI?.saveDesign
        ? () => writeDesignFile(folderId, design)
        : null;
}

// The material copies a save wrote, put on the design in the store without an
// undo step. The design then keeps the definitions its file has: a catalog
// deleted later costs it nothing, and its next save writes them again. A save
// that changed no copy leaves the design object as it was, so windows that
// recompute on a new design (a running surface sweep) carry on.
function keepCopies(a, id, fileDesign) {
    a.setDesigns(prev => {
        const current = prev[id];
        if (!current || sameMaterialCopies(current, fileDesign)) return prev;
        // eslint-disable-next-line no-unused-vars
        const { materials, ...rest } = current;
        return { ...prev, [id]: fileDesign.materials ? { ...rest, materials: fileDesign.materials } : rest };
    });
}

// The file changed on disk since it was read or written here: by another copy
// of TFStudio, another computer sharing the folder, or an editor. Overwrite
// only when the user says so.
function askOverwrite(a, id, design) {
    const text = a.t.dialogs.changedOnDisk;
    a.setInputDialog({
        confirm: true, danger: true,
        title: text.title,
        message: text.message(a.designsRef.current[id]?.name || id),
        confirmLabel: text.overwrite,
        onConfirm: () => { a.setInputDialog(null); saveToDisk(a, id, design, { overwrite: true }); },
        onCancel: () => a.setInputDialog(null),
    });
}

// The time a write left on a row's file, in the tree the next save reads at
// once as well as in the state the explorer renders from. A write the main
// process could not read the time of leaves none, and the next save writes
// without the check.
function setRowMtime(a, id, mtime) {
    a.foldersRef.current = updateExplorerItemMtime(a.foldersRef.current, id, mtime);
    a.setFolders(current => updateExplorerItemMtime(current, id, mtime));
}

// ── Explicit save to disk (Ctrl+S / File > Save) ──────────────────────────────
// One save of a design at a time: a second Ctrl+S while the first is still
// writing waits for it, whatever its outcome, and is checked against the time
// that write left.
function saveToDisk(a, id, design, options) {
    const targetId = id ?? a.activeDesignId;
    const before = a.savesInFlight.get(targetId);
    const run = before
        ? before.catch(() => {}).then(() => writeToDisk(a, targetId, design, options))
        : Promise.resolve(writeToDisk(a, targetId, design, options));
    a.savesInFlight.set(targetId, run);
    const settle = () => { if (a.savesInFlight.get(targetId) === run) a.savesInFlight.delete(targetId); };
    run.then(settle, settle);
    return run;
}

function writeToDisk(a, targetId, design, { overwrite = false } = {}) {
    const targetDesign = design ?? a.designsRef.current[targetId];
    if (!targetId || !targetDesign) return;
    if (!window.electronAPI?.saveDesign) return;   // no disk to write to
    const folder = a.foldersRef.current.find(f => f.items.some(i => i.id === targetId));
    if (!folder) {
        // A design the store holds but no folder does, such as the preview a
        // window drops in, has no file to be written to. Saying so beats a
        // Ctrl+S that does nothing and leaves the design marked unsaved.
        a.setMessageNotification({ type: 'error', message: a.t.dialogs.persistenceFailed });
        return;
    }
    const savedSnapshot = embedDesignMaterials(JSON.parse(JSON.stringify(targetDesign)));
    const known = folder.items.find(i => i.id === targetId)?.mtime;
    return a.persistChange(
        () => writeDesignFile(folder.id, savedSnapshot, overwrite ? undefined : known),
        (result) => {
            a.diskDesignsRef.current[targetId] = savedSnapshot;
            keepCopies(a, targetId, savedSnapshot);
            a.scheduleSessionSave(targetId);
            setRowMtime(a, targetId, result?.mtime);
            a.setDirtyDesigns(d => updateDirtyDesigns(
                d, targetId, a.designsRef.current[targetId], savedSnapshot));
        },
        (error) => {
            if (error !== 'changed-on-disk') return a.t.dialogs.saveAs.saveFailed;
            askOverwrite(a, targetId, design);
            return false;
        },
    );
}

// Designs with unsaved changes that have a file to be saved to. A design that
// sits in no project folder, such as a preview a window shows, has none.
function unsavedInFolders(a) {
    const inTree = new Set(a.foldersRef.current.flatMap(folder => folder.items.map(item => item.id)));
    return Object.keys(a.dirtyDesigns).filter(id => a.dirtyDesigns[id] && inTree.has(id));
}

// Each of them written to its own file as Save writes it, one after another.
// Returns the names of those that could not be written; a failed write has
// already been reported.
async function saveUnsaved(a) {
    const failed = [];
    for (const id of unsavedInFolders(a)) {
        if (!(await saveToDisk(a, id))) failed.push(a.designsRef.current[id]?.name || id);
    }
    // What follows a save-all (a data folder move) reloads the designs from the
    // session, so it has to hold their undo history now, not half a second later.
    a.flushSession?.();
    return failed;
}

function addDesign(a, overrideFolder) {
    const targetFolder = overrideFolder || a.selectedFolder;
    if (!targetFolder) return;
    // The running count is not unique on its own: deleting "Design 2" of three
    // makes the next default "Design 3", which already exists. Keep counting up
    // rather than falling back to a parenthesised suffix. The count is of this
    // folder, so each one numbers its designs from 1.
    const taken  = a.existingDesignNames(targetFolder.id);
    const n      = taken.length + 1;
    const name   = uniqueDesignName(`Design ${n}`, taken, (_, k) => `Design ${n + k - 1}`);
    const design = embedDesignMaterials(makeDefaultDesign(name));

    return a.persistChange(
        writeIfPossible(targetFolder.id, design),
        (result) => a.commitNewDesign(design, targetFolder, result?.mtime),
    );
}

// A design the caller already built (a wizard's output, an import). Same path as
// `addDesign`, differing only in where the design came from.
function addDesignFrom(a, incoming, overrideFolder) {
    const targetFolder = overrideFolder || a.selectedFolder;
    if (!targetFolder || !incoming) return;
    const name   = uniqueDesignName(incoming.name, a.existingDesignNames(targetFolder.id), (b, k) => `${b} (${k})`);
    // Created with the material copies its file gets, like any saved design.
    const design = embedDesignMaterials(name === incoming.name ? incoming : { ...incoming, name });

    return a.persistChange(
        writeIfPossible(targetFolder.id, design),
        (result) => a.commitNewDesign(design, targetFolder, result?.mtime),
    );
}

// The source of a duplicate or a Save As stays open in the store, so it is
// deep-copied before its ids are replaced: the two designs must not share a
// nested object that an edit to one could reach through.
function deepCopy(design) {
    return JSON.parse(JSON.stringify(design));
}

function duplicateDesign(a, item, folder) {
    const src = a.designsRef.current[item.id];
    if (!src) return;
    const newName = uniqueDesignName(
        `${item.name} (copy)`, a.existingDesignNames(folder.id), (b, k) => `${b} ${k}`);
    const clone = embedDesignMaterials(copyDesignWithFreshIds(deepCopy(src), newName));
    return a.persistChange(
        writeIfPossible(folder.id, clone),
        (result) => a.commitNewDesign(clone, folder, result?.mtime),
    );
}

// Save As refuses a name that is empty, that is already a file in this
// folder (the name decides the filename, so the copy would land on it), or
// that Windows cannot use for a file.
function saveAsValidator(sa, takenKeys) {
    return (nm) => {
        if (!nm?.trim()) return sa.empty;
        if (takenKeys.has(designFileKey(nm.trim()))) return sa.exists;
        if (isUnusableDesignName(nm.trim())) return sa.unusable;
        return '';
    };
}

// ── Save As: persist the active design under a new name as a separate file ────
function askSaveAs(a) {
    const src = a.activeDesignId && a.designsRef.current[a.activeDesignId];
    if (!src) return;
    const folder = a.foldersRef.current.find(f => f.items.some(i => i.id === a.activeDesignId))
                 || a.selectedFolder || a.foldersRef.current[0];
    if (!folder) return;

    const sa       = a.t.dialogs.saveAs;
    const inFolder = a.existingDesignNames(folder.id);

    a.setInputDialog({
        title: sa.title,
        defaultValue: uniqueDesignName(`${src.name} (copy)`, inFolder, (b, k) => `${b} ${k}`),
        validate: saveAsValidator(sa, new Set(inFolder.map(designFileKey))),
        onConfirm: async (nm) => {
            const clone = embedDesignMaterials(copyDesignWithFreshIds(deepCopy(src), nm.trim()));
            const saved = await a.persistChange(
                writeIfPossible(folder.id, clone),
                (result) => a.commitNewDesign(clone, folder, result?.mtime),
                sa.saveFailed,
            );
            if (saved) a.setInputDialog(null);
        },
        onCancel: () => a.setInputDialog(null),
    });
}

// The design's own copy of its name, in the store and in the disk baseline, so
// neither reads as an edit against the file that has just been renamed.
function renameInStore(a, itemId, newName) {
    a.setDesigns(prev => (prev[itemId]
        ? { ...prev, [itemId]: { ...prev[itemId], name: newName } }
        : prev));
    if (a.diskDesignsRef.current[itemId]) {
        a.diskDesignsRef.current[itemId] = {
            ...a.diskDesignsRef.current[itemId], name: newName,
        };
    }
    a.scheduleSessionSave(itemId);
}

function renameDesign(a, folderId, itemId, newName) {
    const folder = a.foldersRef.current.find(f => f.id === folderId);
    const item   = folder?.items.find(i => i.id === itemId);
    if (!item) return;
    const collides = folder.items.some(candidate =>
        candidate.id !== itemId && designFileKey(candidate.name) === designFileKey(newName));
    if (collides) {
        a.setMessageNotification({ type: 'error', message: a.t.dialogs.saveAs.exists });
        return false;
    }
    if (isUnusableDesignName(newName)) {
        a.setMessageNotification({ type: 'error', message: a.t.dialogs.saveAs.unusable });
        return false;
    }
    const oldName = item.name;
    const onDisk = !!window.electronAPI?.renameItem;
    return a.persistChange(
        onDisk ? () => window.electronAPI.renameItem(folder.id, oldName, newName, itemId, item.mtime) : null,
        (result) => {
            // The rename rewrites the file, so the time it answers with is the
            // file's from now on; with no disk there is no file to time.
            const updated = { ...item, name: newName, mtime: onDisk ? result?.mtime : item.mtime };
            const withRow = folders => folders.map(f => f.id === folderId
                ? { ...f, items: f.items.map(i => i.id === itemId ? updated : i) }
                : f);
            a.foldersRef.current = withRow(a.foldersRef.current);
            a.setFolders(withRow);
            a.setSelectedItem(prev => (prev?.id === itemId ? updated : prev));
            a.setSelectedItems(prev => prev.map(i => (i.id === itemId ? updated : i)));
            renameInStore(a, itemId, newName);
        },
        (error) => rowFileFailure(a.t, error, oldName),
    );
}

export function useDesignActions({ store, tree, persistChange, setInputDialog, setMessageNotification, t }) {
    // Everything the operations above read: the design store, the project tree,
    // and the app's own notifications. Refreshed every render and read at call
    // time, so the actions never need rebuilding and never go stale.
    const a = useRef({});
    // The save of each design still writing, by id; see saveToDisk.
    const savesInFlight = useRef(new Map());
    a.current = {
        ...store, ...tree, persistChange, setInputDialog, setMessageNotification, t,
        savesInFlight: savesInFlight.current,
    };

    const addItemFromDesign = useCallback(
        (incoming, folder) => addDesignFrom(a.current, incoming, folder), []);

    // Docked windows that produce a whole design (n,k Characterization) add it
    // through the same path. Null while no folder is selected, so the window can
    // disable the action instead of appearing to do nothing.
    const createDesignFromWindow = React.useMemo(
        () => (tree.selectedFolder ? (design) => { addItemFromDesign(design); } : null),
        [tree.selectedFolder, addItemFromDesign]);

    return {
        addItemFromDesign, createDesignFromWindow,
        saveDesignToDisk: useCallback((id, design) => saveToDisk(a.current, id, design), []),
        countUnsavedDesigns: useCallback(() => unsavedInFolders(a.current).length, []),
        saveUnsavedDesigns: useCallback(() => saveUnsaved(a.current), []),
        addItem:          useCallback((folder) => addDesign(a.current, folder), []),
        duplicateItem:    useCallback((item, folder) => duplicateDesign(a.current, item, folder), []),
        saveDesignAs:     useCallback(() => askSaveAs(a.current), []),
        renameItem:       useCallback((folderId, itemId, name) => renameDesign(a.current, folderId, itemId, name), []),
    };
}
