import {
  dropTargetFolders, explorerRows, filterExplorerFolders, folderDropTargets,
  folderSubtree, parentFolderId,
} from './projectExplorerModel.js';
import { ContextMenu } from '../ui/ContextMenu.js';

const { createElement: h, useState, useRef, useEffect, useCallback, useMemo } = React;

// Indent per level of nesting, in pixels: the width one row's text moves right
// relative to the row of the folder holding it.
const INDENT_STEP = 12;

// The drop target standing for the Projects root, so a folder dropped below the
// tree comes back up to the top level. Folder ids are paths and are never empty,
// so the empty string cannot collide with one.
const ROOT_TARGET = '';

// ── Icons ─────────────────────────────────────────────────────────────────────

function ChevronRight({ size = 16 }) {
  return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', style: { flexShrink: 0 } },
    h('path', { d: 'M6 4l4 4-4 4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
}

function ChevronDown({ size = 16 }) {
  return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', style: { flexShrink: 0 } },
    h('path', { d: 'M4 6l4 4 4-4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
}

function FolderIcon({ open, color }) {
  return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', style: { flexShrink: 0 } },
    open
      ? h('path', { d: 'M2 5a1 1 0 011-1h3.586a1 1 0 01.707.293L8 5H13a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1V5z', fill: color || '#dcb67a', opacity: 0.9 })
      : h('path', { d: 'M2 5a1 1 0 011-1h3.414a1 1 0 01.707.293L8 5H13a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1V5z', fill: color || '#dcb67a', opacity: 0.7 }));
}

function FileIcon({ color }) {
  return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', style: { flexShrink: 0 } },
    h('path', { d: 'M4 2h5.5L13 5.5V14H4V2z', fill: color || '#6fb3d2', opacity: 0.85 }),
    h('path', { d: 'M9 2v4h4', stroke: color || '#6fb3d2', strokeWidth: 1, fill: 'none', opacity: 0.6 }));
}

function IconBtn({ title, onClick, children, c }) {
  const [hov, setHov] = useState(false);
  return h('button', {
    title, 'aria-label': title, onClick,
    onMouseEnter: () => setHov(true),
    onMouseLeave: () => setHov(false),
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: 22, height: 22, border: 'none', borderRadius: 3, padding: 0,
      backgroundColor: hov ? c.hover : 'transparent',
      color: c.textDim, cursor: 'pointer', outline: 'none', flexShrink: 0
    }
  }, children);
}

function ExplorerSearch({ value, onChange, c, t }) {
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 5,
      margin: '6px 8px', padding: '0 6px', height: 26, flexShrink: 0,
      backgroundColor: c.field, border: `1px solid ${c.border}`,
      borderRadius: 4, color: c.textDim
    }
  },
    h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', style: { flexShrink: 0 } },
      h('circle', { cx: 7, cy: 7, r: 4, stroke: 'currentColor', strokeWidth: 1.3 }),
      h('path', { d: 'M10 10l3 3', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' })),
    h('input', {
      value,
      type: 'search',
      className: 'tfs-search',
      'aria-label': t.explorer.search,
      placeholder: t.explorer.searchPlaceholder,
      onChange: (event) => onChange(event.target.value),
      onKeyDown: (event) => { if (event.key === 'Escape') onChange(''); },
      style: {
        flex: 1, minWidth: 0, border: 'none', outline: 'none', padding: 0,
        backgroundColor: 'transparent', color: c.text, fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }
    }),
    value && h(IconBtn, { title: t.explorer.clearSearch, c, onClick: () => onChange('') },
      h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none' },
        h('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' })))
  );
}

// ── Inline rename input ────────────────────────────────────────────────────────

function RenameInput({ initialValue, onCommit, onCancel, c }) {
  const [val, setVal] = useState(initialValue);
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) { ref.current.focus(); ref.current.select(); }
  }, []);

  const commit = () => { const v = val.trim(); if (v && v !== initialValue) onCommit(v); else onCancel(); };

  return h('input', {
    ref,
    value: val,
    onChange: (e) => setVal(e.target.value),
    onKeyDown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      e.stopPropagation();
    },
    onBlur: commit,
    onClick: (e) => e.stopPropagation(),
    style: {
      flex: 1, minWidth: 0,
      backgroundColor: c.bg,
      color: c.text,
      border: `1px solid ${c.accent}`,
      borderRadius: 2,
      padding: '0 4px',
      fontSize: 13,
      height: 20,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      outline: 'none'
    }
  });
}

// ── Folder row ─────────────────────────────────────────────────────────────────

function FolderRow({ folder, depth, isSelected, isContextTarget, isDropTarget, c, onToggle, onSelect, onAddItem, onContextMenu, onStartRename, onCommitRename, onCancelRename, onDelete, onDragStart, onDragEnd, isRenaming, tipNewFile, tipRename, tipDelete }) {
  const [hov, setHov] = useState(false);

  return h('div', {
    onMouseEnter: () => setHov(true),
    onMouseLeave: () => setHov(false),
    style: { position: 'relative' }
  },
    h('div', {
      onClick: () => { onSelect(); onToggle?.(); },
      onContextMenu,
      // A row being renamed holds a text field, which needs its own selection.
      draggable: !isRenaming,
      onDragStart,
      onDragEnd,
      onKeyDown: (e) => {
        if (e.key === 'F2') { e.preventDefault(); onStartRename(); }
        if (e.key === 'Delete') { e.preventDefault(); onDelete(); }
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle?.(); }
      },
      tabIndex: 0,
      style: {
        display: 'flex', alignItems: 'center', gap: 2,
        height: 22, paddingLeft: 4 + depth * INDENT_STEP, paddingRight: 6,
        backgroundColor: isDropTarget ? c.accent + '30'
          : isSelected ? c.accent + '22' : hov ? c.hover : 'transparent',
        boxShadow: (isDropTarget || isContextTarget) ? `inset 0 0 0 1px ${c.accent}` : 'none',
        cursor: 'pointer', userSelect: 'none', outline: 'none'
      }
    },
      // chevron
      h('span', {
        style: { color: c.textDim, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
      }, folder.expanded ? h(ChevronDown, { size: 14 }) : h(ChevronRight, { size: 14 })),

      h(FolderIcon, { open: folder.expanded, color: c.iconFolder }),

      h('div', { style: { width: 4, flexShrink: 0 } }),

      // name or rename input
      isRenaming
        ? h(RenameInput, {
            initialValue: folder.name,
            onCommit: onCommitRename,
            onCancel: onCancelRename,
            c
          })
        : h('span', {
            style: {
              flex: 1, minWidth: 0, fontSize: 13, color: c.text,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }
          }, folder.name),

      // hover action buttons
      !isRenaming && hov && h('div', {
        onClick: (e) => e.stopPropagation(),
        style: { display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }
      },
        h(IconBtn, { title: tipNewFile, c, onClick: (e) => { e.stopPropagation(); onAddItem(); } },
          h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
            h('path', { d: 'M4 2h5.5L13 5.5V14H4V2z', stroke: 'currentColor', strokeWidth: 1.2, fill: 'none' }),
            h('path', { d: 'M8 8v4M6 10h4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }))),
        h(IconBtn, { title: tipRename, c, onClick: (e) => { e.stopPropagation(); onStartRename(); } },
          h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
            h('path', { d: 'M11 2l3 3-8 8H3v-3l8-8z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round', fill: 'none' }))),
        h(IconBtn, { title: tipDelete, c, onClick: (e) => { e.stopPropagation(); onDelete(); } },
          h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
            h('path', { d: 'M4 5h8M6 5V3h4v2M6 7v5M10 7v5M5 5l1 8h4l1-8', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', fill: 'none' })))
      )
    )
  );
}

// ── File row ───────────────────────────────────────────────────────────────────

function FileRow({ item, folder, depth, isSelected, isActive, isContextTarget, c, onClick, onDoubleClick, onContextMenu, onStartRename, onCommitRename, onCancelRename, onDelete, onDuplicate, onDragStart, onDragEnd, isRenaming, tipRename, tipDelete, tipDuplicate, tipUnsaved }) {
  const [hov, setHov] = useState(false);
  const bg = isSelected ? c.accent + '40'
    : isActive ? c.accent + '25'
    : hov ? c.hover
    : 'transparent';

  return h('div', {
    onMouseEnter: () => setHov(true),
    onMouseLeave: () => setHov(false),
    onClick,
    onDoubleClick,
    onContextMenu,
    // A row being renamed holds a text field, which needs its own selection.
    draggable: !isRenaming,
    onDragStart,
    onDragEnd,
    onKeyDown: (e) => {
      if (e.key === 'F2') { e.preventDefault(); onStartRename(); }
      if (e.key === 'Delete') { e.preventDefault(); onDelete(); }
      if (e.key === 'Enter') { e.preventDefault(); onDoubleClick && onDoubleClick(e); }
    },
    tabIndex: 0,
    style: {
      display: 'flex', alignItems: 'center', gap: 2,
      paddingLeft: 32 + depth * INDENT_STEP, paddingRight: 6, height: 22,
      backgroundColor: bg,
      cursor: 'pointer', userSelect: 'none', outline: 'none',
      // Right-clicked (context-target) rows get an inset focus ring, like
      // VS Code — visible without changing what's selected/open.
      boxShadow: isContextTarget ? `inset 0 0 0 1px ${c.accent}` : 'none',
      borderLeft: isSelected ? `2px solid ${c.accent}` : '2px solid transparent'
    }
  },
    h(FileIcon, { color: c.iconFile }),
    h('div', { style: { width: 4, flexShrink: 0 } }),

    isRenaming
      ? h(RenameInput, {
          initialValue: item.name,
          onCommit: onCommitRename,
          onCancel: onCancelRename,
          c
        })
      : h('span', {
          style: {
            flex: 1, minWidth: 0, fontSize: 13, color: c.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            display: 'flex', alignItems: 'center', gap: 4
          }
        },
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.name),
          item.isDirty && h('span', {
            title: tipUnsaved,
            style: { color: c.accent, fontSize: 10, flexShrink: 0, lineHeight: 1 }
          }, '●')
        ),

    !isRenaming && (hov || isActive || isSelected) && h('div', {
      onClick: (e) => e.stopPropagation(),
      style: { display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }
    },
      h(IconBtn, { title: tipDuplicate, c, onClick: (e) => { e.stopPropagation(); onDuplicate(); } },
        h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
          h('path', { d: 'M5 3h6.5L14 5.5V11H5V3z', stroke: 'currentColor', strokeWidth: 1.2, fill: 'none' }),
          h('path', { d: 'M2 5h1M2 5v8h8v-1', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', fill: 'none' }))),
      h(IconBtn, { title: tipRename, c, onClick: (e) => { e.stopPropagation(); onStartRename(); } },
        h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
          h('path', { d: 'M11 2l3 3-8 8H3v-3l8-8z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round', fill: 'none' }))),
      h(IconBtn, { title: tipDelete, c, onClick: (e) => { e.stopPropagation(); onDelete(); } },
        h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
          h('path', { d: 'M4 5h8M6 5V3h4v2M6 7v5M10 7v5M5 5l1 8h4l1-8', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', fill: 'none' })))
    )
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ProjectExplorer({
  folders, selectedFolder, selectedItem, selectedItems,
  handleItemClick, setSelectedFolder, toggleFolderExpanded,
  addItem, duplicateItem, removeSelectedItems, removeItem, setInputDialog, addFolder,
  renameFolder, renameItem, removeFolder, moveItemsToFolder, moveFolder,
  dirtyDesigns,
  c, t,
  onOpenDesign
}) {
  const [renamingKey, setRenamingKey] = useState(null); // 'folder-<id>' | 'item-<id>'
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, items: [...] } | null
  // Right-click target: the row gets a focus border (VS Code style) WITHOUT
  // becoming the selected/open design. { type:'item'|'folder', id } | null.
  const [contextTarget, setContextTarget] = useState(null);
  // What is being dragged, and the folders that would take it:
  // { kind: 'items', ids, targets } or { kind: 'folder', id, targets }. Held in
  // a ref rather than dataTransfer because dragover has to know what the drag
  // carries to decide whether a folder can take it, and the payload is
  // unreadable there.
  const dragRef = useRef(null);
  // The folder the pointer is over and would drop into; ROOT_TARGET for the top
  // level, null for nowhere.
  const [dropTargetId, setDropTargetId] = useState(null);
  const closeCtxMenu = useCallback(() => { setCtxMenu(null); setContextTarget(null); }, []);

  // ── Item sort (name / date), persisted so it survives restarts ─────────────
  const [sortMode, setSortMode] = useState(() => {
    try { return localStorage.getItem('tfstudio-explorer-sort') || 'name-asc'; } catch (_) { return 'name-asc'; }
  });
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const chooseSort = useCallback((mode) => {
    setSortMode(mode);
    try { localStorage.setItem('tfstudio-explorer-sort', mode); } catch (_) {}
    setSortMenuOpen(false);
  }, []);
  const SORT_OPTIONS = [
    ['name-asc',  t.explorer.sortNameAsc],
    ['name-desc', t.explorer.sortNameDesc],
    ['date-new',  t.explorer.sortDateNew],
    ['date-old',  t.explorer.sortDateOld],
  ];

  const startRename = useCallback((key) => setRenamingKey(key), []);
  const cancelRename = useCallback(() => setRenamingKey(null), []);

  const commitFolderRename = useCallback((folder, newName) => {
    if (newName !== folder.name) renameFolder(folder.id, newName);
    setRenamingKey(null);
  }, [renameFolder]);

  const commitItemRename = useCallback((item, folder, newName) => {
    if (newName !== item.name && renameItem) renameItem(folder.id, item.id, newName);
    setRenamingKey(null);
  }, [renameItem]);

  // What deleting a folder would take, in one walk: whether it can go at all
  // (the last folder standing cannot, the tree would have nowhere to put a new
  // design) and whether it takes subfolders with it, which the confirmation says.
  const folderDeletion = useCallback((folder) => {
    const subtree = folderSubtree(folders, folder.id);
    return { canDelete: subtree.length < folders.length, hasSubfolders: subtree.length > 1 };
  }, [folders]);

  const deleteFolder = useCallback((folder) => {
    const { canDelete, hasSubfolders } = folderDeletion(folder);
    if (!canDelete) return;
    const dp = t.dialogs.deleteProject;
    setInputDialog({
      confirm: true,
      danger: true,
      title: dp.title,
      message: hasSubfolders ? dp.messageWithFolders(folder.name) : dp.message(folder.name),
      confirmLabel: dp.confirm,
      onConfirm: () => {
        if (removeFolder) removeFolder(folder.id);
        setInputDialog(null);
      },
      onCancel: () => setInputDialog(null)
    });
  }, [folderDeletion, setInputDialog, removeFolder, t]);

  const deleteItem = useCallback((item, folder) => {
    const dd = t.dialogs.deleteDesign;
    setInputDialog({
      confirm: true,
      danger: true,
      title: dd.title,
      message: dd.message(item.name),
      confirmLabel: dd.confirm,
      onConfirm: () => {
        // Delete THIS item by id — not "whatever is selected". Routing through
        // selection deleted the active design and missed on the first click
        // (selection state hadn't updated yet).
        if (removeItem) removeItem(folder.id, item.id);
        else { handleItemClick(item, folder, {}); removeSelectedItems(); }
        setInputDialog(null);
      },
      onCancel: () => setInputDialog(null)
    });
  }, [removeItem, handleItemClick, removeSelectedItems, setInputDialog, t]);

  // Delete a multi-selection (≥2 items) with a single plural confirmation.
  const deleteItems = useCallback((targets) => {
    if (!targets || targets.length === 0) return;
    if (targets.length === 1) { return; } // single handled by deleteItem
    const dd = t.dialogs.deleteDesigns;
    setInputDialog({
      confirm: true,
      danger: true,
      title: dd.title,
      message: dd.message(targets.length),
      confirmLabel: dd.confirm,
      onConfirm: () => {
        // Pass the explicit set — don't rely on async selection state.
        if (removeSelectedItems) removeSelectedItems(targets.slice());
        setInputDialog(null);
      },
      onCancel: () => setInputDialog(null)
    });
  }, [removeSelectedItems, setInputDialog, t]);

  // ── Drag a design, or a folder, into another folder ────────────────────────
  // Dragging a row that is part of a multi-selection takes the whole selection,
  // matching what the context menu and Delete do with one.
  // What is dragged and the folders that would take it are both settled at
  // dragstart: dragover fires on every pointer move and the answer cannot
  // change while one drag is in flight.
  const startItemDrag = useCallback((event, item) => {
    const selected = (selectedItems || []).map(s => s.id);
    const ids = (selected.includes(item.id) && selected.length > 1) ? selected : [item.id];
    dragRef.current = {
      kind: 'items',
      ids,
      // A design lives in a folder, never at the Projects root, so the root is
      // not among its targets.
      targets: new Set(dropTargetFolders(folders, ids).map(f => f.id)),
    };
    event.dataTransfer.effectAllowed = 'move';
    // A drag carrying nothing is cancelled by the browser before any drop.
    event.dataTransfer.setData('text/plain', ids.join(','));
  }, [folders, selectedItems]);

  const startFolderDrag = useCallback((event, folder) => {
    const targets = new Set(folderDropTargets(folders, folder.id).map(f => f.id));
    if (parentFolderId(folder.id) !== null) targets.add(ROOT_TARGET);
    dragRef.current = { kind: 'folder', id: folder.id, targets };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', folder.id);
  }, [folders]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDropTargetId(null);
  }, []);

  // Rows are siblings, so the row under the pointer is the innermost thing
  // there and settles the target on its own. A row that cannot take the drag
  // clears the highlight rather than leaving the last one standing, and both
  // answers stop the event so the tree behind the rows does not also claim it.
  const dragOverTarget = useCallback((event, folderId) => {
    event.stopPropagation();
    if (!dragRef.current?.targets.has(folderId)) { setDropTargetId(null); return; }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetId(folderId);
  }, []);

  // The blank area below the rows. Only a folder can land there, and only one
  // that is not already at the top level; a design has to live in a folder.
  const dragOverRoot = useCallback((event) => {
    if (!dragRef.current?.targets.has(ROOT_TARGET)) { setDropTargetId(null); return; }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetId(ROOT_TARGET);
  }, []);

  const dropOnTarget = useCallback((event, folderId) => {
    event.preventDefault();
    event.stopPropagation();
    const drag = dragRef.current;
    dragRef.current = null;
    setDropTargetId(null);
    if (!drag?.targets.has(folderId)) return;
    if (drag.kind === 'folder') {
      if (moveFolder) moveFolder(drag.id, folderId === ROOT_TARGET ? null : folderId);
    } else if (drag.ids.length > 0 && moveItemsToFolder) {
      moveItemsToFolder(drag.ids, folderId);
    }
  }, [moveItemsToFolder, moveFolder]);

  const filteredFolders = useMemo(
    () => filterExplorerFolders(folders, searchQuery), [folders, searchQuery]);
  const isSearching = searchQuery.trim().length > 0;

  // Every row in the exact order the user sees it: subfolders before designs at
  // each level, both in the active sort, with collapsed folders left out.
  // Shift-range selection slices the design rows of THIS list.
  const rows = useMemo(
    () => explorerRows(filteredFolders, { sortMode, allExpanded: isSearching }),
    [filteredFolders, sortMode, isSearching]);
  const visibleItems = useMemo(
    () => rows.filter((row) => row.type === 'item').map((row) => row.item), [rows]);

  // ── Context-menu builders ───────────────────────────────────────────────────
  const Icons = {
    open:   h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' }, h('path', { d: 'M3 4h4l1 1h5v7H3V4z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' })),
    rename: h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' }, h('path', { d: 'M11 2l3 3-8 8H3v-3l8-8z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' })),
    dup:    h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' }, h('path', { d: 'M5 3h6.5L14 5.5V11H5V3z', stroke: 'currentColor', strokeWidth: 1.2 }), h('path', { d: 'M2 5h1M2 5v8h8v-1', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' })),
    del:    h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' }, h('path', { d: 'M4 5h8M6 5V3h4v2M6 7v5M10 7v5M5 5l1 8h4l1-8', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' })),
    newFile:h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' }, h('path', { d: 'M4 2h5.5L13 5.5V14H4V2z', stroke: 'currentColor', strokeWidth: 1.2 }), h('path', { d: 'M8 8v4M6 10h4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' })),
    newFolder: h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' }, h('path', { d: 'M2 5a1 1 0 011-1h3.414l.793.793A1 1 0 007.914 5H13a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1V5z', stroke: 'currentColor', strokeWidth: 1.2 }), h('path', { d: 'M8 7v4M6 9h4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' })),
    move:   h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' }, h('path', { d: 'M2 5a1 1 0 011-1h3.4l.8.8H13a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1V5z', stroke: 'currentColor', strokeWidth: 1.2 }), h('path', { d: 'M6 8.5h4M8.5 7l1.5 1.5-1.5 1.5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' })),
  };

  // "Move to <folder>" for every folder that would actually receive something.
  // ContextMenu is a flat list, so the folders sit in the menu itself. The list
  // is drawn from the folders on screen, so a search that hides a folder hides
  // it here too and the menu offers exactly what a drag could reach. A folder is
  // named by its path, since two folders under different parents can share a name.
  const moveMenuItems = useCallback((targets) => {
    const ids = targets.map(target => target.id);
    return (moveItemsToFolder ? dropTargetFolders(filteredFolders, ids) : []).map(folder => ({
      id: `move-${folder.id}`,
      label: targets.length > 1
        ? t.explorer.moveSelectedTo(targets.length, folder.id)
        : t.explorer.moveTo(folder.id),
      icon: Icons.move,
      onClick: () => moveItemsToFolder(ids, folder.id),
    }));
  }, [filteredFolders, moveItemsToFolder, t]);

  // Where a folder can go: any folder that is not itself, below it, or already
  // holding it, plus the top level when it is not there already.
  const folderMoveMenuItems = useCallback((folder) => {
    if (!moveFolder) return [];
    const items = folderDropTargets(filteredFolders, folder.id).map(target => ({
      id: `move-${target.id}`,
      label: t.explorer.moveTo(target.id),
      icon: Icons.move,
      onClick: () => moveFolder(folder.id, target.id),
    }));
    if (parentFolderId(folder.id) !== null) {
      items.unshift({
        id: 'move-root',
        label: t.explorer.moveToTop,
        icon: Icons.move,
        onClick: () => moveFolder(folder.id, null),
      });
    }
    return items;
  }, [filteredFolders, moveFolder, t]);

  const openItemMenu = useCallback((e, item, folder, targets) => {
    const many = targets.length > 1;
    const items = [];
    const moves = moveMenuItems(targets);
    if (!many) {
      items.push({ label: t.explorer.open, icon: Icons.open, onClick: () => onOpenDesign && onOpenDesign(item, folder) });
      items.push({ label: t.explorer.duplicate, icon: Icons.dup, onClick: () => duplicateItem && duplicateItem(item, folder) });
      items.push({ label: t.explorer.renameF2, icon: Icons.rename, onClick: () => startRename(`item-${item.id}`) });
      if (moves.length > 0) items.push({ separator: true }, ...moves);
      items.push({ separator: true });
      items.push({ label: t.explorer.delete, icon: Icons.del, danger: true, onClick: () => deleteItem(item, folder) });
    } else {
      if (moves.length > 0) items.push(...moves, { separator: true });
      items.push({ label: t.explorer.deleteSelected(targets.length), icon: Icons.del, danger: true, onClick: () => deleteItems(targets) });
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [t, onOpenDesign, duplicateItem, startRename, deleteItem, deleteItems, moveMenuItems]);

  const openFolderMenu = useCallback((e, folder) => {
    const moves = folderMoveMenuItems(folder);
    const items = [
      { label: t.explorer.newDesignFile, icon: Icons.newFile, onClick: () => addItem(folder) },
      { label: t.explorer.newSubfolder, icon: Icons.newFolder, onClick: () => addFolder(folder) },
      { separator: true },
      { label: t.dialogs.contextMenu.renameFolder, icon: Icons.rename, onClick: () => startRename(`folder-${folder.id}`) },
    ];
    if (moves.length > 0) items.push({ separator: true }, ...moves);
    items.push({ separator: true });
    items.push({ label: t.explorer.deleteFolder, icon: Icons.del, danger: true, disabled: !folderDeletion(folder).canDelete, onClick: () => deleteFolder(folder) });
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [t, addItem, addFolder, startRename, deleteFolder, folderDeletion, folderMoveMenuItems]);

  const openEmptyMenu = useCallback((e) => {
    const items = [
      { label: t.explorer.newDesignFile, icon: Icons.newFile, onClick: () => addItem() },
      { label: t.explorer.newProjectFolder, icon: Icons.newFolder, onClick: () => addFolder() },
    ];
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [t, addItem, addFolder]);

  // Resizable sidebar drag
  const startSidebarResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (e) => setSidebarWidth(Math.max(160, Math.min(500, startW + e.clientX - startX)));
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  const collapseAll = useCallback(() => {
    folders.forEach(f => { if (f.expanded) toggleFolderExpanded(f.id); });
  }, [folders, toggleFolderExpanded]);

  const newDesignInFolder = useCallback((folder) => {
    addItem(folder);
  }, [addItem]);

  if (isCollapsed) {
    return h('div', {
      'data-tour': 'explorer',
      style: {
        width: 30, minWidth: 30, display: 'flex', justifyContent: 'center',
        backgroundColor: c.panel, borderRight: `1px solid ${c.border}`
      }
    },
      h('div', { style: { paddingTop: 6 } },
        h(IconBtn, { title: t.explorer.showPanel, c, onClick: () => setIsCollapsed(false) },
          h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none' },
            h('path', { d: 'M3 2v12M6 4l4 4-4 4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }))))
    );
  }

  return h('div', {
    'data-tour': 'explorer',
    style: {
      width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth,
      display: 'flex', flexDirection: 'column',
      backgroundColor: c.panel, position: 'relative'
    }
  },
    // ── Header ──────────────────────────────────────────────────────────────
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 8px 0 12px', height: 35, flexShrink: 0,
        borderBottom: `1px solid ${c.border}`
      }
    },
      h('span', {
        style: {
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          color: c.textDim, textTransform: 'uppercase',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }
      }, t.explorer.title),
      h('div', { style: { display: 'flex', gap: 2, position: 'relative' } },
        // Sort dropdown — small, unobtrusive; opens a 4-option menu.
        h(IconBtn, { title: t.explorer.sortBy, c, onClick: () => setSortMenuOpen(o => !o) },
          h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none' },
            h('path', { d: 'M3 4h8M3 8h5M3 12h3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
            h('path', { d: 'M11.5 6.5L13 5l1.5 1.5M13 5v6', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
        sortMenuOpen && h('div', {
          onClick: () => setSortMenuOpen(false),
          style: { position: 'fixed', inset: 0, zIndex: 49 }
        }),
        sortMenuOpen && h('div', {
          style: {
            position: 'absolute', top: 26, right: 0, zIndex: 50,
            minWidth: 150, background: c.panel, border: `1px solid ${c.border}`,
            borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.35)', padding: '4px 0'
          }
        },
          SORT_OPTIONS.map(([mode, label]) =>
            h('div', {
              key: mode,
              onClick: (e) => { e.stopPropagation(); chooseSort(mode); },
              style: {
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', cursor: 'pointer', fontSize: 12,
                whiteSpace: 'nowrap',
                color: sortMode === mode ? c.text : c.textDim,
                background: sortMode === mode ? c.accent + '22' : 'transparent',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              },
              onMouseEnter: (e) => { if (sortMode !== mode) e.currentTarget.style.background = c.hover; },
              onMouseLeave: (e) => { if (sortMode !== mode) e.currentTarget.style.background = 'transparent'; }
            },
              h('span', { style: { width: 10, flexShrink: 0, color: c.accent } }, sortMode === mode ? '✓' : ''),
              label)
          )
        ),
        h(IconBtn, { title: t.explorer.newDesignFile, c, onClick: () => addItem() },
          h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none' },
            h('path', { d: 'M4 2h5.5L13 5.5V14H4V2z', stroke: 'currentColor', strokeWidth: 1.2, fill: 'none' }),
            h('path', { d: 'M8 8v4M6 10h4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }))),
        h(IconBtn, { title: t.explorer.newProjectFolder, c, onClick: () => addFolder() },
          h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none' },
            h('path', { d: 'M2 5a1 1 0 011-1h3.414l.793.793A1 1 0 007.914 5H13a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1V5z', stroke: 'currentColor', strokeWidth: 1.2, fill: 'none' }),
            h('path', { d: 'M8 7v4M6 9h4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }))),
        h(IconBtn, { title: t.explorer.collapseAll, c, onClick: collapseAll },
          h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none' },
            h('path', { d: 'M2 4h6M2 8h8M2 12h4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
            h('path', { d: 'M12 6l-3 3 3 3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
        h(IconBtn, { title: t.explorer.hidePanel, c, onClick: () => setIsCollapsed(true) },
          h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none' },
            h('path', { d: 'M13 2v12M10 4L6 8l4 4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' })))
      )
    ),

    h(ExplorerSearch, { value: searchQuery, onChange: setSearchQuery, c, t }),

    // ── Tree ────────────────────────────────────────────────────────────────
    // One flat list of rows, indented by depth. Every row takes a drop for the
    // folder it belongs to: its own for a folder row, the one holding it for a
    // design row. The innermost folder under the pointer is the one that
    // receives, and a design can still be let go anywhere among the designs
    // already in a folder. The blank area below the rows takes a folder and
    // puts it back at the top level.
    h('div', {
      onContextMenu: (e) => { e.preventDefault(); openEmptyMenu(e); },
      onDragOver: (e) => dragOverRoot(e),
      onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropTargetId(null); },
      onDrop: (e) => dropOnTarget(e, ROOT_TARGET),
      style: {
        flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingTop: 4, paddingBottom: 8,
        backgroundColor: dropTargetId === ROOT_TARGET ? c.accent + '14' : 'transparent',
      }
    },
      rows.map((row) => {
        const { folder, depth } = row;
        if (row.type === 'folder') {
          const folderKey = `folder-${folder.id}`;
          return h('div', {
            key: row.key,
            onDragOver: (e) => dragOverTarget(e, folder.id),
            onDrop: (e) => dropOnTarget(e, folder.id),
          },
            h(FolderRow, {
              folder,
              depth,
              isSelected: selectedFolder?.id === folder.id,
              isContextTarget: contextTarget?.type === 'folder' && contextTarget.id === folder.id,
              isDropTarget: dropTargetId === folder.id,
              c,
              onToggle: isSearching ? undefined : () => toggleFolderExpanded(folder.id),
              onSelect: () => setSelectedFolder(folder),
              onAddItem: () => newDesignInFolder(folder),
              onDelete: () => deleteFolder(folder),
              onContextMenu: (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Mark as the right-click target (border) but DON'T open it.
                setContextTarget({ type: 'folder', id: folder.id });
                openFolderMenu(e, folder);
              },
              isRenaming: renamingKey === folderKey,
              onStartRename: () => startRename(folderKey),
              onCommitRename: (newName) => commitFolderRename(folder, newName),
              onCancelRename: cancelRename,
              onDragStart: (e) => startFolderDrag(e, folder),
              onDragEnd: endDrag,
              tipNewFile: t.explorer.newDesignFile,
              tipRename: t.explorer.renameFolderF2,
              tipDelete: t.explorer.deleteFolder,
            })
          );
        }

        const { item } = row;
        const itemKey = `item-${item.id}`;
        const isDirty = !!(dirtyDesigns && dirtyDesigns[item.id]);
        return h('div', {
          key: row.key,
          onDragOver: (e) => dragOverTarget(e, folder.id),
          onDrop: (e) => dropOnTarget(e, folder.id),
        },
          h(FileRow, {
            item: { ...item, isDirty },
            folder,
            depth,
            isSelected: !!(selectedItems || []).find(s => s.id === item.id),
            isActive: selectedItem?.id === item.id,
            isContextTarget: contextTarget?.type === 'item' && contextTarget.id === item.id,
            c,
            onClick: (e) => { setSelectedFolder(folder); handleItemClick(item, folder, e, visibleItems); },
            onDoubleClick: () => onOpenDesign && onOpenDesign(item, folder),
            onContextMenu: (e) => {
              e.preventDefault();
              e.stopPropagation();
              const selIds = (selectedItems || []).map(s => s.id);
              const inSel = selIds.includes(item.id);
              // VS Code behaviour: right-click marks the row with a focus
              // border but does NOT select/open it (selecting an item makes it
              // the active design via a selectedItem effect). Context-menu
              // actions act on the explicit target below, not on selection.
              // If the row IS part of a ≥2 multi-selection, target that set so
              // "Delete N" still works.
              const targets = (inSel && selectedItems.length > 1) ? selectedItems.slice() : [item];
              setContextTarget({ type: 'item', id: item.id });
              openItemMenu(e, item, folder, targets);
            },
            isRenaming: renamingKey === itemKey,
            onStartRename: () => startRename(itemKey),
            onCommitRename: (newName) => commitItemRename(item, folder, newName),
            onCancelRename: cancelRename,
            onDelete: () => {
              const inSel = (selectedItems || []).some(s => s.id === item.id);
              if (inSel && selectedItems.length > 1) deleteItems(selectedItems.slice());
              else deleteItem(item, folder);
            },
            onDuplicate: () => duplicateItem && duplicateItem(item, folder),
            onDragStart: (e) => startItemDrag(e, item),
            onDragEnd: endDrag,
            tipRename: t.explorer.renameF2,
            tipDelete: t.explorer.delete,
            tipDuplicate: t.explorer.duplicate,
            tipUnsaved: t.explorer.unsavedChanges,
          })
        );
      }),

      isSearching && filteredFolders.length === 0 && h('div', {
        style: {
          padding: '24px 16px', color: c.textDim, fontSize: 12,
          textAlign: 'center', fontFamily: 'system-ui, -apple-system, sans-serif'
        }
      }, t.explorer.noSearchResults),

      // Empty state
      !isSearching && folders.every(f => (f.items || []).length === 0) && folders.length <= 1 && h('div', {
        style: {
          padding: '24px 16px', color: c.textDim, fontSize: 12,
          textAlign: 'center', lineHeight: 1.6,
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }
      },
        h('div', { style: { marginBottom: 8, opacity: 0.5 } }, '📄'),
        h('div', null, t.explorer.emptyState),
        h('div', { style: { marginTop: 4 } },
          h('span', {
            onClick: () => addItem(),
            style: { color: c.accent, cursor: 'pointer', textDecoration: 'underline' }
          }, t.explorer.emptyStateLink)
        )
      )
    ),

    // ── Context menu ──────────────────────────────────────────────────────────
    ctxMenu && h(ContextMenu, {
      x: ctxMenu.x, y: ctxMenu.y, items: ctxMenu.items, c, onClose: closeCtxMenu
    }),

    // ── Resize handle ────────────────────────────────────────────────────────
    h('div', {
      onMouseDown: startSidebarResize,
      style: {
        position: 'absolute', top: 0, right: 0, width: 4, bottom: 0,
        cursor: 'col-resize', zIndex: 10,
        backgroundColor: 'transparent',
        transition: 'background-color 0.15s'
      },
      onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = c.accent + '55'; },
      onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'transparent'; }
    })
  );
}
