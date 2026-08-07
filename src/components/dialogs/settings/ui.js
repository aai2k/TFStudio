// Shared presentation helpers for the Settings panes.

const { createElement: h } = React;

export const sectionStyle = { marginBottom: '20px' };

export const labelStyle = (c) => ({
  display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px',
  color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.5px',
});

export const selectStyle = (c) => ({
  width: '100%', padding: '10px', backgroundColor: c.bg, color: c.text,
  border: `1px solid ${c.border}`, borderRadius: '6px', fontSize: '13px',
});

export const hintStyle = (c) => ({
  display: 'block', fontSize: '12px', color: c.textDim, marginTop: '6px',
});

export const buttonStyle = (c) => ({
  padding: '8px 12px', backgroundColor: c.bg, color: c.text,
  border: `1px solid ${c.border}`, borderRadius: '6px', cursor: 'pointer',
  fontSize: '12px', fontWeight: '600',
});

// A titled block within a pane.
export const Section = ({ c, title, children }) =>
  h('div', { style: sectionStyle },
    title && h('label', { style: labelStyle(c) }, title),
    children);
