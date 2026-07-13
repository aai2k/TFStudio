const { createElement: h, useEffect, useState } = React;

function numberInputStyle(c, width) {
    return {
        width, height: 22, backgroundColor: c.panel, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        fontSize: 12, padding: '0 4px', outline: 'none', textAlign: 'right',
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
}

function NumInput({ value, onChange, min, max, step = 1, c, width = 68 }) {
    const [raw, setRaw] = useState(String(value));
    useEffect(() => { setRaw(String(value)); }, [value]);
    const commit = () => {
        const v = parseFloat(raw);
        if (!isNaN(v)) onChange(Math.min(Math.max(v, min ?? -Infinity), max ?? Infinity));
        else setRaw(String(value));
    };
    return h('input', {
        type: 'number', value: raw, min, max, step,
        onChange: e => setRaw(e.target.value),
        onBlur: commit,
        onKeyDown: e => { if (e.key === 'Enter') commit(); },
        style: numberInputStyle(c, width),
    });
}

function PolBtn({ label, active, onClick, c }) {
    return h('button', {
        onClick,
        style: {
            padding: '2px 8px', fontSize: 11, cursor: 'pointer', outline: 'none',
            border: `1px solid ${active ? c.accent : c.border}`,
            borderRadius: 3, backgroundColor: active ? c.accent + '33' : 'transparent',
            color: active ? c.accent : c.textDim, userSelect: 'none',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: active ? 600 : 400, flexShrink: 0,
        },
    }, label);
}

function LayerLegend({ validLayers, matColorMap, matName, c }) {
    if (validLayers.length === 0) {
        return h('div', { style: { fontSize: 11, color: c.textDim } }, 'No layers');
    }
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
        validLayers.map((l, i) => h('div', {
            key: l.id || i,
            style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 },
        },
        h('div', {
            style: {
                width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                backgroundColor: matColorMap[l.material] || '#888',
                border: `1px solid ${c.border}`,
            },
        }),
        h('span', { style: { color: c.textDim, minWidth: 18, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, i + 1),
        h('span', {
            style: { color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 },
        }, matName[l.material] || '—'))));
}

function AdmittanceReadout({ Y0, etaS, c, secHead }) {
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: secHead }, 'Admittance'),
        Y0
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                h('div', { style: { fontSize: 10, color: c.textDim } }, 'Y₀ (final)'),
                h('div', { style: { fontSize: 11, color: c.text, fontVariantNumeric: 'tabular-nums' } },
                    `${Y0[0].toFixed(4)} ${Y0[1] >= 0 ? '+' : '−'} ${Math.abs(Y0[1]).toFixed(4)}i`),
                h('div', { style: { fontSize: 10, color: c.textDim, marginTop: 3 } }, 'η_s (substrate)'),
                h('div', { style: { fontSize: 11, color: c.text, fontVariantNumeric: 'tabular-nums' } },
                    etaS
                        ? `${etaS[0].toFixed(4)} ${etaS[1] >= 0 ? '+' : '−'} ${Math.abs(etaS[1]).toFixed(4)}i`
                        : '—'))
            : h('div', { style: { fontSize: 11, color: c.textDim } }, '—'));
}

export function AdmittanceControls({
    c, side, setSide, frontLbl, backLbl, lambda, setLambda, theta, setTheta, pol, setPol,
    validLayers, matColorMap, matName, Y0, etaS,
}) {
    const sideStyle = {
        width: 176, minWidth: 140, flexShrink: 0,
        borderRight: `1px solid ${c.border}`,
        display: 'flex', flexDirection: 'column', gap: 10,
        padding: '10px 10px', overflowY: 'auto',
        backgroundColor: c.panel,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const secHead = {
        fontSize: 10, fontWeight: 700, color: c.textDim,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        marginBottom: 2, userSelect: 'none',
    };
    const row = (label, children) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: secHead }, label), children);

    return h('div', { style: sideStyle },
        row('Side', h('div', { style: { display: 'flex', gap: 4 } },
            h(PolBtn, { label: frontLbl, active: side === 'front', onClick: () => setSide('front'), c }),
            h(PolBtn, { label: backLbl, active: side === 'back', onClick: () => setSide('back'), c }))),
        row('Wavelength', h('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
            h(NumInput, { value: lambda, onChange: setLambda, min: 100, max: 30000, step: 1, c }),
            h('span', { style: { fontSize: 11, color: c.textDim } }, 'nm'))),
        row('AOI', h('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
            h(NumInput, { value: theta, onChange: setTheta, min: 0, max: 89, step: 0.5, c }),
            h('span', { style: { fontSize: 11, color: c.textDim } }, '°'))),
        row('Polarization', h('div', { style: { display: 'flex', gap: 4 } },
            h(PolBtn, { label: 'avg', active: pol === 'avg', onClick: () => setPol('avg'), c }),
            h(PolBtn, { label: 's', active: pol === 's', onClick: () => setPol('s'), c }),
            h(PolBtn, { label: 'p', active: pol === 'p', onClick: () => setPol('p'), c }))),
        h('div', { style: { borderTop: `1px solid ${c.border}` } }),
        row('Layers', h(LayerLegend, { validLayers, matColorMap, matName, c })),
        h('div', { style: { borderTop: `1px solid ${c.border}` } }),
        h(AdmittanceReadout, { Y0, etaS, c, secHead }));
}
