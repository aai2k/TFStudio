// Settings → Folders: where TFStudio keeps designs, materials and presets.
//
// The list is owned by the main process (src/main/userPaths.js) and refreshed
// from the IPC result after every change, so a path that was rejected and fell
// back to its default is shown as the default rather than as what was asked for.
import { FolderRow } from './FolderRow.js';
import { hintStyle } from './ui.js';

const { createElement: h, useState, useEffect, useCallback } = React;

export const FoldersPane = ({ c, t, onUserPathChanged, canChangeUserPath }) => {
  const [folders, setFolders] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const result = await window.electronAPI?.listUserPaths?.();
    if (result?.success) setFolders(result.folders);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // A cancelled folder picker is not an error; anything else is reported inline.
  const apply = useCallback(async (key, result) => {
    if (!result || result.canceled) return;
    if (result.success) {
      setError(null);
      if (result.folders) setFolders(result.folders);
      else refresh();
      try {
        await onUserPathChanged?.(key);
      } catch (err) {
        setError(t.settings.folders.changeFailed(err?.message || ''));
      }
    } else {
      setError(t.settings.folders.changeFailed(result.error || ''));
    }
  }, [refresh, t, onUserPathChanged]);

  const allowChange = useCallback((key) => {
    if (!canChangeUserPath || canChangeUserPath(key)) return true;
    setError(t.explorer.unsavedChanges);
    return false;
  }, [canChangeUserPath, t]);

  const onBrowse = useCallback(async (key) => {
    if (!allowChange(key)) return;
    try {
      await apply(key, await window.electronAPI?.chooseUserPath?.(key));
    } catch (err) {
      setError(t.settings.folders.changeFailed(err?.message || ''));
    }
  }, [allowChange, apply, t]);

  const onReset = useCallback(async (key) => {
    if (!allowChange(key)) return;
    try {
      await apply(key, await window.electronAPI?.resetUserPath?.(key));
    } catch (err) {
      setError(t.settings.folders.changeFailed(err?.message || ''));
    }
  }, [allowChange, apply, t]);

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
