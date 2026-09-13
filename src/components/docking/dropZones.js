/**
 * Reading the drop compass: which tree operation a zone stands for, and which
 * zone sits under a point on screen.
 */

// ── Zone → tree action ────────────────────────────────────────────────────────

// Which way an edge zone splits the group it is dropped on. 'center' is absent
// on purpose: it joins the group rather than splitting it, and every caller
// handles that case before asking.
//
// Every caller shares one object per zone, so the entries are frozen: a caller
// that adjusted an action in place would otherwise rewrite the table and send
// every later drop on that zone the wrong way.
const ZONE_ACTIONS = Object.freeze({
  top:    Object.freeze({ direction: 'v', side: 'start' }),
  bottom: Object.freeze({ direction: 'v', side: 'end'   }),
  left:   Object.freeze({ direction: 'h', side: 'start' }),
  right:  Object.freeze({ direction: 'h', side: 'end'   }),
});

export function zoneToAction(zone) {
  return ZONE_ACTIONS[zone] || null;
}

// Which drop zone sits under a point in this window's client coordinates.
// Reads the zone overlays TabGroup renders, so a drag arriving from a float
// resolves to exactly the target an in-window drag would.
export function zoneAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const zone = el && el.closest && el.closest('[data-dockzone]');
  if (!zone) return null;
  return { groupId: zone.getAttribute('data-dockgroup'), zone: zone.getAttribute('data-dockzone') };
}
