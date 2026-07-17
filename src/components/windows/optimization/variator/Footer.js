const { createElement: h } = React;

export function Footer({ c, v, design, anyVaried }) {
    return h('div', {
        style: {
            padding: '3px 10px', borderTop: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 12,
            fontSize: 11, color: c.textDim
        }
    },
        h('span', null, design.name),
        h('span', null, `${(design.frontLayers || []).length}F / ${(design.backLayers || []).length}B`),
        anyVaried && h('span', { style: { color: c.accent } },
            v.modifiedTip || 'Live preview — Ctrl+Z reverts to baseline')
    );
}
