const { createElement: h, useEffect, useRef, useState } = React;

function tabButtonStyle(c, active) {
    return {
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
}

function NumInput({ field, c }) {
    const [raw, setRaw] = useState(String(field.value));
    const editingRef = useRef(false);
    useEffect(() => {
        if (!editingRef.current) setRaw(String(field.value));
    }, [field.value]);
    const commit = () => {
        editingRef.current = false;
        const value = parseFloat(raw);
        if (isFinite(value)) {
            const clamped = Math.max(field.min, Math.min(field.max, value));
            field.setValue(clamped);
            setRaw(String(clamped));
        } else {
            setRaw(String(field.value));
        }
    };
    return h('input', {
        type: 'text', inputMode: 'decimal', value: raw,
        onFocus: () => { editingRef.current = true; },
        onChange: event => setRaw(event.target.value),
        onBlur: commit,
        onKeyDown: event => {
            if (event.key === 'Enter') { event.target.blur(); }
            else if (event.key === 'Escape') { setRaw(String(field.value)); editingRef.current = false; event.target.blur(); }
        },
        style: {
            background: c.inputBg || c.hover, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            padding: '1px 4px', fontSize: 12, width: field.width || 58,
            marginLeft: 6,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            outline: 'none', textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
        },
    });
}

function NumericField({ field, labelStyle, c }) {
    return h('label', { style: labelStyle }, field.label,
        h(NumInput, { field, c }),
    );
}

function ButtonGroup({ items, c }) {
    return items.map(item => h('button', {
        key: item.value,
        onClick: item.onClick,
        style: tabButtonStyle(c, item.active),
    }, item.label));
}

function labeledButtons(label, items, labelStyle, c) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
        h('span', { style: { ...labelStyle, marginRight: 3 } }, label + ':'),
        h(ButtonGroup, { items, c }),
    );
}

function controlGroups(state, text) {
    return {
        mode: [
            { value: 'spectral', label: text.spectral, active: state.mode === 'spectral', onClick: () => state.setMode('spectral') },
            { value: 'angular', label: text.angular, active: state.mode === 'angular', onClick: () => state.setMode('angular') },
        ],
        side: [
            { value: 'front', label: text.modeFront || 'Front', active: state.side === 'front', onClick: () => state.setSide('front') },
            { value: 'back', label: text.modeBack || 'Back', active: state.side === 'back', onClick: () => state.setSide('back') },
        ],
        delta: [
            { value: 'woollam', label: text.deltaWoollam || 'Woollam', active: state.deltaConvention === 'woollam', onClick: () => state.setDeltaConvention('woollam') },
            { value: 'azzam', label: text.deltaAzzam || 'Azzam–Bashara', active: state.deltaConvention === 'azzam', onClick: () => state.setDeltaConvention('azzam') },
        ],
    };
}

function numericFields(state, text) {
    if (state.mode === 'spectral') {
        return [
            { key: 'lamStart', label: text.lamStart, value: state.lambdaStart, setValue: state.setLambdaStart, min: 100, max: 30000, step: 10 },
            { key: 'lamEnd', label: text.lamEnd, value: state.lambdaEnd, setValue: state.setLambdaEnd, min: 100, max: 30000, step: 10 },
            { key: 'lamStep', label: text.lamStep, value: state.lambdaStep, setValue: state.setLambdaStep, min: 0.1, max: 1000, step: 1, width: 46 },
            { key: 'aoi', label: text.aoi, value: state.thetaDeg, setValue: state.setThetaDeg, min: 0, max: 89, step: 1, width: 46 },
        ];
    }
    return [
        { key: 'wavelength', label: text.wavelength, value: state.lambdaNm, setValue: state.setLambdaNm, min: 100, max: 30000, step: 10 },
        { key: 'aoiStart', label: text.aoiStart, value: state.angleStart, setValue: state.setAngleStart, min: 0, max: 89.5, step: 1, width: 46 },
        { key: 'aoiEnd', label: text.aoiEnd, value: state.angleEnd, setValue: state.setAngleEnd, min: 0, max: 89.5, step: 1, width: 46 },
        { key: 'aoiStep', label: text.aoiStep, value: state.angleStep, setValue: state.setAngleStep, min: 0.05, max: 45, step: 0.5, width: 46 },
    ];
}

export function EllipsometryControls({ c, text, state, summary }) {
    const labelStyle = {
        color: c.textDim, fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap',
    };
    const groups = controlGroups(state, text);

    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
            padding: '5px 8px', borderBottom: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexWrap: 'wrap',
        },
    },
        labeledButtons(text.mode, groups.mode, labelStyle, c),
        labeledButtons(text.side || 'Side', groups.side, labelStyle, c),
        labeledButtons(text.deltaConv || 'Δ convention', groups.delta, labelStyle, c),
        numericFields(state, text).map(field => h(NumericField, { key: field.key, field, labelStyle, c })),
        h('span', { style: { ...labelStyle, marginLeft: 'auto', color: c.text } },
            `${text.layersLabel}: ${summary.validLayers.length}  |  ${text.totalThk}: ${summary.totalThickness.toFixed(1)} nm`,
        ),
    );
}
