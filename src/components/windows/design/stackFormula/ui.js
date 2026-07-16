const { createElement: h } = React;

export function SideSeg({ value, onChange, disabled, c, sf }) {
    const opts = [['front', sf.sideFront], ['back', sf.sideBack], ['both', sf.sideBoth]];
    return h('div', {
        style: { display: 'flex', border: `1px solid ${c.border}`, borderRadius: 4,
                 overflow: 'hidden', opacity: disabled ? 0.5 : 1 }
    },
        opts.map(([v, l], i) => h('button', {
            key: v, disabled, onClick: () => onChange(v),
            style: {
                padding: '5px 11px', fontSize: 12, cursor: disabled ? 'default' : 'pointer',
                border: 'none', borderLeft: i ? `1px solid ${c.border}` : 'none',
                backgroundColor: value === v ? c.accent : c.bg,
                color: value === v ? '#fff' : c.text, outline: 'none',
            }
        }, l))
    );
}

export function FooterBtn({ onClick, disabled, primary, title, children, c }) {
    return h('button', {
        onClick, disabled, title,
        style: {
            padding: '8px 18px', fontSize: 13, fontWeight: primary ? 600 : 400,
            backgroundColor: disabled ? c.border : (primary ? c.accent : c.bg),
            color: primary ? '#fff' : c.text,
            border: primary ? 'none' : `1px solid ${c.border}`, borderRadius: 4,
            cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
        }
    }, children);
}
