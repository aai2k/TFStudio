const { createElement: h, useState, useRef, useCallback, useEffect } = React;
import { HelpButton } from '../ui/HelpButton.js';
import { ICONS, iconColorForTool } from '../Toolbar.js';
import { attachTabWheelScroll } from './tabWheel.js';
import { observeResize } from '../ui/observeResize.js';

// Mini tool icon for a docking tab. Scaled to 14px to sit beside
// the tab title. In colorful mode it wears the tool's group hue; otherwise it
// inherits the surrounding text color. Returns null for tools with no icon.
export function TabIcon({ toolId, colorful, dim }) {
  const icon = ICONS[toolId];
  if (!icon) return null;
  const tint = colorful ? iconColorForTool(toolId) : null;
  return h('span', {
    style: {
      display: 'flex', flexShrink: 0, width: 14, height: 14, overflow: 'hidden',
      color: tint || 'inherit', opacity: tint ? (dim ? 0.85 : 1) : (dim ? 0.7 : 0.9)
    }
  }, h('span', { style: { display: 'flex', flexShrink: 0, transform: 'scale(0.7)', transformOrigin: 'top left' } }, icon));
}

// Drop targets are a compass at the centre of the group rather than five
// translucent slabs over it: the buttons are small and explicit, the pane stays
// readable while dragging, and a drop that misses them all means "not here".
//
// `box` positions each button inside a 108×108 pad centred on the pane;
// `preview` is the share of the pane the drop would take, shaded so the result
// is visible before the mouse is released.
const PAD = 108;
const BTN = 32;
const MID = (PAD - BTN) / 2;
const ZONES = [
  { id: 'center', arrow: null,
    box: { left: MID, top: MID },
    preview: { inset: 0 } },
  { id: 'top',    arrow: 'M6 10.5L11 5.5L16 10.5',
    box: { left: MID, top: MID - BTN - 4 },
    preview: { left: 0, right: 0, top: 0, height: '50%' } },
  { id: 'bottom', arrow: 'M6 5.5L11 10.5L16 5.5',
    box: { left: MID, top: MID + BTN + 4 },
    preview: { left: 0, right: 0, bottom: 0, height: '50%' } },
  { id: 'left',   arrow: 'M10.5 5L5.5 10L10.5 15',
    box: { left: MID - BTN - 4, top: MID },
    preview: { top: 0, bottom: 0, left: 0, width: '50%' } },
  { id: 'right',  arrow: 'M5.5 5L10.5 10L5.5 15',
    box: { left: MID + BTN + 4, top: MID },
    preview: { top: 0, bottom: 0, right: 0, width: '50%' } },
];

export function TabGroup({ node, c, dragActive, dragSrcGroupId, dragInsertRef, dropTargetRef, forcedZone, onTabClick, onTabClose, onTabDragStart, onGroupFocus, renderContent, helpAnchorFor, locale, t, ribbonStyle = 'colorful' }) {
  const colorful = ribbonStyle !== 'minimalist';
  const [hovZone,     setHovZone]     = useState(null);
  const [insertAtIdx, setInsertAtIdx] = useState(-1);  // insertion cursor for same-group reorder
  const [overflowing, setOverflowing] = useState(false);  // tabs exceed the strip width
  const [menuOpen,    setMenuOpen]    = useState(false);   // overflow tab-list dropdown
  const [menuPos,     setMenuPos]     = useState(null);    // {top,right} screen coords for the dropdown
  const tabBarRef = useRef(null);
  const ovBtnRef  = useRef(null);

  const dk = (t && t.docking) || {};
  // Localized tab label resolved live from the toolId, so persisted layouts
  // (which baked the English title in at creation) re-localize on language switch.
  const titleFor = (tab) => (t && t.windowTitles && t.windowTitles[tab.toolId]) || tab.title;

  const isSameGroupDrag = dragActive && dragSrcGroupId === node.id;

  // Clear insertion cursor when same-group drag ends
  useEffect(() => {
    if (!isSameGroupDrag) setInsertAtIdx(-1);
  }, [isSameGroupDrag]);

  // Detect when the tab strip overflows its width (so the "all tabs" dropdown
  // appears only when some tabs are clipped — non-intrusive otherwise).
  useEffect(() => {
    const bar = tabBarRef.current;
    if (!bar) return;
    const measure = () => setOverflowing(bar.scrollWidth > bar.clientWidth + 1);
    measure();
    const ro = observeResize(bar, measure);
    return () => { if (ro) ro.disconnect(); };
  }, [node.tabs.length]);

  // React delegates wheel events through a passive listener, which cannot cancel
  // vertical page scrolling. A native non-passive listener keeps wheel input on
  // an overflowing tab strip horizontal without emitting a browser warning.
  useEffect(() => {
    const bar = tabBarRef.current;
    if (!bar) return;
    return attachTabWheelScroll(bar);
  }, []);

  // Keep the active tab visible: scroll it into view when the selection changes
  // (e.g. via the overflow dropdown, or when a far-off tab is activated).
  useEffect(() => {
    const bar = tabBarRef.current;
    if (!bar) return;
    const el = bar.querySelector(`[data-tabidx="${node.activeTab}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [node.activeTab, node.tabs.length]);

  // Open the overflow menu, anchoring it to the button's SCREEN position. The
  // menu must render with position:fixed because the tab bar and the TabGroup
  // root are both overflow:hidden — an absolutely-positioned menu would be
  // clipped and appear "hidden behind the window".
  const toggleMenu = useCallback((e) => {
    e.stopPropagation();
    setMenuOpen(open => {
      if (!open && ovBtnRef.current) {
        const r = ovBtnRef.current.getBoundingClientRect();
        setMenuPos({ top: r.bottom, right: Math.max(4, window.innerWidth - r.right) });
      }
      return !open;
    });
  }, []);

  const handleTabBarMouseMove = useCallback((e) => {
    if (!isSameGroupDrag) return;
    const bar = tabBarRef.current;
    if (!bar) return;
    const tabEls = bar.querySelectorAll('[data-tabidx]');
    let idx = node.tabs.length; // default: after last tab
    for (const el of tabEls) {
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) {
        idx = parseInt(el.getAttribute('data-tabidx'), 10);
        break;
      }
    }
    setInsertAtIdx(idx);
    if (dragInsertRef) dragInsertRef.current = { groupId: node.id, insertIdx: idx };
  }, [isSameGroupDrag, node.id, node.tabs.length, dragInsertRef]);

  const handleTabBarMouseLeave = useCallback(() => {
    if (!isSameGroupDrag) return;
    setInsertAtIdx(-1);
    if (dragInsertRef) dragInsertRef.current = null;
  }, [isSameGroupDrag, dragInsertRef]);

  const handleZoneEnter = (zoneId) => {
    setHovZone(zoneId);
    if (dropTargetRef) dropTargetRef.current = { groupId: node.id, zone: zoneId };
  };

  const handleZoneLeave = (zoneId) => {
    setHovZone(z => z === zoneId ? null : z);
    if (dropTargetRef && dropTargetRef.current?.groupId === node.id && dropTargetRef.current?.zone === zoneId) {
      dropTargetRef.current = null;
    }
  };

  const activeTab = node.tabs[node.activeTab] ?? node.tabs[0];

  return h('div', {
    onClick: () => onGroupFocus && onGroupFocus(node.id),
    // Measured when a tab is torn off, so the drag preview is the shape of the
    // window being dragged rather than a generic box.
    'data-dockgroup-root': node.id,
    style: {
      display: 'flex', flexDirection: 'column',
      width: '100%', height: '100%',
      overflow: 'hidden', position: 'relative',
      border: `1px solid ${c.border}`
    }
  },
    // ── Tab bar ───────────────────────────────────────────────────────────────
    h('div', {
      style: {
        display: 'flex', alignItems: 'stretch', flexShrink: 0,
        height: 30, backgroundColor: c.bg,
        borderBottom: `1px solid ${c.border}`,
        overflow: 'hidden', position: 'relative'
      }
    },
      // Scrollable tab strip (flex-fills the bar; tabs themselves never shrink).
      h('div', {
        ref: tabBarRef,
        onMouseMove:  handleTabBarMouseMove,
        onMouseLeave: handleTabBarMouseLeave,
        // hide the horizontal scrollbar — scrolling is via wheel / active-tab
        // auto-scroll / the overflow dropdown, so a visible bar would just add clutter
        className: 'tabstrip-noscrollbar',
        style: {
          display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 0,
          overflowX: 'auto', overflowY: 'hidden',
          scrollbarWidth: 'none'
        }
      },
        node.tabs.map((tab, idx) =>
          h(DockTab, {
            key: tab.id, tab, idx,
            displayTitle: titleFor(tab),
            isActive: idx === node.activeTab,
            c, colorful,
            showInsertBefore: isSameGroupDrag && insertAtIdx === idx,
            showInsertAfter:  isSameGroupDrag && insertAtIdx === node.tabs.length && idx === node.tabs.length - 1,
            accentColor: c.accent,
            onClick: () => onTabClick(node.id, idx),
            onClose: () => onTabClose(tab.id),
            onDragStart: (e) => onTabDragStart(e, tab, node.id)
          })
        )
      ),

      // Overflow "all tabs" dropdown — appears only when tabs are clipped.
      overflowing && h('div', { style: { position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'stretch' } },
        h('button', {
          ref: ovBtnRef,
          title: dk.allTabs || 'All windows',
          onClick: toggleMenu,
          style: {
            display: 'flex', alignItems: 'center', gap: 3,
            border: 'none', borderLeft: `1px solid ${c.border}`,
            background: menuOpen ? c.hover : c.bg, color: c.text,
            cursor: 'pointer', padding: '0 8px', fontSize: 11,
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }
        },
          h('span', { style: { fontWeight: 600 } }, node.tabs.length),
          h('svg', { width: 9, height: 9, viewBox: '0 0 8 8', fill: 'none' },
            h('path', { d: 'M1 2.5L4 5.5L7 2.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' })
          )
        ),
        menuOpen && h('div', {
          // click-catcher closes the menu
          onClick: () => setMenuOpen(false),
          style: { position: 'fixed', inset: 0, zIndex: 9998 }
        }),
        menuOpen && menuPos && h('div', {
          onClick: (e) => e.stopPropagation(),
          style: {
            position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 9999,
            minWidth: 200, maxWidth: 320, maxHeight: 360, overflowY: 'auto',
            background: c.panel, border: `1px solid ${c.border}`, borderRadius: 4,
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)', padding: '4px 0'
          }
        },
          node.tabs.map((tab, idx) =>
            h('div', {
              key: tab.id,
              onClick: (e) => { e.stopPropagation(); setMenuOpen(false); onTabClick(node.id, idx); },
              style: {
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 12px', cursor: 'pointer', fontSize: 12,
                color: idx === node.activeTab ? c.text : c.textDim,
                background: idx === node.activeTab ? c.accent + '22' : 'transparent',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
              },
              onMouseEnter: (e) => { if (idx !== node.activeTab) e.currentTarget.style.background = c.hover; },
              onMouseLeave: (e) => { if (idx !== node.activeTab) e.currentTarget.style.background = 'transparent'; }
            },
              h(TabIcon, { toolId: tab.toolId, colorful, dim: idx !== node.activeTab }),
              h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' } }, titleFor(tab)),
              h('span', {
                onClick: (e) => { e.stopPropagation(); onTabClose(tab.id); },
                title: dk.close || 'Close',
                style: { flexShrink: 0, color: c.textDim, fontSize: 14, lineHeight: '14px', padding: '0 2px' }
              }, '×')
            )
          )
        )
      ),

      // Help "?" anchored to the active tab
      activeTab && helpAnchorFor && h('div', {
        style: { display: 'flex', alignItems: 'center', padding: '0 8px', flexShrink: 0 }
      },
        h(HelpButton, {
          c,
          anchor: helpAnchorFor(activeTab.toolId),
          locale,
          size: 18,
          title: 'Help for this window (F1)'
        })
      )
    ),

    // ── Content ───────────────────────────────────────────────────────────────
    h('div', {
      // Tag the active tool panel so the tutorial coach can spotlight the actual
      // tool window (e.g. the optimizer) rather than its ribbon button.
      'data-tutorial-tool': activeTab ? activeTab.toolId : undefined,
      style: {
        flex: 1, overflow: 'hidden', position: 'relative',
        backgroundColor: c.panel
      }
    },
      activeTab && renderContent(activeTab),

      // ── Drop compass (visible during any drag) ───────────────────────────
      // A drag inside this window highlights a button through mouseenter. A drag
      // coming from a torn-off window has no pointer in this document, so the
      // layout hit-tests the buttons by screen position and names the winner in
      // `forcedZone` instead. `data-dockzone` is what that hit test reads.
      dragActive && (() => {
        const litZone = (forcedZone && forcedZone.groupId === node.id)
          ? forcedZone.zone
          : hovZone;
        const lit = ZONES.find(z => z.id === litZone);
        return h('div', {
          style: { position: 'absolute', inset: 0, zIndex: 200, pointerEvents: 'none' }
        },
          // Where the tool would land, shaded behind the compass.
          lit && h('div', {
            style: {
              position: 'absolute', ...lit.preview,
              backgroundColor: c.accent + '33',
              border: `1px solid ${c.accent}`,
              boxSizing: 'border-box', pointerEvents: 'none',
            }
          }),

          h('div', {
            style: {
              position: 'absolute', left: '50%', top: '50%',
              width: PAD, height: PAD, marginLeft: -PAD / 2, marginTop: -PAD / 2,
              pointerEvents: 'none',
            }
          },
            ZONES.map(zone => {
              const on = litZone === zone.id;
              return h('div', {
                key: zone.id,
                'data-dockzone': zone.id,
                'data-dockgroup': node.id,
                onMouseEnter: () => handleZoneEnter(zone.id),
                onMouseLeave: () => handleZoneLeave(zone.id),
                style: {
                  position: 'absolute', ...zone.box, width: BTN, height: BTN,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: on ? c.accent : c.panel,
                  border: `1px solid ${on ? c.accent : c.border}`,
                  borderRadius: 4,
                  color: on ? '#fff' : c.textDim,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  transition: 'background-color 0.1s, color 0.1s, border-color 0.1s',
                  boxSizing: 'border-box', pointerEvents: 'all',
                }
              },
                zone.arrow
                  ? h('svg', { width: 21, height: 21, viewBox: '0 0 21 21', fill: 'none' },
                      h('path', {
                        d: zone.arrow, stroke: 'currentColor', strokeWidth: 1.6,
                        strokeLinecap: 'round', strokeLinejoin: 'round',
                      }))
                  // Centre: a tab joining the group it is dropped on.
                  : h('svg', { width: 21, height: 21, viewBox: '0 0 21 21', fill: 'none' },
                      h('rect', { x: 3.5, y: 4.5, width: 14, height: 12, rx: 1, stroke: 'currentColor', strokeWidth: 1.4 }),
                      h('path', { d: 'M3.5 8.5h14M11 4.5v4', stroke: 'currentColor', strokeWidth: 1.4 }))
              );
            })
          )
        );
      })()
    )
  );
}

// ── Individual tab ──────────────────────────────────────────────────────────

function DockTab({ tab, idx, isActive, c, colorful, displayTitle, showInsertBefore, showInsertAfter, accentColor, onClick, onClose, onDragStart }) {
  const [hov,      setHov]      = useState(false);
  const [closeHov, setCloseHov] = useState(false);
  const pendingDragRef = useRef(null);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;

    const onMove = (me) => {
      if (Math.hypot(me.clientX - startX, me.clientY - startY) > 5) {
        cleanup();
        onDragStart(me);
      }
    };
    const onUp = () => cleanup();
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      pendingDragRef.current = null;
    };

    pendingDragRef.current = cleanup;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const insertLine = (showInsertBefore || showInsertAfter) ? h('div', {
    style: {
      position: 'absolute',
      [showInsertAfter ? 'right' : 'left']: -1,
      top: 2, bottom: 2, width: 2,
      backgroundColor: accentColor || '#007acc',
      borderRadius: 1, zIndex: 10, pointerEvents: 'none'
    }
  }) : null;

  return h('div', {
    'data-tabidx': idx,
    onMouseDown: handleMouseDown,
    onClick,
    onMouseEnter: () => setHov(true),
    onMouseLeave: () => setHov(false),
    title: displayTitle || tab.title,
    style: {
      position: 'relative',
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '0 8px 0 12px', flexShrink: 0,
      maxWidth: 180,
      backgroundColor: isActive ? c.panel : hov ? c.hover : 'transparent',
      color: isActive ? c.text : c.textDim,
      borderRight: `1px solid ${c.border}`,
      borderBottom: isActive ? `2px solid ${c.accent}` : '2px solid transparent',
      cursor: 'grab', userSelect: 'none',
      fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
      transition: 'background-color 0.1s',
      overflow: 'visible'
    }
  },
    insertLine,
    h(TabIcon, { toolId: tab.toolId, colorful, dim: !isActive }),
    h('span', {
      style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }
    }, displayTitle || tab.title),

    h('span', {
      onMouseDown: (e) => e.stopPropagation(),
      onClick: (e) => { e.stopPropagation(); onClose(); },
      onMouseEnter: () => setCloseHov(true),
      onMouseLeave: () => setCloseHov(false),
      title: 'Close',
      style: {
        flexShrink: 0, width: 16, height: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 3,
        opacity: hov || isActive ? 1 : 0,
        backgroundColor: closeHov ? 'rgba(220,50,50,0.88)' : 'transparent',
        color: closeHov ? '#fff' : c.textDim,
        transition: 'opacity 0.12s, background-color 0.12s, color 0.12s',
        cursor: 'pointer',
      }
    },
      h('svg', { width: 8, height: 8, viewBox: '0 0 8 8', fill: 'none' },
        h('path', { d: 'M1 1l6 6M7 1L1 7', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })
      )
    )
  );
}
