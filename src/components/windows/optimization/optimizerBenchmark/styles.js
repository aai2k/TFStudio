export function cardStyle(c) {
    return { background: c.panel, border: `1px solid ${c.border}`, borderRadius: 6, padding: 10 };
}
export function thStyle(c) {
    return { textAlign: 'left', padding: '4px 8px', color: c.textDim, fontWeight: 600, fontSize: 11, borderBottom: `1px solid ${c.border}`, position: 'sticky', top: 0, background: c.panel };
}
export function tdStyle(c) {
    return { padding: '3px 8px', fontSize: 12, borderBottom: `1px solid ${c.border}22`, fontVariantNumeric: 'tabular-nums' };
}
export function linkBtnStyle(c) {
    return { background: 'transparent', border: `1px solid ${c.border}`, color: c.accent, borderRadius: 4, fontSize: 10.5, padding: '1px 6px', margin: '0 2px', cursor: 'pointer' };
}
