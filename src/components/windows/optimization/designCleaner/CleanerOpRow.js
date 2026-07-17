const { createElement: h } = React;

export function CleanerOpRow({ op, i, c, dc, dMin }) {
    return h('tr', {
        style: { background: i % 2 === 0 ? 'transparent' : c.panel + '33' }
    },
        h('td', { style: { padding: '2px 8px', color: c.textDim, fontSize: 11 } }, i + 1),
        h('td', { style: { padding: '2px 8px', color: c.text, fontSize: 11 } },
            op.side === 'front' ? 'F' : 'B'),
        h('td', { style: { padding: '2px 8px', color: c.text, fontSize: 11 } },
            `${op.side === 'front' ? 'F' : 'B'}${op.srcIdx + 1}`),
        h('td', { style: { padding: '2px 8px', fontSize: 11,
            color: op.kind === 'remove' ? '#ef5350' : '#ffd54f', fontWeight: 600 } },
            op.kind === 'remove' ? dc.opRemove : dc.opMerge),
        h('td', { style: { padding: '2px 8px', color: c.text, fontSize: 11 } }, op.materialId),
        h('td', {
            style: { padding: '2px 8px', color: c.text, fontSize: 11,
                textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
        }, op.thickness.toFixed(3) + ' nm'),
        h('td', { style: { padding: '2px 8px', color: c.textDim, fontSize: 11, textAlign: 'right' } },
            op.kind === 'merge'
                ? `→ ${op.side === 'front' ? 'F' : 'B'}${op.mergedInto + 1}`
                : `< ${dMin.toFixed(1)} nm`)
    );
}
