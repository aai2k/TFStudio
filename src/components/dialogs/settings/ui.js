// Shared presentation helpers for the Preferences panes.
//
// A pane is a list of rows: what the setting is on the left, the control that
// changes it on the right, and the explanation under the name where it does not
// compete with either. Stacking a heading, a full-width control and a hint for
// every setting is what made this dialog three times taller than it needed to
// be, with most of the width unused.

const { createElement: h } = React;

export const CONTROL_WIDTH = 250;

export const labelStyle = (c) => ({
  display: 'block', fontSize: '11px', fontWeight: '600',
  color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.6px',
});

export const selectStyle = (c) => ({
  width: '100%', padding: '5px 7px', backgroundColor: c.field || c.bg, color: c.text,
  border: `1px solid ${c.border}`, borderRadius: '4px', fontSize: '12.5px',
});

export const hintStyle = (c) => ({
  display: 'block', fontSize: '11.5px', color: c.textDim, marginTop: '3px', lineHeight: 1.45,
});

export const buttonStyle = (c) => ({
  padding: '5px 10px', backgroundColor: c.field || c.bg, color: c.text,
  border: `1px solid ${c.border}`, borderRadius: '4px', cursor: 'pointer',
  fontSize: '12px', fontWeight: '600',
});

// A titled group of rows.
export const Section = ({ c, title, children }) =>
  h('div', { style: { marginBottom: '18px' } },
    title && h('div', { style: { ...labelStyle(c), marginBottom: '6px' } }, title),
    children);

/**
 * One setting: its name and explanation, and the control that changes it.
 *
 * `wide` gives the control the whole row instead, for the few that cannot work
 * in a fixed column (a reorderable list, a folder path).
 */
export const Row = ({ c, label, hint, wide, children }) =>
  h('div', {
    style: {
      display: 'flex', flexDirection: wide ? 'column' : 'row',
      alignItems: wide ? 'stretch' : 'flex-start',
      gap: wide ? '7px' : '18px',
      padding: '9px 0',
      borderBottom: `1px solid ${c.border}`,
    },
  },
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', { style: { fontSize: '13px', color: c.text } }, label),
      hint && h('div', { style: hintStyle(c) }, hint)),
    h('div', {
      style: wide
        ? null
        : { width: `${CONTROL_WIDTH}px`, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px' },
    }, children));
