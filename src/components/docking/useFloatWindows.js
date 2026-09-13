/**
 * Torn-off tools: the list of them, the OS window each one holds, and the moves
 * between the layout and the desktop. A float keeps the tab id it was torn off
 * with, so docking it back is the same open copy of the tool.
 */

import { makeGroup, addTab, removeTab, cleanup, findNode, findFirstGroup } from './treeUtils.js';
import { releaseWindowCopy } from '../windows/windowSession.js';
import { toClientPoint } from './PopoutWindow.js';
import { clampToScreen } from './layoutStorage.js';
import { zoneAt } from './dropZones.js';

const { useState, useRef, useCallback, useEffect } = React;

// The float's live rectangle, read off its own window, or the one it was
// created with while no window is open for it.
function liveBounds(float, win) {
  if (!win || win.closed) return float;
  return {
    ...float,
    bounds: { left: win.screenX, top: win.screenY, width: win.innerWidth, height: win.innerHeight },
  };
}

// Where a float goes when it is docked with no drop target chosen: the group a
// freshly-opened tool would land in.
function dockIntoTree(prev, tab, lastGroupRef) {
  if (!prev) return makeGroup([tab]);
  const groupId = lastGroupRef.current && findNode(prev, lastGroupRef.current)
    ? lastGroupRef.current
    : findFirstGroup(prev)?.id;
  return groupId ? addTab(prev, groupId, tab) : makeGroup([tab]);
}

function detachTab(prev, tabId) {
  const [detached] = removeTab(prev, tabId);
  return cleanup(detached);
}

// The zone is replaced only when it is a different one, or each move would
// re-render every docked window.
function sameZone(prev, next) {
  return prev?.groupId === next?.groupId && prev?.zone === next?.zone;
}

export function useFloatWindows({ setTree, placeTab, lastGroupRef, setDragActive, setForcedZone }) {
  const [floats, setFloats] = useState([]);   // torn-off tools, one OS window each
  const floatWinsRef = useRef(new Map());     // floatId → its OS window, for live bounds
  const floatsRef = useRef([]);
  useEffect(() => { floatsRef.current = floats; }, [floats]);

  // The user can move and resize a float once it is open, so the rectangle we
  // save has to be read off the live window, not from where it was created.
  const floatsWithBounds = useCallback(
    () => floatsRef.current.map(f => liveBounds(f, floatWinsRef.current.get(f.id))), []);

  // A tab dropped on nothing leaves the layout and becomes its own OS window,
  // opened where the pointer let go and at the size the pane had, so it lands
  // looking like the preview that was under the cursor.
  const tearOff = useCallback((tab, screenPoint, sourceRect) => {
    setTree(prev => detachTab(prev, tab.id));
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
  }, [setTree]);

  const closeFloat = useCallback((floatId) => {
    floatWinsRef.current.delete(floatId);
    setFloats(prev => prev.filter(f => f.id !== floatId));
  }, []);

  // The float's own close button, as against docking it back: the window is gone
  // for good, so what it was holding goes with it.
  const closeFloatWindow = useCallback((floatId) => {
    releaseWindowCopy(floatId);
    closeFloat(floatId);
  }, [closeFloat]);

  // Return a float to the layout, at `target` if a drag chose one, otherwise
  // wherever a freshly-opened tool would land.
  const dockFloat = useCallback((floatId, target) => {
    const float = floatsRef.current.find(f => f.id === floatId);
    if (!float) return;
    // The float keeps the id it was torn off with, so docking it back is the
    // same open copy of the tool and its controls come back with it.
    const tab = { id: float.id, title: float.title, toolId: float.toolId };
    setTree(prev => (target
      ? placeTab(prev, tab, target)
      : dockIntoTree(prev, tab, lastGroupRef)));
    closeFloat(floatId);
  }, [placeTab, closeFloat, setTree, lastGroupRef]);

  // Dragging a float's title bar over the layout docks it. The float moves
  // itself rather than being moved by the OS, so its mouse events are readable
  // here and the drop targets can light up as it passes over them; the pointer's
  // screen position is what crosses between the two windows.
  const zoneUnder = useCallback((screenPoint) => {
    const local = screenPoint && toClientPoint(window, screenPoint.x, screenPoint.y);
    return local ? zoneAt(local.x, local.y) : null;
  }, []);

  // The float reports every mouse move.
  const handleFloatDragOver = useCallback((screenPoint) => {
    setDragActive(true);
    const next = zoneUnder(screenPoint);
    setForcedZone(prev => (sameZone(prev, next) ? prev : next));
  }, [zoneUnder, setDragActive, setForcedZone]);

  const handleFloatDrop = useCallback((floatId, screenPoint) => {
    const target = zoneUnder(screenPoint);
    setForcedZone(null);
    setDragActive(false);
    if (target) dockFloat(floatId, target);
  }, [zoneUnder, dockFloat, setDragActive, setForcedZone]);

  return {
    floats, setFloats, floatsRef, floatWinsRef, floatsWithBounds,
    tearOff, closeFloatWindow, dockFloat, handleFloatDragOver, handleFloatDrop,
  };
}
