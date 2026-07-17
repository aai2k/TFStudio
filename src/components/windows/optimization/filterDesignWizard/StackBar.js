const { createElement: h } = React;

// Bar colour by layer role: V-coat AR highlighted (purple), spacer by kind
// (H/L), mirror layers dark/light gray by index.
function layerColor(l) {
    if (l.tag === 'ar') return l.arMat === 'H' ? '#7e57c2' : '#b39ddb';
    if (l.tag === 'spacer') return l.spacerKind === 'H' ? '#37474f' : '#90a4ae';
    if (l.tag === 'H') return '#455a64';
    return '#cfd8dc';
}

// layers: engine layers [{tag, d, arMat}] — width ∝ thickness, colour by index/role.
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
