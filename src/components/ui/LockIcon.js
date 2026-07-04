// Designed padlock glyph (replaces the 🔒 / 🔓 emoji, which rendered with the
// OS's coloured emoji font and looked out of place — especially on dark themes).
// Inherits colour from the parent (`currentColor`), so the caller's `color`
// (e.g. accent when locked, textDim when unlocked) drives it.
const { createElement: h } = React;

export function LockIcon({ locked = true, size = 14, strokeWidth = 1.4 }) {
  // Body is identical for both states; only the shackle changes:
  //  locked   → closed U sitting on the body
  //  unlocked → shackle swung open (hinged up-left, right leg lifted clear)
  const shackle = locked
    ? h('path', {
        d: 'M5 7V5.2a3 3 0 0 1 6 0V7',
        stroke: 'currentColor', strokeWidth, fill: 'none', strokeLinecap: 'round',
      })
    : h('path', {
        d: 'M5 7V5.2a3 3 0 0 1 5.6-1.5',
        stroke: 'currentColor', strokeWidth, fill: 'none', strokeLinecap: 'round',
      });

  return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', style: { flexShrink: 0, display: 'block' } },
    shackle,
    // Lock body
    h('rect', { x: 3.25, y: 7, width: 9.5, height: 6.75, rx: 1.4, fill: 'currentColor' }),
    // Keyhole (punched out via the surface colour passed as `keyhole`, or a subtle dark dot)
    h('circle', { cx: 8, cy: 9.7, r: 1, fill: 'rgba(0,0,0,0.35)' }),
    h('rect', { x: 7.5, y: 10, width: 1, height: 2.2, rx: 0.5, fill: 'rgba(0,0,0,0.35)' })
  );
}
