/**
 * Designs that come from outside the project tree: a .tfs opened from the file
 * manager or from File ▸ Open, and designs read out of another coating
 * program's files.
 *
 * A design already inside the Projects tree is the design on disk, so it is
 * shown rather than copied. Anything else is imported as a copy under a fresh
 * id, and the file it came from is left untouched: every later save goes to the
 * copy.
 */

import { uniqueDesignName } from '../utils/io/designNaming.js';
import { copyDesignWithFreshIds } from '../utils/io/designFiles.js';
import { DEFAULT_DESIGN_IMPORT_UNITS } from '../utils/io/designImport/designFileImport.js';
import { designFileLocations } from '../components/panels/projectExplorerModel.js';

const { useState, useEffect, useRef, useCallback } = React;

// The id of the design as it now stands in the tree, or null if it could not be
// added.
async function importCopy(a, incoming, fileName) {
    const targetFolder = a.selectedFolder || a.foldersRef.current[0];
    if (!targetFolder) return null;

    const base = (incoming.name && String(incoming.name).trim()) || fileName || 'Imported design';
    const name = uniqueDesignName(base, a.existingDesignNames(targetFolder.id), (b, k) => `${b} (${k})`);
    const design = copyDesignWithFreshIds(incoming, name);

    if (!await a.addItemFromDesign(design, targetFolder)) return null;
    a.openTool('design-editor');
    return design.id;
}

/**
 * Show the design in the .tfs at `filePath`, as open-tfs-path and import-tfs
 * answer for it. The main process is handed where every row's file is, and
 * matches a file inside the Projects tree to its row by that: the row's own
 * file comes back with the row's id and is selected, and a file that is no
 * row's, put there after the tree was read, comes back with an id and a name
 * of its own and is added as a row; it is already where it belongs, so no save
 * follows. A repeat open of an outside file shows the copy already made
 * instead of making a second one.
 */
async function showOpened(a, res, filePath) {
    if (res?.canceled) return;
    if (!res?.success) {
        a.setMessageNotification({
            type: 'error',
            message: a.t.dialogs.openDesignFailed(res?.error || a.t.designImport.unknownError),
        });
        return;
    }
    // A folder that is on disk but not in the tree has nowhere to show the
    // design in place, so the design is imported like any other outside one.
    const folder = res.folderId && a.foldersRef.current.find(f => f.id === res.folderId);
    if (folder) {
        if (!a.selectDesignInTree(res.design.id)) a.commitNewDesign(res.design, folder, res.mtime);
        return;
    }
    // A folder whose name changed case on disk while the app runs is not in the
    // tree under that spelling. The main process keeps a row's id only for the
    // row's own file, so the id still finds it.
    if (res.folderId && a.selectDesignInTree(res.design.id)) return;
    // The web demo's picker names no path, so its imports are not remembered.
    const alreadyImported = filePath && a.openedFileDesignsRef.current.get(filePath);
    if (alreadyImported && a.selectDesignInTree(alreadyImported)) return;
    const designId = await importCopy(a, res.design, res.fileName);
    if (designId && filePath) a.openedFileDesignsRef.current.set(filePath, designId);
}

async function openFromFile(a) {
    if (!window.electronAPI?.importTfs) return;
    const res = await window.electronAPI.importTfs(designFileLocations(a.foldersRef.current));
    await showOpened(a, res, res?.filePath);
}

// A .tfs the file manager handed over.
async function openFromPath(a, filePath) {
    if (!filePath || !window.electronAPI?.openTfsPath) return;
    const res = await window.electronAPI.openTfsPath(filePath, designFileLocations(a.foldersRef.current));
    await showOpened(a, res, filePath);
}

// ── Import: designs from TFCalc / Essential Macleod files ────────────────────
// The main process shows the picker and returns the file texts; the dialog
// parses them and resolves the materials, and each ticked design is then
// re-keyed and added through the normal add path.
async function pickImportFiles(a) {
    if (!window.electronAPI?.importDesignFiles) return;
    const res = await window.electronAPI.importDesignFiles();
    if (!res || res.canceled) return;
    if (!res.success) {
        a.setMessageNotification({ type: 'error', message: a.t.designImport.error(res.error || a.t.designImport.unknownError) });
        return;
    }
    a.setDesignImport({ files: res.files, units: { ...DEFAULT_DESIGN_IMPORT_UNITS } });
}

// Names are made unique here, against the tree and against the batch: the
// folder list the add path checks is refreshed only after React commits, which
// is after the next design of the loop has already been named.
async function commitImport(a, designs, folderId) {
    a.setDesignImport(null);
    const targetFolder = a.foldersRef.current.find(f => f.id === folderId) || a.selectedFolder || a.foldersRef.current[0];
    if (!targetFolder) return;
    const taken = a.existingDesignNames(targetFolder.id);
    let added = 0;
    for (const imported of designs) {
        const name = uniqueDesignName(imported.name, taken, (b, k) => `${b} (${k})`);
        taken.push(name);
        if (await a.addItemFromDesign(copyDesignWithFreshIds(imported, name), targetFolder)) added++;
    }
    const failed = designs.length - added;
    if (failed) a.setMessageNotification({ type: 'error', message: a.t.designImport.importedPartly(added, failed) });
    else if (added) a.setMessageNotification({ type: 'success', message: a.t.designImport.imported(added) });
    if (added) a.openTool('design-editor');
}

export function useDesignImport({ tree, addItemFromDesign, openTool, setMessageNotification, t }) {
    // Design files picked for import from another coating program: { files, units }.
    const [designImport, setDesignImport] = useState(null);
    const openedFileDesignsRef = useRef(new Map());   // absolute path -> design id

    const a = useRef({});
    a.current = {
        ...tree, addItemFromDesign, openTool, setDesignImport,
        openedFileDesignsRef, setMessageNotification, t,
    };

    const openDesignFromPath = useCallback((filePath) => openFromPath(a.current, filePath), []);

    // Subscribed once the tree is in memory, because a design named on the
    // command line has to be found in it before it is imported as a copy.
    useEffect(() => {
        if (!tree.foldersLoaded) return;
        const unsubscribe = window.electronAPI?.onOpenFile?.(openDesignFromPath);
        window.electronAPI?.takePendingOpenFile?.().then(openDesignFromPath).catch(() => {});
        return unsubscribe;
    }, [tree.foldersLoaded, openDesignFromPath]);

    return {
        designImport, setDesignImport,
        openDesignFromFile:    useCallback(() => openFromFile(a.current), []),
        importDesignsFromFiles: useCallback(() => pickImportFiles(a.current), []),
        commitDesignImport:    useCallback((designs, folderId) => commitImport(a.current, designs, folderId), []),
    };
}
