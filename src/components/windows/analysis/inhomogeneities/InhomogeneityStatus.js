const { createElement: h } = React;

export function BackLayerStatus({ show, c, ih }) {
    if (!show) return null;
    return h('div', {
        style: {
            padding: '6px 12px', background: '#5a4a1a', color: '#ffe08a',
            borderBottom: `1px solid ${c.border}`, fontSize: 11, flexShrink: 0,
        }
    }, ih.noBackLayers || 'This evaluation includes the back coating, but the design has no back layers. Add a back coating in the Design Editor to grade its interfaces.');
}

export function HelpStatus({ c, ih }) {
    return h('div', {
        style: {
            padding: '8px', fontSize: 10, color: c.textDim, lineHeight: 1.5,
            borderTop: `1px solid ${c.border}`,
        }
    }, ih.helpText ||
        'Each interlayer is sliced into N sub-layers with linearly-mixed n,k (Macleod-Marseille, §"Inhomogeneous Layers"). Thickness adds at the interface — host layers are not shortened.');
}

export function ErrorStatus({ error }) {
    if (!error) return null;
    return h('div', {
        style: {
            position: 'absolute', top: 8, left: 8, right: 8,
            padding: '6px 10px', background: '#5a1a1a', color: '#fff',
            border: '1px solid #a33', borderRadius: 4, fontSize: 11, zIndex: 5,
        }
    }, error);
}
