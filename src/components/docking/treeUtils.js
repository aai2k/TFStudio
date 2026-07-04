// Pure layout tree manipulation — no React, no side effects.
//
// Tree node shapes:
//   { type: 'split', id, direction: 'h'|'v', sizes: [num...], children: [Node...] }
//   { type: 'tabs',  id, activeTab: number,  tabs: [{ id, title, toolId }]        }

let _seq = 1;
export const uid = () => 'n' + (_seq++);

let _tabSeq = 1;
export const newTabId = () => 't' + (_tabSeq++);

// Re-key a restored layout tree so every node/tab id is freshly drawn from THIS
// session's counters (H7). A saved layout carries ids from the session that
// created it ('n1','t3','p101'…), but the module-level seq counters reset to
// their initial value on each launch — so without re-keying, the next
// newly-created node or tab reuses an id already present in the restored tree.
// That makes addTab/setSizes/setActiveTab mutate BOTH matching nodes and yields
// duplicate React keys. Re-keying with the live generators also advances the
// counters past every id now in the tree, so future ids can't collide either.
export function rekeyTree(node) {
  if (!node) return node;
  if (node.type === 'tabs') {
    return { ...node, id: uid(), tabs: (node.tabs || []).map(t => ({ ...t, id: newTabId() })) };
  }
  if (node.type === 'split') {
    return { ...node, id: uid(), children: (node.children || []).map(rekeyTree) };
  }
  return { ...node, id: uid() };
}

export function makeGroup(tabs = [], activeTab = 0) {
  return { type: 'tabs', id: uid(), tabs, activeTab };
}

export function makeSplit(direction, children) {
  const sizes = children.map(() => 100 / children.length);
  return { type: 'split', id: uid(), direction, children, sizes };
}

// Walk every node, returning a new tree. fn receives the node BEFORE recursing children.
function walk(tree, fn) {
  if (!tree) return null;
  const mapped = fn(tree);
  if (!mapped) return null;
  if (mapped.children) {
    return { ...mapped, children: mapped.children.map(c => walk(c, fn)).filter(Boolean) };
  }
  return mapped;
}

export function findNode(tree, id) {
  if (!tree) return null;
  if (tree.id === id) return tree;
  if (tree.children) for (const c of tree.children) { const r = findNode(c, id); if (r) return r; }
  return null;
}

export function findFirstGroup(tree) {
  if (!tree) return null;
  if (tree.type === 'tabs') return tree;
  if (tree.children) for (const c of tree.children) { const r = findFirstGroup(c); if (r) return r; }
  return null;
}

export function groupForTab(tree, tabId) {
  if (!tree) return null;
  if (tree.type === 'tabs' && tree.tabs.some(t => t.id === tabId)) return tree;
  if (tree.children) for (const c of tree.children) { const r = groupForTab(c, tabId); if (r) return r; }
  return null;
}

export function setActiveTab(tree, groupId, idx) {
  return walk(tree, n => n.id === groupId && n.type === 'tabs' ? { ...n, activeTab: idx } : n);
}

export function setSizes(tree, nodeId, newSizes) {
  return walk(tree, n => n.id === nodeId && n.type === 'split' ? { ...n, sizes: newSizes } : n);
}

export function addTab(tree, groupId, tab) {
  return walk(tree, n => {
    if (n.id !== groupId || n.type !== 'tabs') return n;
    return { ...n, tabs: [...n.tabs, tab], activeTab: n.tabs.length };
  });
}

// Returns [newTree, removedTab | null]
export function removeTab(tree, tabId) {
  const group = groupForTab(tree, tabId);
  if (!group) return [tree, null];
  const idx = group.tabs.findIndex(t => t.id === tabId);
  const tab = group.tabs[idx];
  const newTabs = group.tabs.filter(t => t.id !== tabId);
  // Closing a tab to the LEFT of the active one shifts the active tab's index
  // down by one — decrement so the SAME tab stays selected (the old code only
  // clamped to the new length, so removing a left neighbour silently jumped the
  // selection to the next tab).
  let activeTab = group.activeTab;
  if (idx < activeTab) activeTab -= 1;
  activeTab = Math.min(activeTab, Math.max(0, newTabs.length - 1));
  const newGroup = { ...group, tabs: newTabs, activeTab };
  const newTree = walk(tree, n => n.id === group.id ? newGroup : n);
  return [newTree, tab];
}

// Remove empty groups; collapse single-child splits; equalize remaining sizes.
export function cleanup(tree) {
  if (!tree) return null;
  if (tree.type === 'tabs') return tree.tabs.length === 0 ? null : tree;
  if (tree.type === 'split') {
    const children = tree.children.map(cleanup).filter(Boolean);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    const sizes = children.map(() => 100 / children.length);
    return { ...tree, children, sizes };
  }
  return tree;
}

// Split groupId, insert a new tab group on 'side' ('start'|'end') along 'direction' ('h'|'v').
//
// The `replaced` flag is critical: walk() recurses into the returned node's children,
// which includes the original `n`. Without the flag, fn would match `n` again on the
// next recursion and produce an infinite chain of splits.
export function splitGroup(tree, targetGroupId, direction, side, tab) {
  const newGroup = makeGroup([tab]);
  let replaced = false;
  return walk(tree, n => {
    if (!replaced && n.id === targetGroupId && n.type === 'tabs') {
      replaced = true;
      const children = side === 'start' ? [newGroup, n] : [n, newGroup];
      return makeSplit(direction, children);
    }
    return n;
  });
}

// Move tab to an existing group (center drop).
export function moveToGroup(tree, tabId, targetGroupId) {
  const [t2, tab] = removeTab(tree, tabId);
  if (!tab) return tree;
  const t3 = cleanup(t2);
  if (!t3) return makeGroup([tab]);
  const target = findNode(t3, targetGroupId);
  if (!target) {
    // Target was cleaned up (was only the dragged tab). Find first group.
    const first = findFirstGroup(t3);
    if (!first) return makeGroup([tab]);
    return addTab(t3, first.id, tab);
  }
  return addTab(t3, targetGroupId, tab);
}

// Move tab to split an existing group (edge drop).
export function moveToSplit(tree, tabId, targetGroupId, direction, side) {
  const [t2, tab] = removeTab(tree, tabId);
  if (!tab) return tree;
  const t3 = cleanup(t2);
  if (!t3) return makeGroup([tab]);
  const target = findNode(t3, targetGroupId);
  if (!target) {
    const first = findFirstGroup(t3);
    if (!first) return makeGroup([tab]);
    return addTab(t3, first.id, tab);
  }
  return splitGroup(t3, targetGroupId, direction, side, tab);
}

// Reorder tabs within a group (drag tab to a different position in the same group).
export function reorderTab(tree, groupId, fromIdx, toIdx) {
  return walk(tree, n => {
    if (n.id !== groupId || n.type !== 'tabs') return n;
    const tabs = [...n.tabs];
    const [moved] = tabs.splice(fromIdx, 1);
    tabs.splice(toIdx, 0, moved);
    return { ...n, tabs, activeTab: toIdx };
  });
}
