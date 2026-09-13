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
import { designFileKey, uniqueDesignName } from '../utils/io/designNaming.js';
import { writeDesignFile, copyDesignWithFreshIds } from '../utils/io/designFiles.js';
import { updateDirtyDesigns } from '../utils/io/projectPersistence.js';
import { updateExplorerItemMtime } from '../components/panels/projectExplorerModel.js';

const { useRef, useCallback } = React;

// The write half of a create, or null where there is no disk to write to (the
// browser demo), which leaves the commit to run on its own.
function writeIfPossible(folderId, design) {
    return window.electronAPI?.saveDesign
        ? () => writeDesignFile(folderId, design)
        : null;
}

// ── Explicit save to disk (Ctrl+S / File > Save) ──────────────────────────────
function saveToDisk(a, id, design) {
    const targetId     = id     ?? a.activeDesignId;
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
    const savedSnapshot = JSON.parse(JSON.stringify(targetDesign));
    return a.persistChange(
        () => writeDesignFile(folder.id, savedSnapshot),
        () => {
            a.diskDesignsRef.current[targetId] = savedSnapshot;
            a.setFolders(current => updateExplorerItemMtime(current, targetId, Date.now()));
            a.setDirtyDesigns(d => updateDirtyDesigns(
                d, targetId, a.designsRef.current[targetId], savedSnapshot));
        },
        a.t.dialogs.saveAs.saveFailed,
    );
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
    const design = makeDefaultDesign(name);

    return a.persistChange(
        writeIfPossible(targetFolder.id, design),
        () => a.commitNewDesign(design, targetFolder),
    );
}

// A design the caller already built (a wizard's output, an import). Same path as
// `addDesign`, differing only in where the design came from.
function addDesignFrom(a, incoming, overrideFolder) {
    const targetFolder = overrideFolder || a.selectedFolder;
    if (!targetFolder || !incoming) return;
    const name   = uniqueDesignName(incoming.name, a.existingDesignNames(targetFolder.id), (b, k) => `${b} (${k})`);
    const design = name === incoming.name ? incoming : { ...incoming, name };

    return a.persistChange(
        writeIfPossible(targetFolder.id, design),
        () => a.commitNewDesign(design, targetFolder),
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
    const clone = copyDesignWithFreshIds(deepCopy(src), newName);
    return a.persistChange(
        writeIfPossible(folder.id, clone),
        () => a.commitNewDesign(clone, folder),
    );
}

// Save As refuses a name that is empty, or that is already a file in this
// folder: the name decides the filename, so the copy would land on it.
function saveAsValidator(sa, takenKeys) {
    return (nm) => {
        if (!nm?.trim()) return sa.empty;
        if (takenKeys.has(designFileKey(nm.trim()))) return sa.exists;
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
            const clone = copyDesignWithFreshIds(deepCopy(src), nm.trim());
            const saved = await a.persistChange(
                writeIfPossible(folder.id, clone),
                () => a.commitNewDesign(clone, folder),
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
    const oldName = item.name;
    const updated = { ...item, name: newName };
    return a.persistChange(
        window.electronAPI?.renameItem
            ? () => window.electronAPI.renameItem(folder.id, oldName, newName)
            : null,
        () => {
            a.setFolders(prev => prev.map(f => f.id === folderId
                ? { ...f, items: f.items.map(i => i.id === itemId ? updated : i) }
                : f));
            a.setSelectedItem(prev => (prev?.id === itemId ? updated : prev));
            renameInStore(a, itemId, newName);
        },
    );
}

export function useDesignActions({ store, tree, persistChange, setInputDialog, setMessageNotification, t }) {
    // Everything the operations above read: the design store, the project tree,
    // and the app's own notifications. Refreshed every render and read at call
    // time, so the actions never need rebuilding and never go stale.
    const a = useRef({});
    a.current = { ...store, ...tree, persistChange, setInputDialog, setMessageNotification, t };

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
        addItem:          useCallback((folder) => addDesign(a.current, folder), []),
        duplicateItem:    useCallback((item, folder) => duplicateDesign(a.current, item, folder), []),
        saveDesignAs:     useCallback(() => askSaveAs(a.current), []),
        renameItem:       useCallback((folderId, itemId, name) => renameDesign(a.current, folderId, itemId, name), []),
    };
}
