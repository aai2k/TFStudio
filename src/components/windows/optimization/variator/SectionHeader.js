const { createElement: h } = React;

export function SectionHeader({ label, c, count }) {
    return h('div', {
        style: {
            padding: '5px 10px 4px',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: c.textDim,
            background: c.panel,
            borderTop: `1px solid ${c.border}`, borderBottom: `1px solid ${c.border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }
    },
        h('span', null, label),
        count != null && h('span', { style: { color: c.textDim, opacity: 0.7 } }, `${count}`)
    );
}
