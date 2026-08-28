const { createElement: h } = React;

// Tabs are Data Exchange navigation rather than analysis settings, so this is
// the one control that remains local to the window.
export function TabBtn({ active, onClick, c, children }) {
    return h('button', {
        type: 'button', onClick, 'aria-pressed': active,
        style: {
            height: 28, padding: '0 12px', border: 'none', borderRadius: 5,
            borderBottom: `2px solid ${active ? c.accent : 'transparent'}`,
            outline: 'none', cursor: 'pointer', background: active ? c.accent + '20' : 'transparent',
            color: active ? c.text : c.textDim, fontSize: 11, fontWeight: active ? 600 : 500,
            fontFamily: 'system-ui, -apple-system, sans-serif',
        },
    }, children);
}
