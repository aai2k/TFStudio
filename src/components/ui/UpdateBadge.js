// Title-bar update indicator, at the left of the title bar.
//
// Carries the check state persistently, with the reason on hover, so a startup
// card that auto-dismissed still leaves the information reachable. Clicking
// runs a manual check, which ignores the skip list and always reports. With
// nothing to report it takes no room at all; a check can still be started from
// the ribbon's help menu.

const { createElement: h } = React;

const buttonStyle = (c) => ({
  width: '32px', height: '100%', border: 'none', backgroundColor: 'transparent',
  color: c.textDim, cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  WebkitAppRegion: 'no-drag', outline: 'none', padding: 0,
});

const DownloadGlyph = ({ color }) =>
  h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none' },
    h('path', {
      d: 'M8 2.5v7M5 7l3 3 3-3', stroke: color, strokeWidth: 1.4,
      strokeLinecap: 'round', strokeLinejoin: 'round',
    }),
    h('path', { d: 'M3 13h10', stroke: color, strokeWidth: 1.4, strokeLinecap: 'round' }));

const Spinner = ({ color }) =>
  h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none' },
    h('circle', { cx: 8, cy: 8, r: 6, stroke: color, strokeWidth: 1.4, opacity: 0.25 }),
    h('path', { d: 'M14 8a6 6 0 0 0-6-6', stroke: color, strokeWidth: 1.4, strokeLinecap: 'round' },
      h('animateTransform', {
        attributeName: 'transform', type: 'rotate',
        from: '0 8 8', to: '360 8 8', dur: '0.9s', repeatCount: 'indefinite',
      })));

const WarnGlyph = ({ color }) =>
  h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none' },
    h('circle', { cx: 8, cy: 8, r: 6, stroke: color, strokeWidth: 1.3 }),
    h('path', { d: 'M8 5v4', stroke: color, strokeWidth: 1.4, strokeLinecap: 'round' }),
    h('circle', { cx: 8, cy: 11, r: 0.7, fill: color }));

// Idle draws nothing: an always-present glyph in the title bar would be noise
// for the overwhelmingly common case of "nothing to report".
function glyphFor(status, c) {
  if (status === 'checking') return { node: h(Spinner, { color: c.textDim }), key: 'checking' };
  if (status === 'available') return { node: h(DownloadGlyph, { color: c.accent }), key: 'available' };
  if (status === 'failed') return { node: h(WarnGlyph, { color: c.textDim }), key: 'failed' };
  return null;
}

export function UpdateBadge({ status, latest, onClick, c, t }) {
  const glyph = glyphFor(status, c);
  if (!glyph) return null;
  const title = glyph.key === 'available'
    ? t.update.badgeAvailable(latest)
    : t.update.badge[glyph.key];

  return h('button', {
    onClick,
    title,
    'aria-label': title,
    style: buttonStyle(c),
    onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = c.hover; },
    onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'transparent'; },
  }, glyph.node);
}
