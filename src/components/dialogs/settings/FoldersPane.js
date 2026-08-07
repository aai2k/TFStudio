// Settings → Folders: where TFStudio keeps designs, materials and presets.
//
// The list is owned by the main process (src/main/userPaths.js) and refreshed
// from the IPC result after every change, so a path that was rejected and fell
// back to its default is shown as the default rather than as what was asked for.
import { FolderRow } from './FolderRow.js';
import { hintStyle } from './ui.js';

const { createElement: h, useState, useEffect, useCallback } = React;

/**
 * Browse and Reset differ only in the IPC call they make, so both run through
 * one guarded path: refuse the change if the renderer cannot safely switch
 * root, apply the result, then let the renderer resync whatever the new
 * directory owns.
 */
function useFolderChange({ setFolders, setError, refresh, onUserPathChanged, canChangeUserPath, t }) {
  // A cancelled folder picker is not an error; anything else is reported inline.
  const apply = useCallback(async (key, result) => {
    if (!result || result.canceled) return;
    if (!result.success) {
      setError(t.settings.folders.changeFailed(result.error || ''));
      return;
    }
    setError(null);
    if (result.folders) setFolders(result.folders);
    else refresh();
    await onUserPathChanged?.(key);
  }, [refresh, setFolders, setError, t, onUserPathChanged]);

  return useCallback(async (key, invoke) => {
    if (canChangeUserPath && !canChangeUserPath(key)) {
      setError(t.settings.folders.projectsLocked);
      return;
    }
    try {
      await apply(key, await invoke(key));
    } catch (err) {
      setError(t.settings.folders.changeFailed(err?.message || ''));
    }
  }, [apply, canChangeUserPath, setError, t]);
}

export const FoldersPane = ({ c, t, onUserPathChanged, canChangeUserPath }) => {
  const [folders, setFolders] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const result = await window.electronAPI?.listUserPaths?.();
    if (result?.success) setFolders(result.folders);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const runChange = useFolderChange({
    setFolders, setError, refresh, onUserPathChanged, canChangeUserPath, t,
  });

  const onBrowse = useCallback(
    (key) => runChange(key, k => window.electronAPI?.chooseUserPath?.(k)), [runChange]);
  const onReset = useCallback(
    (key) => runChange(key, k => window.electronAPI?.resetUserPath?.(k)), [runChange]);

  const onOpen = useCallback(async (key) => {
    const result = await window.electronAPI?.revealUserPath?.(key);
    if (result && !result.success) setError(t.settings.folders.openFailed);
  }, [t]);

  return h('div', null,
    h('span', { style: { ...hintStyle(c), marginTop: 0, marginBottom: '8px' } },
      t.settings.folders.hint),
    error && h('div', {
      role: 'alert',
      style: {
        fontSize: '12px', color: c.error, border: `1px solid ${c.error}`,
        borderRadius: '6px', padding: '8px', marginBottom: '8px',
      },
    }, error),
    folders.map(entry =>
      h(FolderRow, { key: entry.key, entry, onBrowse, onReset, onOpen, c, t }))
  );
};
