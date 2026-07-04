import {
  makeGroup, makeSplit, cleanup,
  addTab, removeTab, setSizes, setActiveTab,
  findNode, findFirstGroup, groupForTab,
  moveToGroup, moveToSplit, reorderTab, uid, newTabId, rekeyTree
} from './treeUtils.js';
import { SplitPane } from './SplitPane.js';
import { TabGroup } from './TabGroup.js';
import {
  WINDOW_REGISTRY, TOOL_CONFIGS, TOOL_LABELS, helpAnchorFor,
} from './windowRegistry.js';

// Re-export for any external consumer that historically imported these from here.
export { TOOL_CONFIGS, TOOL_LABELS, helpAnchorFor };

const { createElement: h, useState, useRef, useCallback, useEffect } = React;

// Tool configuration (titles, labels, help anchors) + the window component
// dispatch all live in ./windowRegistry.js now — TOOL_CONFIGS / TOOL_LABELS /
// helpAnchorFor are imported above.

// Node/tab id generators + restored-tree re-keying live in treeUtils.js (pure,
// unit-tested). `uid`, `newTabId`, `rekeyTree` are imported above.

// Find an open tab by its toolId → { groupId, idx } or null. Used by the
// focus-existing path so tutorials re-focus a tool instead of duplicating it.
function findTabByToolId(tree, toolId) {
  if (!tree) return null;
  if (tree.type === 'tabs') {
    const idx = tree.tabs.findIndex(t => t.toolId === toolId);
    return idx >= 0 ? { groupId: tree.id, idx } : null;
  }
  if (tree.children) for (const c of tree.children) { const r = findTabByToolId(c, toolId); if (r) return r; }
  return null;
}

// ── Zone → tree action ────────────────────────────────────────────────────────

function zoneToAction(zone) {
  switch (zone) {
    case 'center': return null; // handled separately
    case 'top':    return { direction: 'v', side: 'start' };
    case 'bottom': return { direction: 'v', side: 'end'   };
    case 'left':   return { direction: 'h', side: 'start' };
    case 'right':  return { direction: 'h', side: 'end'   };
    default:       return null;
  }
}

// ── Tool content — registry-driven dispatch ───────────────────────────────────
// Every window's component + prop contract lives in windowRegistry.js. The prop
// contract is preserved exactly: each window gets { c, t }; entries flagged
// `theme` also get `theme`; entries flagged `dialog` also get `setInputDialog`.
// An id with no component (modal/wizard/stub) falls through to the placeholder.

function ToolContent({ toolId, c, theme, t, setInputDialog }) {
  const entry = WINDOW_REGISTRY[toolId];
  if (entry && entry.component) {
    const props = { c, t };
    if (entry.theme)  props.theme = theme;
    if (entry.dialog) props.setInputDialog = setInputDialog;
    return h(entry.component, props);
  }

  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: c.textDim, fontSize: 13,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      textAlign: 'center', padding: 24
    }
  }, TOOL_LABELS[toolId] || toolId);
}

// ── Preset layouts ────────────────────────────────────────────────────────────

let _presetSeq = 100;
const presetId = () => `p${_presetSeq++}`;

function makePresetTree(toolIds) {
    // Build a horizontal split with one tab group per tool.
    // For 1 tool: single group. For 2+: split evenly.
    const groups = toolIds.map(id => ({
        type: 'tabs', id: presetId(),
        activeTab: 0,
        tabs: [{ id: presetId(), title: TOOL_CONFIGS[id]?.title || id, toolId: id }]
    }));
    if (groups.length === 1) return groups[0];
    // Make a balanced binary split
    const sizes = groups.map(() => 100 / groups.length);
    return { type: 'split', id: presetId(), direction: 'h', children: groups, sizes };
}

export const LAYOUT_PRESETS = {
    'filter-design': {
        label: 'Filter Design',
        description: 'Design Editor + Optical Evaluation',
        tools: ['design-editor', 'optical-eval']
    },
    'full-analysis': {
        label: 'Full Analysis',
        description: 'Design Editor + Evaluation + Admittance',
        tools: ['design-editor', 'optical-eval', 'admittance']
    },
    'synthesis': {
        label: 'Synthesis',
        description: 'Design Editor + Evaluation + Refinement',
        tools: ['design-editor', 'optical-eval', 'refinement']
    }
};

const LAYOUT_STORAGE_KEY = 'tfstudio-saved-layout';

export function saveLayout(tree) {
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(tree)); } catch {}
}

export function loadSavedLayout() {
    try {
        const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
        // Re-key on load so restored ids can't collide with this session's
        // freshly-generated ids (H7).
        return raw ? rekeyTree(JSON.parse(raw)) : null;
    } catch { return null; }
}

// ── DockingLayout ─────────────────────────────────────────────────────────────

export function DockingLayout({ c, theme, toolRequests, onWindowListChange, layoutRequest, t, setInputDialog, locale, ribbonStyle = 'colorful', onCreateProject }) {
  const [tree, setTree]               = useState(null);
  const [dragActive, setDragActive]   = useState(false);
  const [dragSrcGroupId, setDragSrcGroupId] = useState(null);

  const dropTargetRef  = useRef(null);  // { groupId, zone }
  const dragDataRef    = useRef(null);  // { tabId, fromGroupId, tab }
  const dragInsertRef  = useRef(null);  // { groupId, insertIdx } — same-group tab reorder
  const ghostRef       = useRef(null);  // DOM element
  const lastGroupRef   = useRef(null);  // last focused group id

  // ── Open tool ──────────────────────────────────────────────────────────────

  const openTool = useCallback((toolId, opts = {}) => {
    const cfg = TOOL_CONFIGS[toolId];
    if (!cfg) return;

    setTree(prev => {
      if (!prev) return makeGroup([{ id: newTabId(), title: cfg.title, toolId }]);

      // focusExisting: if this tool is already open, just activate that tab
      // (don't create a duplicate). Used by guided tutorials.
      if (opts.focusExisting) {
        const found = findTabByToolId(prev, toolId);
        if (found) {
          lastGroupRef.current = found.groupId;
          return setActiveTab(prev, found.groupId, found.idx);
        }
      }

      const tab = { id: newTabId(), title: cfg.title, toolId };
      // region:'left' forces the new tab into the FIRST (left-most) group —
      // tutorials dock new tools beside the Design Editor. Otherwise it lands in
      // the last-focused group (normal behaviour).
      let groupId = opts.region === 'left'
        ? (findFirstGroup(prev)?.id)
        : lastGroupRef.current;
      if (groupId && findNode(prev, groupId)) {
        lastGroupRef.current = groupId;
        return addTab(prev, groupId, tab);
      }
      const first = findFirstGroup(prev);
      return first ? addTab(prev, first.id, tab) : makeGroup([tab]);
    });
  }, []);

  useEffect(() => {
    if (!toolRequests?.length) return;
    const req = toolRequests[toolRequests.length - 1];
    openTool(req.toolId, { region: req.region, focusExisting: req.focusExisting });
  }, [toolRequests, openTool]);

  // ── Layout requests (presets / restore) ───────────────────────────────────
  useEffect(() => {
    if (!layoutRequest) return;
    if (layoutRequest.type === 'preset') {
      const preset = LAYOUT_PRESETS[layoutRequest.id];
      if (preset) setTree(makePresetTree(preset.tools));
    } else if (layoutRequest.type === 'restore') {
      const saved = loadSavedLayout();
      if (saved) setTree(saved);
    } else if (layoutRequest.type === 'save') {
      setTree(prev => { saveLayout(prev); return prev; });
    }
  }, [layoutRequest]);

  // Report the list of open tools to the parent whenever the tree changes.
  // WITHOUT this, the parent's `openWindowIds` stays [] forever, so its
  // "auto-arrange the default preset only when nothing is open" guard is always
  // satisfied → EVERY design switch re-applies the filter-design preset, which
  // rebuilds the tree with fresh node ids and REMOUNTS every window. That remount
  // is the OE-plot flicker (Plotly.newPlot clears then redraws; the Design Editor
  // has no canvas so it looks fine). Reporting the real list keeps the layout
  // stable across switches.
  useEffect(() => {
    if (!onWindowListChange) return;
    const ids = [];
    const collect = (n) => {
      if (!n) return;
      if (n.type === 'tabs') n.tabs.forEach(tab => ids.push(tab.toolId));
      else if (n.type === 'split') n.children.forEach(collect);
    };
    collect(tree);
    onWindowListChange(ids);
  }, [tree, onWindowListChange]);

  // ── Tab interactions ───────────────────────────────────────────────────────

  const handleTabClick = useCallback((groupId, idx) => {
    lastGroupRef.current = groupId;
    setTree(prev => setActiveTab(prev, groupId, idx));
  }, []);

  const handleTabClose = useCallback((tabId) => {
    setTree(prev => {
      const [t2] = removeTab(prev, tabId);
      return cleanup(t2);
    });
  }, []);

  const handleGroupFocus = useCallback((groupId) => {
    lastGroupRef.current = groupId;
  }, []);

  // ── Drag and drop ──────────────────────────────────────────────────────────

  const handleTabDragStart = useCallback((e, tab, fromGroupId) => {
    if (e.button !== 0) return;
    e.preventDefault();

    dragDataRef.current   = { tabId: tab.id, fromGroupId, tab };
    dragInsertRef.current = null;
    setDragSrcGroupId(fromGroupId);

    // Create ghost element
    const ghost = document.createElement('div');
    ghost.textContent = (t && t.windowTitles && t.windowTitles[tab.toolId]) || tab.title;
    Object.assign(ghost.style, {
      position:      'fixed',
      left:          e.clientX + 'px',
      top:           e.clientY + 'px',
      transform:     'translate(-50%, -50%)',
      padding:       '4px 14px',
      background:    c.panel,
      border:        `1px solid ${c.accent}`,
      borderRadius:  '4px',
      color:         c.text,
      fontSize:      '12px',
      pointerEvents: 'none',
      zIndex:        '99999',
      boxShadow:     '0 4px 14px rgba(0,0,0,0.5)',
      userSelect:    'none',
      fontFamily:    'system-ui, -apple-system, sans-serif',
      whiteSpace:    'nowrap'
    });
    document.body.appendChild(ghost);
    ghostRef.current = ghost;

    setDragActive(true);

    const onMove = (e) => {
      if (ghostRef.current) {
        ghostRef.current.style.left = e.clientX + 'px';
        ghostRef.current.style.top  = e.clientY + 'px';
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      // Remove ghost
      if (ghostRef.current) {
        document.body.removeChild(ghostRef.current);
        ghostRef.current = null;
      }

      const target = dropTargetRef.current;
      const insert = dragInsertRef.current;
      const { tabId, fromGroupId } = dragDataRef.current;

      if (insert && insert.groupId === fromGroupId) {
        // Same-group reorder: move tab to insertIdx position
        setTree(prev => {
          const group = groupForTab(prev, tabId);
          if (!group) return prev;
          const fromIdx = group.tabs.findIndex(t => t.id === tabId);
          if (fromIdx === -1) return prev;
          // insertIdx is "insert before this position"; adjust for removal
          let toIdx = insert.insertIdx > fromIdx ? insert.insertIdx - 1 : insert.insertIdx;
          if (toIdx === fromIdx) return prev;
          return reorderTab(prev, fromGroupId, fromIdx, toIdx);
        });
      } else if (target) {
        const { groupId, zone } = target;
        setTree(prev => {
          if (zone === 'center') {
            if (groupId === fromGroupId) return prev;
            return moveToGroup(prev, tabId, groupId);
          }
          const action = zoneToAction(zone);
          if (!action) return prev;
          const group = groupForTab(prev, tabId);
          if (group && group.id === groupId && group.tabs.length === 1) return prev;
          return moveToSplit(prev, tabId, groupId, action.direction, action.side);
        });
      }

      dragDataRef.current   = null;
      dropTargetRef.current = null;
      dragInsertRef.current = null;
      setDragSrcGroupId(null);
      setDragActive(false);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [c, t]);   // `t` is used for the ghost label — include it so a locale switch isn't stale

  // ── Recursive tree renderer ────────────────────────────────────────────────

  const renderNode = useCallback((node) => {
    if (!node) return null;

    if (node.type === 'split') {
      return h(SplitPane, {
        key:            node.id,
        node, c,
        onSizesChange:  (newSizes) => setTree(prev => setSizes(prev, node.id, newSizes))
      },
        ...node.children.map(renderNode)
      );
    }

    if (node.type === 'tabs') {
      return h(TabGroup, {
        key:             node.id,
        node, c,
        dragActive,
        dragSrcGroupId,
        dragInsertRef,
        dropTargetRef,
        onTabClick:      handleTabClick,
        onTabClose:      handleTabClose,
        onTabDragStart:  handleTabDragStart,
        onGroupFocus:    handleGroupFocus,
        renderContent:   (tab) => h(ToolContent, { toolId: tab.toolId, c, theme, t, setInputDialog }),
        helpAnchorFor,
        locale, t, ribbonStyle
      });
    }

    return null;
  }, [c, dragActive, dragSrcGroupId, handleTabClick, handleTabClose, handleTabDragStart, handleGroupFocus, t, locale, ribbonStyle]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return h('div', {
    'data-tour': 'docking',
    style: {
      flex: 1, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', backgroundColor: c.bg,
      position: 'relative'
    }
  },
    !tree
      ? h(EmptyWorkspace, { c, t, onCreateProject })
      : renderNode(tree)
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
// Shown at startup (no design opened) and whenever every window is closed. A
// single primary action — create a new project — which the renderer wires to
// "create + open a design + arrange the default layout". The user's other path
// is simply to pick an existing design in the Explorer.

function EmptyWorkspace({ c, t, onCreateProject }) {
  const e = (t && t.docking && t.docking.empty) || {};
  const [hov, setHov] = React.useState(false);

  return h('div', {
    style: {
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      color: c.textDim, gap: 14,
      fontFamily: 'system-ui, -apple-system, sans-serif', padding: 24, textAlign: 'center'
    }
  },
    h('div', { style: { fontSize: 52, opacity: 0.2 } }, '🔬'),
    h('div', { style: { fontSize: 16, fontWeight: 600, color: c.text, opacity: 0.6 } }, 'TFStudio'),
    h('div', { style: { fontSize: 12.5, opacity: 0.5, maxWidth: 360, lineHeight: 1.5 } },
      e.hint || 'Create a project to begin, or pick an existing design from the Explorer on the left.'),
    onCreateProject && h('button', {
      onClick: () => onCreateProject(),
      onMouseEnter: () => setHov(true),
      onMouseLeave: () => setHov(false),
      style: {
        marginTop: 6, padding: '9px 22px',
        backgroundColor: hov ? '#5ba0f2' : c.accent,
        color: '#fff', border: 'none', borderRadius: 7,
        cursor: 'pointer', fontSize: 13, fontWeight: 600,
        fontFamily: 'system-ui, -apple-system, sans-serif', outline: 'none',
        transition: 'background-color 0.12s'
      }
    }, e.createProject || 'Create project')
  );
}
