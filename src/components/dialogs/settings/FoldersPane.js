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
//   Browse: choose → cancel aborts → confirm dialog → setUserPath → Moving… → success/inline error
//   Reset: confirm → resetUserPath → Moving… → success/inline error; disabled when already default
//   Open: revealUserPath()
//   unsaved-designs guard: both Browse and Reset pass through it first
//   inline states: rejected / error / warning / critical (no popup)
//   Moving… busy state: all buttons disabled
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
 * @param {Function} props.canChangeUserPath - unsaved-design guard (key param deprecated, checks root uniformly)
 * @param {Function} props.showConfirm - app-level confirm dialog (message) => Promise<boolean>
 */
export const FoldersPane = ({ c, t, onUserPathChanged, canChangeUserPath, showConfirm }) => {
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
    if (result.warning) {
      // success with warning (e.g. old folder still exists) — use a separate amber style
      setWarning(t.settings.folders.oldStillThere
        ? t.settings.folders.oldStillThere
        : result.warning);
    } else {
      setWarning(null);
    }
    // only call reload on success or warning (not on critical); await so the
    // busy state is not cleared until the reload completes
    await onUserPathChanged?.();
  }, [t, onUserPathChanged]);

  // ── Browse: choose → confirm → setUserPath → Moving… ──────────────────
  const onBrowse = useCallback(async () => {
    // unsaved-design guard
    if (canChangeUserPath && !canChangeUserPath()) {
      setError(t.settings.folders.projectsLocked);
      return;
    }

    try {
      // 1. choose — returns the chosen path only
      const chooseResult = await window.electronAPI?.chooseUserPath?.();
      if (!chooseResult || chooseResult.canceled || !chooseResult.path) return;

      // 2. app confirm dialog (prefer the injected showConfirm, fall back to window.confirm)
      const confirmFn = showConfirm || ((msg) => Promise.resolve(window.confirm(msg)));
      const confirmed = await confirmFn(
        t.settings.folders.confirmMove(chooseResult.path)
      );
      if (!confirmed) return;

      // 3. setUserPath → Moving…
      setMoving(true);
      setError(null);
      setWarning(null);
      try {
        const result = await window.electronAPI?.setUserPath?.(chooseResult.path);
        handleMoveResult(result);
      } finally {
        setMoving(false);
      }
    } catch (err) {
      setError(t.settings.folders.changeFailed(err?.message || ''));
      setMoving(false);
    }
  }, [canChangeUserPath, showConfirm, t, handleMoveResult]);

  // ── Reset: confirm → resetUserPath → Moving… ──────────────────────────
  const onReset = useCallback(async () => {
    // unsaved-design guard
    if (canChangeUserPath && !canChangeUserPath()) {
      setError(t.settings.folders.projectsLocked);
      return;
    }

    // no-op when already default
    if (isDefault) return;

    try {
      // confirm dialog
      const confirmFn2 = showConfirm || ((msg) => Promise.resolve(window.confirm(msg)));
      const defaultRoot = folders?.defaultRoot || '';
      const confirmed = await confirmFn2(
        t.settings.folders.confirmReset(defaultRoot)
      );
      if (!confirmed) return;

      // resetUserPath → Moving…
      setMoving(true);
      setError(null);
      setWarning(null);
      try {
        const result = await window.electronAPI?.resetUserPath?.();
        handleMoveResult(result);
      } finally {
        setMoving(false);
      }
    } catch (err) {
      setError(t.settings.folders.changeFailed(err?.message || ''));
      setMoving(false);
    }
  }, [isDefault, canChangeUserPath, showConfirm, folders, t, handleMoveResult]);

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
      subfolders: subfolders.map(sf => ({ ...sf, name: sf.key })),
      onOpen: onOpenSubfolder,
      moving,
      c, t,
    }),
  );
};
