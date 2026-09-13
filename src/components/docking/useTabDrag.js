/**
 * Dragging a tab: the live preview that follows the cursor, and what letting go
 * does. A drop lands in one of three places, a reorder inside the group it came
 * from, a zone on the compass, or nothing at all, which tears the tool off into
 * a window of its own.
 */

import { groupForTab, moveToGroup, moveToSplit, reorderTab } from './treeUtils.js';
import { toScreenPoint } from './PopoutWindow.js';
import { hasNativeWindows } from './layoutStorage.js';
import { startDragPreview } from './dragPreview.js';
import { zoneToAction } from './dropZones.js';

const { useRef, useCallback, useEffect } = React;

// Same-group reorder: move tab to insertIdx position.
function reorderWithinGroup(prev, tabId, fromGroupId, insert) {
  const group = groupForTab(prev, tabId);
  if (!group) return prev;
  const fromIdx = group.tabs.findIndex(t => t.id === tabId);
  if (fromIdx === -1) return prev;
  // insertIdx is "insert before this position"; adjust for removal
  let toIdx = insert.insertIdx > fromIdx ? insert.insertIdx - 1 : insert.insertIdx;
  if (toIdx === fromIdx) return prev;
  return reorderTab(prev, fromGroupId, fromIdx, toIdx);
}

// A drop on the compass: the centre joins the group, an edge splits it. A lone
// tab dropped on the edge of its own group would split the group away from
// itself, so it stays where it is.
function dropOnTarget(prev, tabId, fromGroupId, target) {
  const { groupId, zone } = target;
  if (zone === 'center') {
    if (groupId === fromGroupId) return prev;
    return moveToGroup(prev, tabId, groupId);
  }
  const action = zoneToAction(zone);
  if (!action) return prev;
  const group = groupForTab(prev, tabId);
  if (group && group.id === groupId && group.tabs.length === 1) return prev;
  return moveToSplit(prev, tabId, groupId, action.direction, action.side);
}

export function useTabDrag({ c, t, setTree, tearOff, setDragActive, setDragSrcGroupId }) {
  const dropTargetRef  = useRef(null);  // { groupId, zone }
  const dragDataRef    = useRef(null);  // { tabId, fromGroupId, tab }
  const dragInsertRef  = useRef(null);  // { groupId, insertIdx } — same-group tab reorder
  const ghostRef       = useRef(null);  // live drag preview, between down and up

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
        setTree(prev => reorderWithinGroup(prev, tabId, fromGroupId, insert));
      } else if (target) {
        setTree(prev => dropOnTarget(prev, tabId, fromGroupId, target));
      }

      dragDataRef.current   = null;
      dropTargetRef.current = null;
      dragInsertRef.current = null;
      setDragSrcGroupId(null);
      setDragActive(false);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    // `t` is used for the ghost label — include it so a locale switch isn't stale
  }, [c, t, tearOff, setTree, setDragActive, setDragSrcGroupId]);

  // The preview outlives this component if the layout goes away mid-drag, and
  // it is an always-on-top window: it would sit over everything with nothing
  // left to dismiss it.
  useEffect(() => () => {
    if (ghostRef.current) { ghostRef.current.end(); ghostRef.current = null; }
  }, []);

  return { dropTargetRef, dragInsertRef, handleTabDragStart };
}
