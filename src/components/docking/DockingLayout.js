import {
  makeGroup, cleanup,
  addTab, removeTab, setSizes, setActiveTab,
  findNode, findFirstGroup, groupForTab,
  moveToGroup, moveToSplit, reorderTab, newTabId, rekeyTree, splitGroup,
} from './treeUtils.js';
import { SplitPane } from './SplitPane.js';
import { TabGroup } from './TabGroup.js';
import { FloatFrame } from './FloatFrame.js';
import { PopoutWindow, toScreenPoint, toClientPoint } from './PopoutWindow.js';
import { useDesign } from '../../state/DesignContext.js';
import { useUnresolvedMaterials } from '../../utils/materials/useUnresolvedMaterials.js';
import { ReplaceMaterialsDialog } from '../dialogs/ReplaceMaterialsDialog.js';
import {
  MaterialCalculationBlocked, MissingMaterialsBanner,
} from '../materials/MissingMaterialsNotice.js';
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
// `theme` also get `theme`; entries flagged `dialog` also get `setInputDialog`;
// entries flagged `createDesign` also get `onCreateDesign`.
// An id with no component (modal/wizard/stub) falls through to the placeholder.

export function ToolContent({ toolId, c, theme, t, setInputDialog, onCreateDesign,
  missingMaterialIds = [], onReplaceMaterials }) {
  const entry = WINDOW_REGISTRY[toolId];
  if (entry?.requiresResolvedMaterials && missingMaterialIds.length > 0) {
    return h(MaterialCalculationBlocked, {
      ids: missingMaterialIds, c, t, onRepair: onReplaceMaterials,
    });
  }
  if (entry && entry.component) {
    const props = { c, t };
    if (entry.theme)  props.theme = theme;
    if (entry.dialog) props.setInputDialog = setInputDialog;
    if (entry.createDesign) props.onCreateDesign = onCreateDesign;
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

// Whether a tool can be given a top-level OS window of its own. The desktop
// bridge says so outright; hosts that stand in for it, such as the browser
// demo, have only a popup to offer and leave the flag undefined. Asking for the
// bridge alone is not enough, since standing in for it is exactly what the
// browser demo's shim is for.
export function hasNativeWindows() {
    return typeof window !== 'undefined' && !!window.electronAPI?.nativeWindows;
}

// A saved layout is the docked tree plus the tools that were torn off, with the
// screen rectangle each one occupied. Layouts saved before tear-off existed are
// a bare tree, and still load.
export function saveLayout(tree, floats = []) {
    try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({
            version: 2,
            tree,
            floats: floats.map(f => ({ toolId: f.toolId, title: f.title, bounds: f.bounds })),
        }));
    } catch {}
}

// A window restored onto a monitor that is no longer attached would be
// unreachable, so a rectangle that does not overlap the screen we can see is
// pulled back onto it. The bounds are in CSS pixels, matching what
// `window.open` takes.
export function clampToScreen(bounds, screenInfo) {
    const s = screenInfo || {};
    const availLeft = Number.isFinite(s.availLeft) ? s.availLeft : 0;
    const availTop = Number.isFinite(s.availTop) ? s.availTop : 0;
    const availWidth = s.availWidth || 1280;
    const availHeight = s.availHeight || 800;

    const width = Math.max(320, Math.min(bounds?.width || 720, availWidth));
    const height = Math.max(240, Math.min(bounds?.height || 520, availHeight));
    const right = availLeft + availWidth;
    const bottom = availTop + availHeight;

    const left = Number.isFinite(bounds?.left) ? bounds.left : availLeft + 120;
    const top = Number.isFinite(bounds?.top) ? bounds.top : availTop + 120;

    // Since the size is already no bigger than the screen, pinning each edge
    // inside the available area is enough to bring back a window saved on a
    // monitor that is no longer attached, whichever side it was on.
    return {
        left: Math.min(Math.max(left, availLeft), right - width),
        top: Math.min(Math.max(top, availTop), bottom - height),
        width, height,
    };
}

export function loadSavedLayout() {
    try {
        const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
        if (!raw) return null;
        const saved = JSON.parse(raw);
        const isTree = saved && (saved.type === 'tabs' || saved.type === 'split');
        // Re-key on load so restored ids can't collide with this session's
        // freshly-generated ids (H7).
        let tree = rekeyTree(isTree ? saved : saved.tree);
        const floats = (isTree ? [] : saved.floats || []).map(f => ({
            id: newTabId(),
            toolId: f.toolId,
            title: f.title || TOOL_CONFIGS[f.toolId]?.title || f.toolId,
            bounds: clampToScreen(f.bounds, typeof screen !== 'undefined' ? screen : null),
        }));

        // A layout carrying torn-off tools can reach a host with no window to
        // put them in. They are docked rather than dropped, so restoring keeps
        // every tool the layout was saved with.
        if (floats.length && !hasNativeWindows()) {
            for (const f of floats) {
                const group = tree && findFirstGroup(tree);
                const tab = { id: f.id, toolId: f.toolId, title: f.title };
                tree = group ? addTab(tree, group.id, tab) : makeGroup([tab]);
            }
            return { tree, floats: [] };
        }
        return { tree, floats };
    } catch { return null; }
}

// ── Drag preview ──────────────────────────────────────────────────────────────
//
// Dragging a tab drags the window, so the thing under the cursor is shaped like
// the window: the same proportions as the pane it came from, its title strip and
// window buttons, and a dimmed body. A name chip on its own gave no sense of
// what was about to be moved or where it would end up.

const PREVIEW_MAX_W = 340;
const PREVIEW_MAX_H = 250;

export function previewSize(sourceRect) {
    const w = sourceRect?.width || 720;
    const h = sourceRect?.height || 520;
    const scale = Math.min(PREVIEW_MAX_W / w, PREVIEW_MAX_H / h, 1);
    return {
        width: Math.max(200, Math.round(w * scale)),
        height: Math.max(130, Math.round(h * scale)),
    };
}

function makeDragPreview({ c, title, sourceRect }) {
    const { width, height } = previewSize(sourceRect);
    const el = document.createElement('div');
    Object.assign(el.style, {
        position: 'fixed', width: `${width}px`, height: `${height}px`,
        // Held near the title strip, the way a window is held by its title bar.
        transform: 'translate(-38px, -12px)',
        background: c.panel,
        border: `1px solid ${c.accent}`,
        borderRadius: '4px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
        opacity: '0.9', pointerEvents: 'none', overflow: 'hidden',
        zIndex: '99999', userSelect: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    const strip = document.createElement('div');
    Object.assign(strip.style, {
        display: 'flex', alignItems: 'center', height: '24px',
        padding: '0 8px', background: c.bg,
        borderBottom: `1px solid ${c.border}`,
        color: c.text, fontSize: '11px',
    });
    const name = document.createElement('span');
    name.textContent = title;
    Object.assign(name.style, {
        flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    });
    const buttons = document.createElement('span');
    buttons.textContent = '– □ ×';
    Object.assign(buttons.style, { color: c.textDim, fontSize: '10px', letterSpacing: '2px' });
    strip.append(name, buttons);

    const body = document.createElement('div');
    Object.assign(body.style, { flex: '1', height: `${height - 24}px`, background: c.panel });

    el.append(strip, body);
    return el;
}

// Start the preview and hand back the two things a drag does with it.
//
// In the app it is a window of its own, because an element cannot be painted
// outside the window that owns it: as a `<div>` the preview was cut off at the
// frame edge, which is precisely where a tear-off is aimed. The browser build
// has no windows to give it and no desktop to drop it on, so there it stays an
// element and the viewport is the whole world anyway.
export function startDragPreview({ c, title, sourceRect, clientX, clientY }) {
    const { width, height } = previewSize(sourceRect);
    const bridge = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.dragGhost;

    if (bridge) {
        bridge.show({
            ...toScreenPoint(window, clientX, clientY), width, height, title,
            // Where the pane sits in the page, so the preview can be given a
            // picture of it and carry the window's contents rather than a blank
            // box with its name on it.
            pane: sourceRect && {
                x: sourceRect.left, y: sourceRect.top,
                width: sourceRect.width, height: sourceRect.height,
            },
            panel: c.panel, bg: c.bg, border: c.border,
            accent: c.accent, text: c.text, textDim: c.textDim,
        });
        return {
            move: (x, y) => bridge.move(toScreenPoint(window, x, y)),
            end: () => bridge.hide(),
        };
    }

    const el = makeDragPreview({ c, title, sourceRect });
    el.style.left = `${clientX}px`;
    el.style.top = `${clientY}px`;
    document.body.appendChild(el);
    return {
        move: (x, y) => { el.style.left = `${x}px`; el.style.top = `${y}px`; },
        end: () => { if (el.parentNode) el.parentNode.removeChild(el); },
    };
}

// ── DockingLayout ─────────────────────────────────────────────────────────────

export function DockingLayout({ c, theme, toolRequests, onWindowListChange, layoutRequest, t, setInputDialog, locale, ribbonStyle = 'colorful', onCreateProject, onCreateDesign }) {
  const { design, updateDesign } = useDesign();
  const missingMaterialIds = useUnresolvedMaterials(design);
  const [tree, setTree]               = useState(null);
  const [floats, setFloats]           = useState([]);   // torn-off tools, one OS window each
  const [dragActive, setDragActive]   = useState(false);
  const [dragSrcGroupId, setDragSrcGroupId] = useState(null);
  const [forcedZone, setForcedZone]   = useState(null); // zone lit by a drag from a float
  const [replaceMaterialsOpen, setReplaceMaterialsOpen] = useState(false);

  const dropTargetRef  = useRef(null);  // { groupId, zone }
  const dragDataRef    = useRef(null);  // { tabId, fromGroupId, tab }
  const dragInsertRef  = useRef(null);  // { groupId, insertIdx } — same-group tab reorder
  const ghostRef       = useRef(null);  // live drag preview, between down and up
  const lastGroupRef   = useRef(null);  // last focused group id
  const floatWinsRef   = useRef(new Map()); // floatId → its OS window, for live bounds

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
      if (preset) { setTree(makePresetTree(preset.tools)); setFloats([]); }
    } else if (layoutRequest.type === 'restore') {
      const saved = loadSavedLayout();
      if (saved) { setTree(saved.tree); setFloats(saved.floats); }
    } else if (layoutRequest.type === 'save') {
      setTree(prev => { saveLayout(prev, floatsWithBounds()); return prev; });
    }
    // `floatsWithBounds` reads a ref, so the effect does not need floats as a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutRequest]);

  // Report the list of open tools to the parent whenever the tree changes.
  // WITHOUT this, the parent's `openWindowIds` stays [] forever, so its
  // "auto-arrange the default preset only when nothing is open" guard is always
  // satisfied → EVERY design switch re-applies the filter-design preset, which
  // rebuilds the tree with fresh node ids and REMOUNTS every window. That remount
  // is the OE-plot flicker (the chart clears then redraws; the Design Editor
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
    // Torn-off tools are still open, so they belong on this list too. Leaving
    // them off would let the parent believe the workspace is empty and re-apply
    // a preset over a layout the user is using.
    floats.forEach(f => ids.push(f.toolId));
    onWindowListChange(ids);
  }, [tree, floats, onWindowListChange]);

  // ── Torn-off windows ───────────────────────────────────────────────────────

  const floatsRef = useRef([]);
  useEffect(() => { floatsRef.current = floats; }, [floats]);

  // The user can move and resize a float once it is open, so the rectangle we
  // save has to be read off the live window, not from where it was created.
  const floatsWithBounds = useCallback(() => floatsRef.current.map(f => {
    const win = floatWinsRef.current.get(f.id);
    if (!win || win.closed) return f;
    return {
      ...f,
      bounds: { left: win.screenX, top: win.screenY, width: win.innerWidth, height: win.innerHeight },
    };
  }), []);

  // Which drop zone sits under a point in this window's client coordinates.
  // Reads the zone overlays TabGroup renders, so a drag arriving from a float
  // resolves to exactly the target an in-window drag would.
  const zoneAt = useCallback((x, y) => {
    const el = document.elementFromPoint(x, y);
    const zone = el && el.closest && el.closest('[data-dockzone]');
    if (!zone) return null;
    return { groupId: zone.getAttribute('data-dockgroup'), zone: zone.getAttribute('data-dockzone') };
  }, []);

  // Put a tab into the tree at a drop target. Center joins the group; an edge
  // splits it.
  const placeTab = useCallback((prev, tab, target) => {
    if (!prev) return makeGroup([tab]);
    if (!findNode(prev, target.groupId)) {
      const first = findFirstGroup(prev);
      return first ? addTab(prev, first.id, tab) : makeGroup([tab]);
    }
    if (target.zone === 'center') return addTab(prev, target.groupId, tab);
    const action = zoneToAction(target.zone);
    if (!action) return addTab(prev, target.groupId, tab);
    return splitGroup(prev, target.groupId, action.direction, action.side, tab);
  }, []);

  // A tab dropped on nothing leaves the layout and becomes its own OS window,
  // opened where the pointer let go and at the size the pane had, so it lands
  // looking like the preview that was under the cursor.
  const tearOff = useCallback((tab, screenPoint, sourceRect) => {
    setTree(prev => {
      const [detached] = removeTab(prev, tab.id);
      return cleanup(detached);
    });
    setFloats(prev => [...prev, {
      id: tab.id,
      toolId: tab.toolId,
      title: tab.title,
      bounds: clampToScreen({
        left: screenPoint.x - 38,
        top: screenPoint.y - 12,
        width: Math.round(sourceRect?.width || 720),
        height: Math.round(sourceRect?.height || 520),
      }, typeof screen !== 'undefined' ? screen : null),
    }]);
  }, []);

  const closeFloat = useCallback((floatId) => {
    floatWinsRef.current.delete(floatId);
    setFloats(prev => prev.filter(f => f.id !== floatId));
  }, []);

  // Return a float to the layout, at `target` if a drag chose one, otherwise
  // wherever a freshly-opened tool would land.
  const dockFloat = useCallback((floatId, target) => {
    const float = floatsRef.current.find(f => f.id === floatId);
    if (!float) return;
    const tab = { id: newTabId(), title: float.title, toolId: float.toolId };
    setTree(prev => {
      if (target) return placeTab(prev, tab, target);
      if (!prev) return makeGroup([tab]);
      const groupId = lastGroupRef.current && findNode(prev, lastGroupRef.current)
        ? lastGroupRef.current
        : findFirstGroup(prev)?.id;
      return groupId ? addTab(prev, groupId, tab) : makeGroup([tab]);
    });
    closeFloat(floatId);
  }, [placeTab, closeFloat]);

  // Dragging a float's title bar over the layout docks it. The float moves
  // itself rather than being moved by the OS, so its mouse events are readable
  // here and the drop targets can light up as it passes over them; the pointer's
  // screen position is what crosses between the two windows.
  const zoneUnder = useCallback((screenPoint) => {
    const local = screenPoint && toClientPoint(window, screenPoint.x, screenPoint.y);
    return local ? zoneAt(local.x, local.y) : null;
  }, [zoneAt]);

  const handleFloatDragOver = useCallback((screenPoint) => {
    setDragActive(true);
    setForcedZone(zoneUnder(screenPoint));
  }, [zoneUnder]);

  const handleFloatDrop = useCallback((floatId, screenPoint) => {
    const target = zoneUnder(screenPoint);
    setForcedZone(null);
    setDragActive(false);
    if (target) dockFloat(floatId, target);
  }, [zoneUnder, dockFloat]);

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

    const sourceRect = document
      .querySelector(`[data-dockgroup-root="${fromGroupId}"]`)
      ?.getBoundingClientRect();

    dragDataRef.current   = { tabId: tab.id, fromGroupId, tab, sourceRect };
    dragInsertRef.current = null;
    setDragSrcGroupId(fromGroupId);

    ghostRef.current = startDragPreview({
      c,
      title: (t && t.windowTitles && t.windowTitles[tab.toolId]) || tab.title,
      sourceRect,
      clientX: e.clientX,
      clientY: e.clientY,
    });

    setDragActive(true);

    const onMove = (e) => {
      if (ghostRef.current) ghostRef.current.move(e.clientX, e.clientY);
    };

    const onUp = (ue) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      if (ghostRef.current) {
        ghostRef.current.end();
        ghostRef.current = null;
      }

      const target = dropTargetRef.current;
      const insert = dragInsertRef.current;
      const { tabId, fromGroupId, tab: draggedTab, sourceRect } = dragDataRef.current;

      // Let go anywhere that is not a drop target and the tool leaves the layout
      // for a window of its own: over the explorer, over the ribbon, or off the
      // frame entirely. Chromium keeps delivering the drag's mouse events to
      // this document after the pointer crosses the frame, so a drop on the
      // desktop arrives here too, with client coordinates outside the viewport.
      const missed = !target && !insert;

      if (missed) {
        // Tearing off needs a real OS window, and the browser build has none to
        // give: window.open there makes a popup the blocker may eat, and the
        // tab has already left the tree, so the tool would vanish with it. In
        // the browser a drop on nothing leaves the tab where it was.
        if (hasNativeWindows()) {
          tearOff(draggedTab, toScreenPoint(window, ue?.clientX ?? 0, ue?.clientY ?? 0), sourceRect);
        }
      } else if (insert && insert.groupId === fromGroupId) {
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
  }, [c, t, tearOff]);   // `t` is used for the ghost label — include it so a locale switch isn't stale

  // The preview outlives this component if the layout goes away mid-drag, and
  // it is an always-on-top window: it would sit over everything with nothing
  // left to dismiss it.
  useEffect(() => () => {
    if (ghostRef.current) { ghostRef.current.end(); ghostRef.current = null; }
  }, []);

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
        forcedZone,
        onTabClick:      handleTabClick,
        onTabClose:      handleTabClose,
        onTabDragStart:  handleTabDragStart,
        onGroupFocus:    handleGroupFocus,
        renderContent:   (tab) => h(ToolContent, {
          toolId: tab.toolId, c, theme, t, setInputDialog, onCreateDesign,
          missingMaterialIds,
          onReplaceMaterials: () => setReplaceMaterialsOpen(true),
        }),
        helpAnchorFor,
        locale, t, ribbonStyle
      });
    }

    return null;
  }, [c, dragActive, dragSrcGroupId, forcedZone, handleTabClick, handleTabClose, handleTabDragStart,
    handleGroupFocus, t, locale, ribbonStyle, missingMaterialIds, onCreateDesign]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return h('div', {
    'data-tour': 'docking',
    style: {
      flex: 1, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', backgroundColor: c.bg,
      position: 'relative'
    }
  },
    h(MissingMaterialsBanner, {
      ids: missingMaterialIds, c, t,
      onRepair: () => setReplaceMaterialsOpen(true),
    }),
    // Nothing docked, whether or not tools are floating: tearing the last window
    // out used to leave the workspace blank, with no pane and so no compass, and
    // that window could then only be brought back from its dock button.
    !tree
      ? h(EmptyWorkspace, { c, t, onCreateProject })
      : renderNode(tree),
    !tree && dragActive && h(EmptyDropTarget, {
      c, t, lit: !!(forcedZone && forcedZone.zone === 'center'),
    }),
    replaceMaterialsOpen && h(ReplaceMaterialsDialog, {
      design, updateDesign, c, t, onClose: () => setReplaceMaterialsOpen(false),
    }),

    // Torn-off tools. Each is a real OS window, but it renders here inside the
    // same React tree, so the design and the run state behind it are the ones
    // the docked windows are using.
    floats.map(f => h(PopoutWindow, {
      key: f.id,
      id: f.id,
      title: (t && t.windowTitles && t.windowTitles[f.toolId]) || f.title,
      bounds: f.bounds,
      background: c.panel,
      onClose: () => closeFloat(f.id),
      onWindowReady: (win) => floatWinsRef.current.set(f.id, win),
    },
      (win) => h(FloatFrame, {
        c, t, locale, ribbonStyle, win,
        toolId: f.toolId,
        title: (t && t.windowTitles && t.windowTitles[f.toolId]) || f.title,
        helpAnchor: helpAnchorFor(f.toolId),
        onDock: () => dockFloat(f.id, null),
        onClose: () => closeFloat(f.id),
        onDragOver: handleFloatDragOver,
        onDrop: (screenPoint) => handleFloatDrop(f.id, screenPoint),
      },
        h(ToolContent, {
          toolId: f.toolId, c, theme, t, setInputDialog, onCreateDesign,
          missingMaterialIds,
          onReplaceMaterials: () => setReplaceMaterialsOpen(true),
        })
      )
    ))
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
// Shown at startup (no design opened) and whenever every window is closed. A
// single primary action — create a new project — which the renderer wires to
// "create + open a design + arrange the default layout". The user's other path
// is simply to pick an existing design in the Explorer.

// The drop target for an empty workspace. There is no pane to aim at and only
// one place the window can go, so the whole area is the target rather than the
// five-way compass a populated pane offers.
export function EmptyDropTarget({ c, t, lit }) {
  // One centred button in the compass's style, not the whole area: covering the
  // workspace meant a float could not be left hovering over the empty window,
  // since anywhere the user let go of it docked it. Letting go anywhere but the
  // button leaves the window floating.
  return h('div', {
    style: {
      position: 'absolute', inset: 0, zIndex: 200,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 10,
      pointerEvents: 'none',
    }
  },
    // Where the tool would land, shaded the way a compass preview is.
    lit && h('div', {
      style: {
        position: 'absolute', inset: 12,
        backgroundColor: c.accent + '33',
        border: `1px solid ${c.accent}`,
        boxSizing: 'border-box', pointerEvents: 'none',
      }
    }),
    h('div', {
      'data-dockzone': 'center',
      title: (t && t.docking && t.docking.dropHere) || 'Drop to dock',
      style: {
        width: 48, height: 48,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: lit ? c.accent : c.panel,
        border: `1px solid ${lit ? c.accent : c.border}`,
        borderRadius: 4,
        color: lit ? '#fff' : c.textDim,
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        boxSizing: 'border-box', pointerEvents: 'all',
      }
    },
      // The compass centre's glyph: a tab joining the group it is dropped on.
      h('svg', { width: 27, height: 27, viewBox: '0 0 21 21', fill: 'none' },
        h('rect', { x: 3.5, y: 4.5, width: 14, height: 12, rx: 1, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { d: 'M3.5 8.5h14M11 4.5v4', stroke: 'currentColor', strokeWidth: 1.4 }))),
    h('span', { style: { fontSize: 12, color: c.textDim } },
      (t && t.docking && t.docking.dropHere) || 'Drop to dock'));
}

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
