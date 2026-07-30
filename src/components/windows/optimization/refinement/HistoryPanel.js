// Design history strip at the bottom of the Refinement window: one row per
// completed run, each restorable back into the design.

const { createElement: h } = React;   // React is a window global

export function HistoryPanel({ entries, selectedId, onSelect, onRestore, c, t }) {
    const th = t.refinement.history;

    return h('div', {
        style: {
            borderTop: `1px solid ${c.border}`, background: c.panel,
            flexShrink: 0, maxHeight: 130, overflow: 'hidden',
            display: 'flex', flexDirection: 'column'
        }
    },
        h('div', {
            style: { padding: '3px 8px', fontSize: 10, fontWeight: 600, color: c.textDim, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }
        }, th.title),
        h('div', { style: { flex: 1, overflow: 'auto' } },
            entries.length === 0
                ? h('div', { style: { padding: '8px 10px', fontSize: 11, color: c.textDim, fontStyle: 'italic' } }, th.empty)
                : [...entries].reverse().map(entry => {
                    const hasPlot = !!entry.mfHistory?.length;
                    const selected = selectedId === entry.id;
                    return (
                    h('div', {
                        key: entry.id,
                        style: {
                            display: 'flex', alignItems: 'center', padding: '2px 8px',
                            borderBottom: `1px solid ${c.border}22`, gap: 8, fontSize: 11,
                            background: selected ? `${c.accent}18` : 'transparent',
                            boxShadow: selected ? `inset 2px 0 ${c.accent}` : 'none',
                        }
                    },
                        h('span', { style: { color: c.accent, fontWeight: 600, minWidth: 72 } }, entry.label),
                        h('span', { style: { color: c.textDim } }, `iter: ${entry.iter}`),
                        h('span', { style: { color: c.text, marginLeft: 4 } }, `MF: ${entry.mf.toFixed(6)}`),
                        h('span', { style: { color: c.textDim, marginLeft: 4 } }, `${entry.layerCount} layers`),
                        h('div', { style: { flex: 1 } }),
                        hasPlot && h('button', {
                            onClick: () => onSelect(entry),
                            style: {
                                padding: '1px 8px', fontSize: 10, border: `1px solid ${selected ? c.accent : c.border}`,
                                borderRadius: 2, background: selected ? `${c.accent}22` : c.panel,
                                color: selected ? c.accent : c.text, cursor: 'pointer', fontFamily: 'inherit'
                            }
                        }, th.plot || 'Plot'),
                        h('button', {
                            onClick: () => onRestore(entry),
                            style: {
                                padding: '1px 8px', fontSize: 10, border: `1px solid ${c.border}`,
                                borderRadius: 2, background: c.panel, color: c.text,
                                cursor: 'pointer', fontFamily: 'inherit'
                            }
                        }, th.restore)
                    )
                    );
                })
        )
    );
}
