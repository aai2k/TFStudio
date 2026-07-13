const { createElement: h } = React;

export function EFieldControls({ c, ef, state, summary }) {
    const { lambda, lambdaStr, theta, pol, side } = state;
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
    const polBtnStyle = (active) => ({
        padding: '2px 10px', background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    const commitLambda = e => {
        const v = parseFloat(e.target.value);
        const clamped = isNaN(v) ? lambda : Math.max(100, Math.min(10000, v));
        state.setLambda(clamped);
        state.setLambdaStr(String(clamped));
    };

    return h('div', { style: {
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        padding: '5px 8px', borderBottom: `1px solid ${c.border}`,
        backgroundColor: c.panel, flexWrap: 'wrap',
    } },
        h('label', { style: labelStyle }, ef.wavelength,
            h('input', {
                type: 'number', min: 100, max: 10000, step: 10, value: lambdaStr,
                onChange: e => state.setLambdaStr(e.target.value), onBlur: commitLambda,
                onKeyDown: e => { if (e.key === 'Enter') e.target.blur(); },
                style: { ...inputStyle, marginLeft: 6 },
            })
        ),
        h('label', { style: labelStyle }, ef.aoi,
            h('input', {
                type: 'number', min: 0, max: 89, step: 1, value: theta,
                onChange: e => state.setTheta(Math.max(0, Math.min(89, parseFloat(e.target.value) || 0))),
                style: { ...inputStyle, width: 48, marginLeft: 6 },
            })
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
            h('span', { style: { ...labelStyle, marginRight: 3 } }, ef.polarization + ':'),
            ['s', 'p', 'avg'].map(p => h('button', {
                key: p, onClick: () => state.setPol(p), style: polBtnStyle(pol === p),
            }, p === 's' ? ef.polS : p === 'p' ? ef.polP : ef.polAvg))
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
            h('span', { style: { ...labelStyle, marginRight: 3 } }, (ef.side || 'Side') + ':'),
            [['front', ef.front || 'Front'], ['back', ef.back || 'Back']].map(([s, lbl]) =>
                h('button', { key: s, onClick: () => state.setSide(s), style: polBtnStyle(side === s) }, lbl))
        ),
        h('span', { style: { ...labelStyle, marginLeft: 'auto', color: c.text } },
            `${ef.maxLabel}: ${summary.maxE2pct}%  |  ${ef.layersLabel}: ${summary.layerCount}  |  ` +
            `${ef.totalThk}: ${summary.totalThkNm} nm`)
    );
}
