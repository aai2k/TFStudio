/**
 * What the workspace shows when it holds nothing.
 *
 * `EmptyWorkspace` is the placeholder itself; `EmptyDropTarget` is the drop
 * target laid over it while a floating window is being dragged.
 */

const { createElement: h } = React;

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

export function EmptyWorkspace({ c, t, onCreateProject }) {
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
