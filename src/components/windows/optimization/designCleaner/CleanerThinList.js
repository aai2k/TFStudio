const { createElement: h } = React;

export function CleanerThinList({ c, dc, thinList }) {
    return h('div', {
        style: { flex: '0 0 280px', minHeight: 0, overflowY: 'auto' }
    },
        h('div', {
            style: {
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                color: c.textDim, background: c.panel + '55',
                borderBottom: `1px solid ${c.border}`, position: 'sticky', top: 0,
            },
            title: dc.thinListTip,
        }, dc.thinList + ` (${thinList.length})`),
        thinList.length === 0
            ? h('div', { style: { padding: 16, color: c.textDim, fontStyle: 'italic', textAlign: 'center' } },
                dc.noThin)
            : h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                h('tbody', null, thinList.map((l, i) => h('tr', {
                    key: i,
                    style: { background: i % 2 === 0 ? 'transparent' : c.panel + '33' }
                },
                    h('td', { style: { padding: '2px 8px', color: c.text, fontSize: 11 } },
                        `${l.side === 'front' ? 'F' : 'B'}${l.layerIndex + 1}`),
                    h('td', { style: { padding: '2px 8px', color: c.text, fontSize: 11 } }, l.materialId),
                    h('td', {
                        style: { padding: '2px 8px', color: c.textDim, fontSize: 11,
                            textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
                    }, l.thickness.toFixed(3) + ' nm'),
                )))
            )
    );
}
