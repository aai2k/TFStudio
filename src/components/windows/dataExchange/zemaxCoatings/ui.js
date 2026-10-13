// A header is shown as written: uppercasing it would turn λ range (µm) into
// Λ RANGE (ΜM).
export const th = (c) => ({ textAlign: 'left', padding: '4px 8px', fontSize: 10, color: c.textDim, borderBottom: `1px solid ${c.border}`, position: 'sticky', top: 0, background: c.panel });
export const td = (c) => ({ padding: '3px 8px', fontSize: 11.5, color: c.text, borderBottom: `1px solid ${c.border}22` });
