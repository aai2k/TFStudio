const { createElement: h } = React;

// Bar colour by material (H dark, L light) and role: the V-coat AR layers are
// highlighted purple and the spacers carry the deeper shade of their material.
const COLORS = {
    ar:     { H: '#7e57c2', L: '#b39ddb' },
    spacer: { H: '#37474f', L: '#90a4ae' },
    mirror: { H: '#455a64', L: '#cfd8dc' },
};

function layerColor(l) {
    return (COLORS[l.role] || COLORS.mirror)[l.tag === 'H' ? 'H' : 'L'];
}

// layers: engine layers [{tag, role, order, d}]. Width is proportional to thickness.
export function StackBar({ layers, c, height = 26 }) {
    if (!layers || !layers.length) return null;
    const total = layers.reduce((s, l) => s + (l.d || 0), 0) || 1;
    return h('div', {
        style: { display: 'flex', width: '100%', height, border: `1px solid ${c.border}`, borderRadius: 3, overflow: 'hidden' },
    }, layers.map((l, i) => h('div', {
        key: i,
        title: `${l.tag}${l.order ? ` order ${l.order}` : ''}  ${(l.d || 0).toFixed(1)} nm`,
        style: { width: `${100 * (l.d || 0) / total}%`, backgroundColor: layerColor(l), borderRight: i < layers.length - 1 ? '0.5px solid rgba(255,255,255,0.15)' : 'none' },
    })));
}
