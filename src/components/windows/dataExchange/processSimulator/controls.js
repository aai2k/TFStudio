const { createElement: h, useState, useEffect } = React;

export function SegBtn({ active, onClick, c, position, children, disabled, flex }) {
    const radius = position === 'first' ? '4px 0 0 4px'
        : position === 'last' ? '0 4px 4px 0'
        : '0';
    return h('button', {
        onClick, disabled,
        style: {
            padding: '4px 10px', fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer', outline: 'none',
            border: `1px solid ${active ? c.accent : c.border}`,
            borderRadius: radius,
            marginLeft: position === 'first' ? 0 : -1,
            backgroundColor: active ? c.accent + '33' : 'transparent',
            color: active ? c.accent : (disabled ? c.textDim : c.text),
            fontWeight: active ? 600 : 400, flexShrink: 0,
            position: 'relative', zIndex: active ? 1 : 0,
            flex: flex || 'unset',
            opacity: disabled ? 0.5 : 1,
            whiteSpace: 'nowrap',
        },
    }, children);
}

export function NumInput({ value, onChange, min, max, step = 1, c, width = 70 }) {
    const [raw, setRaw] = useState(String(value));
    useEffect(() => { setRaw(String(value)); }, [value]);
    const commit = () => {
        const parsed = parseFloat(raw);
        if (!isNaN(parsed)) {
            const clamped = Math.min(Math.max(parsed, min ?? -Infinity), max ?? Infinity);
            onChange(clamped);
            setRaw(String(clamped));
        } else {
            setRaw(String(value));
        }
    };
    return h('input', {
        type: 'number', value: raw, min, max, step,
        onChange: event => setRaw(event.target.value),
        onBlur: commit,
        onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur(); },
        style: {
            width, height: 24,
            backgroundColor: c.bg, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            fontSize: 11, padding: '0 5px', outline: 'none', textAlign: 'right',
        },
    });
}

export function FieldLabel({ children, c }) {
    return h('span', {
        style: {
            fontSize: 10, color: c.textDim, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.4px',
            whiteSpace: 'nowrap', flexShrink: 0,
        },
    }, children);
}

export function Divider({ c }) {
    return h('div', {
        style: { width: 1, height: 18, background: c.border, flexShrink: 0, margin: '0 6px' },
    });
}
