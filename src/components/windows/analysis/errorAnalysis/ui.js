const { createElement: h } = React;

export function placeholder(c, msg) {
    return h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, msg);
}

export function chip(txt, color, tip, key) {
    return h('span', {
        key, title: tip,
        style: {
            fontSize: 10, fontWeight: 600, color,
            padding: '1px 6px', borderRadius: 9,
            background: `${color}1a`, border: `1px solid ${color}55`,
            whiteSpace: 'nowrap',
        }
    }, txt);
}

export function tableStyles(c) {
    return {
        th: {
            padding: '3px 8px', fontWeight: 600, fontSize: 11, color: c.textDim,
            textAlign: 'right', position: 'sticky', top: 0, background: c.panel,
            borderBottom: `1px solid ${c.border}`, whiteSpace: 'nowrap',
        },
        td: {
            padding: '2px 8px', fontSize: 11, textAlign: 'right',
            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        },
    };
}
