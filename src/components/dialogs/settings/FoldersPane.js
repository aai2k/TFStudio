// Settings → Data Folder: single root directory + 9 read-only subdirectories.
//
// UI structure:
//   Data folder
//   /current/root
//   [Browse] [Reset] [Open]
//   default / rejected / error / warning / critical note
//   ---------------------
//   9 read-only subfolder paths (derived from paths:list's folders.subfolders)
//
// Interaction flow:
//   Browse: choose → cancel aborts → confirm dialog → Moving… → save unsaved → setUserPath → success/inline error
//   Reset: confirm → Moving… → save unsaved → resetUserPath → success/inline error; disabled when already default
//   Open: revealUserPath()
//   unsaved designs: the confirm says they are saved first; one that cannot be saved stops the move
//   inline states: rejected / error / warning / critical (no popup)
//   Moving… busy state (saving included): all buttons disabled
import { FolderRow } from './FolderRow.js';
import { SubfolderList } from './SubfolderList.js';
import { hintStyle, buttonStyle } from './ui.js';

const { createElement: h, useState, useEffect, useCallback, useRef } = React;

/**
 * Extract the current root path from the paths:list return structure.
 */
function getRootPath(listResult) {
  return listResult?.folders?.root || '';
}

/**
 * FoldersPane: single Data Folder settings panel.
 *
 * @param {object} props
 * @param {object} props.c - theme color object
 * @param {object} props.t - localized strings
 * @param {Function} props.onUserPathChanged - reload callback after a successful transaction
 * @param {Function} props.countUnsavedDesigns - () => number of designs with unsaved changes, read when called
 * @param {Function} props.saveUnsavedDesigns - saves them; () => Promise<string[]> of names not saved
 * @param {Function} props.showConfirm - app-level confirm dialog (message) => Promise<boolean>
 */
export const FoldersPane = ({ c, t, onUserPathChanged, countUnsavedDesigns, saveUnsavedDesigns, showConfirm }) => {
  const [folders, setFolders] = useState(null);     // full folders object returned by paths:list
  const [error, setError] = useState(null);          // move error / critical
  const [warning, setWarning] = useState(null);      // oldStillThere warning (yellow)
  const [moving, setMoving] = useState(false);       // Moving… busy state
  const errorRef = useRef(null);

  const refresh = useCallback(async () => {
    const result = await window.electronAPI?.listUserPaths?.();
    if (result?.success) {
      setFolders(result.folders);
      setError(null);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // whether in the default directory (overridden=false)
  const isDefault = !folders?.overridden;
  const rootPath = folders?.root || '';
  const subfolders = folders?.subfolders || [];
  const rejected = folders?.rejected || null;

  // ── move result handling: unify success/warning/error/critical ─────────
  const handleMoveResult = useCallback(async (result) => {
    if (!result) return;
    if (!result.success) {
      // critical special handling: show dataLocation + no auto reload
      if (result.critical) {
        setError(t.settings.folders.criticalError(result.dataLocation));
        // do not call onUserPathChanged on critical (design requirement)
      } else {
        setError(t.settings.folders.changeFailed(result.error || ''));
      }
      // even on failure, refresh folders to reflect the latest state
      if (result.folders) setFolders(result.folders);
      return;
    }
    // success
    setError(null);
    if (result.folders) setFolders(result.folders);
    // A move that succeeded but could not remove the old folder is still a
    // success; it is shown in the warning style rather than as an error.
    setWarning(result.warning ? t.settings.folders.oldStillThere : null);
    // Reload runs on success and on success-with-warning, never on critical.
    await onUserPathChanged?.();
  }, [t, onUserPathChanged]);

  // ── confirm → save the unsaved designs → move ─────────────────────────
  // The moved folder is reloaded without the unsaved copies, so they are
  // written to their files first. They are counted once the folder is chosen,
  // because a running optimizer can change a design while the chooser is open,
  // and the save runs whatever the count was. A design that cannot be saved
  // stops the move. The buttons stay disabled from the confirm to the end.
  const runMove = useCallback(async (message, move) => {
    try {
      // app confirm dialog (prefer the injected showConfirm, fall back to window.confirm)
      const confirmFn = showConfirm || ((msg) => Promise.resolve(window.confirm(msg)));
      const unsaved = countUnsavedDesigns();
      const confirmed = await confirmFn(unsaved
        ? t.settings.folders.unsavedSavedFirst(message, unsaved)
        : message);
      if (!confirmed) return;
      setMoving(true);
      setError(null);
      setWarning(null);
      const failed = await saveUnsavedDesigns();
      if (failed.length) {
        setError(t.settings.folders.notSaved(failed.join(', ')));
        return;
      }
      await handleMoveResult(await move());
    } catch (err) {
      setError(t.settings.folders.changeFailed(err?.message || ''));
    } finally {
      setMoving(false);
    }
  }, [showConfirm, countUnsavedDesigns, saveUnsavedDesigns, t, handleMoveResult]);

  // ── Browse: choose → runMove(setUserPath) ─────────────────────────────
  const onBrowse = useCallback(async () => {
    try {
      // choose — returns the chosen path only
      const chooseResult = await window.electronAPI?.chooseUserPath?.();
      if (!chooseResult || chooseResult.canceled || !chooseResult.path) return;
      await runMove(t.settings.folders.confirmMove(chooseResult.path),
        () => window.electronAPI?.setUserPath?.(chooseResult.path));
    } catch (err) {
      setError(t.settings.folders.changeFailed(err?.message || ''));
    }
  }, [runMove, t]);

  // ── Reset: runMove(resetUserPath); no-op when already default ─────────
  const onReset = useCallback(async () => {
    if (isDefault) return;
    await runMove(t.settings.folders.confirmReset(folders?.defaultRoot || ''),
      () => window.electronAPI?.resetUserPath?.());
  }, [isDefault, runMove, folders, t]);

  // ── Open: revealUserPath() ────────────────────────────────────────────
  const onOpen = useCallback(async () => {
    const result = await window.electronAPI?.revealUserPath?.();
    if (result && !result.success) setError(t.settings.folders.openFailed);
  }, [t]);

  // ── subdirectory row Open ─────────────────────────────────────────────
  const onOpenSubfolder = useCallback(async (key) => {
    const result = await window.electronAPI?.revealUserPath?.(key);
    if (result && !result.success) setError(t.settings.folders.openFailed);
  }, [t]);

  return h('div', null,
    // ── title ──
    h('span', { style: { ...hintStyle(c), marginTop: 0, marginBottom: '8px' } },
      t.settings.folders.hint),

    // ── inline states ──

    // rejected (configured root unusable)
    rejected && h('div', {
      role: 'status',
      style: {
        fontSize: '12px', color: c.warning, border: `1px solid ${c.warning}`,
        borderRadius: '6px', padding: '8px', marginBottom: '8px',
      },
    }, t.settings.folders.rejected(rejected.configured, rejected.reason)),

    // error (move error / critical) — red
    error && h('div', {
      role: 'alert',
      style: {
        fontSize: '12px', color: c.error, border: `1px solid ${c.error}`,
        borderRadius: '6px', padding: '8px', marginBottom: '8px',
      },
    }, error),

    // warning (oldStillThere) — amber/yellow
    warning && h('div', {
      role: 'status',
      style: {
        fontSize: '12px', color: c.warning || '#e0a030', border: `1px solid ${c.warning || '#e0a030'}`,
        borderRadius: '6px', padding: '8px', marginBottom: '8px',
      },
    }, warning),

    // Moving… busy state
    moving && h('div', {
      style: {
        fontSize: '12px', color: c.accent, padding: '8px', marginBottom: '8px',
      },
    }, t.settings.folders.moving),

    // ── Root path row ──
    rootPath && h(FolderRow, {
      entry: { key: 'root', path: rootPath, overridden: !isDefault },
      label: t.settings.folders.title,
      onBrowse: () => onBrowse(),
      onReset: () => onReset(),
      onOpen: () => onOpen(),
      moving,
      c, t,
    }),

    // ── read-only subdirectory list ──
    subfolders.length > 0 && h(SubfolderList, {
      subfolders,
      onOpen: onOpenSubfolder,
      moving,
      c, t,
    }),
  );
};
