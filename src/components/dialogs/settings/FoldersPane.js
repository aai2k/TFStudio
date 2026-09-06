// Settings → Data Folder：单一根目录 + 9 行只读子目录（issue #75 收敛版，Phase E）。
//
// UI 结构（设计 §10.2）：
//   Data folder
//   /current/root
//   [Browse] [Reset] [Open]
//   default / rejected / error / warning / critical note
//   ---------------------
//   9 个 read-only subfolder paths（从 paths:list 的 folders.subfolders 派生）
//
// 交互流：
//   Browse：choose → 取消中止 → confirm dialog → setUserPath → Moving… → success/inline error
//   Reset：confirm → resetUserPath → Moving… → success/inline error；已 default 时 disabled
//   Open：revealUserPath()
//   unsaved-designs guard：Browse 与 Reset 都先过
//   inline 状态：rejected / error / warning / critical（不弹窗）
//   Moving… busy state：所有按钮 disabled
import { FolderRow } from './FolderRow.js';
import { SubfolderList } from './SubfolderList.js';
import { hintStyle, buttonStyle } from './ui.js';

const { createElement: h, useState, useEffect, useCallback, useRef } = React;

/**
 * 从 paths:list 返回结构中提取当前 root 路径。
 */
function getRootPath(listResult) {
  return listResult?.folders?.root || '';
}

/**
 * FoldersPane：单一 Data Folder 设置面板。
 *
 * @param {object} props
 * @param {object} props.c - 主题色对象
 * @param {object} props.t - 本地化字符串
 * @param {Function} props.onUserPathChanged - 事务成功后的 reload 回调
 * @param {Function} props.canChangeUserPath - 未保存设计守卫（key 参数已废弃，统一检查 root）
 * @param {Function} props.showConfirm - app 级确认对话框 (message) => Promise<boolean>
 */
export const FoldersPane = ({ c, t, onUserPathChanged, canChangeUserPath, showConfirm }) => {
  const [folders, setFolders] = useState(null);     // paths:list 返回的完整 folders 对象
  const [error, setError] = useState(null);          // move error / critical
  const [warning, setWarning] = useState(null);      // oldStillThere warning（黄色）
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

  // 是否处于默认目录（overridden=false）
  const isDefault = !folders?.overridden;
  const rootPath = folders?.root || '';
  const subfolders = folders?.subfolders || [];
  const rejected = folders?.rejected || null;

  // ── 移动结果处理：统一处理 success/warning/error/critical ──────────────
  const handleMoveResult = useCallback((result) => {
    if (!result) return;
    if (!result.success) {
      // critical 特殊处理：显示 dataLocation + 不自动 reload
      if (result.critical) {
        setError(
          t.settings.folders.criticalError
            ? t.settings.folders.criticalError(result.dataLocation)
            : `Critical: data is at ${result.dataLocation} but settings could not be saved.`
        );
        // critical 时不调 onUserPathChanged（设计要求）
      } else {
        setError(t.settings.folders.changeFailed(result.error || ''));
      }
      // 即使失败，也刷新 folders 以反映最新状态
      if (result.folders) setFolders(result.folders);
      return;
    }
    // success
    setError(null);
    if (result.folders) setFolders(result.folders);
    if (result.warning) {
      // 成功但有 warning（如 old folder still exists）—— 用独立 amber 样式
      setWarning(t.settings.folders.oldStillThere
        ? t.settings.folders.oldStillThere
        : result.warning);
    } else {
      setWarning(null);
    }
    // 只在成功或 warning 时调 reload（critical 不调）
    onUserPathChanged?.();
  }, [t, onUserPathChanged]);

  // ── Browse：choose → confirm → setUserPath → Moving… ──────────────────
  const onBrowse = useCallback(async () => {
    // 未保存设计守卫
    if (canChangeUserPath && !canChangeUserPath()) {
      setError(t.settings.folders.projectsLocked);
      return;
    }

    try {
      // 1. choose — 只返回选择路径
      const chooseResult = await window.electronAPI?.chooseUserPath?.();
      if (!chooseResult || chooseResult.canceled || !chooseResult.path) return;

      // 2. app confirm dialog（优先使用注入的 showConfirm，回退到 window.confirm）
      const confirmFn = showConfirm || ((msg) => Promise.resolve(window.confirm(msg)));
      const confirmed = await confirmFn(
        t.settings.folders.confirmMove?.(chooseResult.path) || `Move all data to ${chooseResult.path}?`
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

  // ── Reset：confirm → resetUserPath → Moving… ──────────────────────────
  const onReset = useCallback(async () => {
    // 未保存设计守卫
    if (canChangeUserPath && !canChangeUserPath()) {
      setError(t.settings.folders.projectsLocked);
      return;
    }

    // 已 default 时不操作
    if (isDefault) return;

    try {
      // confirm dialog
      const confirmFn2 = showConfirm || ((msg) => Promise.resolve(window.confirm(msg)));
      const defaultRoot = folders?.defaultRoot || '';
      const confirmed = await confirmFn2(
        t.settings.folders.confirmReset?.(defaultRoot) || `Reset to default location (${defaultRoot})?`
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

  // ── Open：revealUserPath() ────────────────────────────────────────────
  const onOpen = useCallback(async () => {
    const result = await window.electronAPI?.revealUserPath?.();
    if (result && !result.success) setError(t.settings.folders.openFailed);
  }, [t]);

  // ── 子目录行 Open ─────────────────────────────────────────────────────
  const onOpenSubfolder = useCallback(async (key) => {
    const result = await window.electronAPI?.revealUserPath?.(key);
    if (result && !result.success) setError(t.settings.folders.openFailed);
  }, [t]);

  return h('div', null,
    // ── 标题 ──
    h('span', { style: { ...hintStyle(c), marginTop: 0, marginBottom: '8px' } },
      t.settings.folders.hint),

    // ── inline 状态 ──

    // rejected（configured root 不可用）
    rejected && h('div', {
      role: 'status',
      style: {
        fontSize: '12px', color: c.warning, border: `1px solid ${c.warning}`,
        borderRadius: '6px', padding: '8px', marginBottom: '8px',
      },
    }, t.settings.folders.rejected(rejected.configured, rejected.reason)),

    // error（move error / critical）—— 红色
    error && h('div', {
      role: 'alert',
      style: {
        fontSize: '12px', color: c.error, border: `1px solid ${c.error}`,
        borderRadius: '6px', padding: '8px', marginBottom: '8px',
      },
    }, error),

    // warning（oldStillThere）—— amber/yellow
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
    }, t.settings.folders.moving || 'Moving data…'),

    // ── Root path 行 ──
    rootPath && h(FolderRow, {
      entry: { key: 'root', path: rootPath, overridden: !isDefault },
      label: t.settings.folders.title || 'Data folder',
      onBrowse: () => onBrowse(),
      onReset: () => onReset(),
      onOpen: () => onOpen(),
      moving,
      c, t,
    }),

    // ── 只读子目录列表 ──
    subfolders.length > 0 && h(SubfolderList, {
      subfolders: subfolders.map(sf => ({ ...sf, name: sf.key })),
      onOpen: onOpenSubfolder,
      moving,
      c, t,
    }),
  );
};
