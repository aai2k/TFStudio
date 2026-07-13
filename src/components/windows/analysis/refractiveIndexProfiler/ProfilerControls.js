const { createElement: h } = React;

export function ProfilerControls({ c, rp, state, summary }) {
    const { lambda, lambdaStr, quantity, side, setLambda, setLambdaStr, setQuantity, setSide } = state;
    const labelStyle = {
        color: c.textDim, fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap',
    };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 12, width: 64,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const segBtnStyle = (active) => ({
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
            padding: '5px 8px', borderBottom: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexWrap: 'wrap',
        },
    },
        h('label', { style: labelStyle }, rp.wavelength,
            h('input', {
                type: 'number', min: 100, max: 10000, step: 10,
                value: lambdaStr,
                onChange: e => setLambdaStr(e.target.value),
                onBlur: e => {
                    const v = parseFloat(e.target.value);
                    const clamped = isNaN(v) ? lambda : Math.max(100, Math.min(10000, v));
                    setLambda(clamped);
                    setLambdaStr(String(clamped));
                },
                onKeyDown: e => { if (e.key === 'Enter') e.target.blur(); },
                style: { ...inputStyle, marginLeft: 6 },
            })
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
            h('span', { style: { ...labelStyle, marginRight: 3 } }, rp.quantity + ':'),
            ['n', 'k', 'both'].map(q =>
                h('button', { key: q, onClick: () => setQuantity(q), style: segBtnStyle(quantity === q) },
                    q === 'n' ? rp.qN : q === 'k' ? rp.qK : rp.qBoth
                )
            )
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
            h('button', { onClick: () => setSide('front'), style: segBtnStyle(side === 'front') },
                rp.front || 'Front'),
            h('button', { onClick: () => setSide('back'), style: segBtnStyle(side === 'back') },
                rp.back || 'Back'),
            h('button', { onClick: () => setSide('total'), style: segBtnStyle(side === 'total') },
                rp.total || 'Total')
        ),
        h('span', { style: { ...labelStyle, marginLeft: 'auto', color: c.text } },
            `${rp.nRange}: ${summary.nRangeStr}  |  ${rp.layersLabel}: ${summary.layerCount}  |  ` +
            `${rp.totalThk}: ${summary.totalThkStr} nm  |  ${rp.optThk}: ${summary.optThkStr} nm`
        )
    );
}
