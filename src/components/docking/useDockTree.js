/**
 * The docked tree: opening a tool into it, placing a tab at a drop target, and
 * the tab interactions a group reports. Owns the tree state and the
 * last-focused group, which is where a newly opened tool lands.
 */

import {
  makeGroup, cleanup, addTab, removeTab, setActiveTab,
  findNode, findFirstGroup, newTabId, splitGroup,
} from './treeUtils.js';
import { releaseWindowCopy } from '../windows/windowSession.js';
import { TOOL_CONFIGS } from './windowRegistry.js';
import { zoneToAction } from './dropZones.js';

const { useState, useRef, useCallback, useEffect } = React;

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

// Activate the tab already holding this tool, or null if none does.
// focusExisting: if this tool is already open, just activate that tab
// (don't create a duplicate). Used by guided tutorials.
//
// The result is wrapped so that "no tab holds this tool" stays distinct from
// whatever tree activating one produces. Read the tree itself as the answer and
// a falsy tree would read as "not open", which opens a second tab on a tool
// that is already on screen.
function focusExistingTab(prev, toolId, lastGroupRef) {
  const found = findTabByToolId(prev, toolId);
  if (!found) return null;
  lastGroupRef.current = found.groupId;
  return { tree: setActiveTab(prev, found.groupId, found.idx) };
}

// region:'left' forces the new tab into the FIRST (left-most) group —
// tutorials dock new tools beside the Design Editor. Otherwise it lands in
// the last-focused group (normal behaviour).
function addToolTab(prev, tab, opts, lastGroupRef) {
  let groupId = opts.region === 'left'
    ? (findFirstGroup(prev)?.id)
    : lastGroupRef.current;
  if (groupId && findNode(prev, groupId)) {
    lastGroupRef.current = groupId;
    return addTab(prev, groupId, tab);
  }
  const first = findFirstGroup(prev);
  return first ? addTab(prev, first.id, tab) : makeGroup([tab]);
}

function openToolIn(prev, toolId, cfg, opts, lastGroupRef) {
  if (!prev) return makeGroup([{ id: newTabId(), title: cfg.title, toolId }]);
  if (opts.focusExisting) {
    const focused = focusExistingTab(prev, toolId, lastGroupRef);
    if (focused) return focused.tree;
  }
  return addToolTab(prev, { id: newTabId(), title: cfg.title, toolId }, opts, lastGroupRef);
}

// Put a tab into the tree at a drop target. Center joins the group; an edge
// splits it.
function placeTabAt(prev, tab, target) {
  if (!prev) return makeGroup([tab]);
  if (!findNode(prev, target.groupId)) {
    const first = findFirstGroup(prev);
    return first ? addTab(prev, first.id, tab) : makeGroup([tab]);
  }
  if (target.zone === 'center') return addTab(prev, target.groupId, tab);
  const action = zoneToAction(target.zone);
  if (!action) return addTab(prev, target.groupId, tab);
  return splitGroup(prev, target.groupId, action.direction, action.side, tab);
}

function closeTabIn(prev, tabId) {
  const [t2] = removeTab(prev, tabId);
  return cleanup(t2);
}

export function useDockTree() {
  const [tree, setTree] = useState(null);
  const lastGroupRef = useRef(null);  // last focused group id
  // The current tree, for the callers that need to read it outside a render
  // without making it a dependency, the way floatsRef serves the float list.
  const treeRef = useRef(null);
  useEffect(() => { treeRef.current = tree; }, [tree]);

  const openTool = useCallback((toolId, opts = {}) => {
    const cfg = TOOL_CONFIGS[toolId];
    if (!cfg) return;
    setTree(prev => openToolIn(prev, toolId, cfg, opts, lastGroupRef));
  }, []);

  const handleTabClick = useCallback((groupId, idx) => {
    lastGroupRef.current = groupId;
    setTree(prev => setActiveTab(prev, groupId, idx));
  }, []);

  const handleTabClose = useCallback((tabId) => {
    // A closed window takes its controls with it. Tab ids are never reused, so
    // what this copy held could not be reached again.
    releaseWindowCopy(tabId);
    setTree(prev => closeTabIn(prev, tabId));
  }, []);

  const handleGroupFocus = useCallback((groupId) => {
    lastGroupRef.current = groupId;
  }, []);

  return {
    tree, setTree, treeRef, lastGroupRef, openTool, placeTab: placeTabAt,
    handleTabClick, handleTabClose, handleGroupFocus,
  };
}
