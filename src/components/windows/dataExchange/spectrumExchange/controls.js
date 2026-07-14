import { Checkbox } from '../../../ui/Checkbox.js';

const { createElement: h, useState } = React;

export const FAMILY_COLOR = { R: '#ef5350', T: '#2196f3', A: '#66bb6a' };

export function Btn({ onClick, c, children, disabled, primary }) {
    return h('button', {
        onClick, disabled,
        style: {
            padding: '5px 12px', fontSize: 11.5, cursor: disabled ? 'not-allowed' : 'pointer',
            border: `1px solid ${primary && !disabled ? c.accent : c.border}`, borderRadius: 4,
            background: primary && !disabled ? c.accent + '22' : 'transparent',
            color: disabled ? c.textDim : (primary ? c.accent : c.text),
            fontWeight: primary ? 600 : 400, opacity: disabled ? 0.55 : 1, whiteSpace: 'nowrap',
        },
    }, children);
}

export function TabBtn({ active, onClick, c, children }) {
    return h('button', {
        onClick,
        style: {
            padding: '8px 18px', fontSize: 12, cursor: 'pointer', outline: 'none',
            border: 'none', borderBottom: `2px solid ${active ? c.accent : 'transparent'}`,
            background: 'transparent', color: active ? c.accent : c.text,
            fontWeight: active ? 600 : 400,
        },
    }, children);
}

export function Seg({ active, onClick, c, position, children }) {
    const radius = position === 'first' ? '4px 0 0 4px' : position === 'last' ? '0 4px 4px 0' : '0';
    return h('button', {
        onClick,
        style: {
            padding: '4px 10px', fontSize: 11, cursor: 'pointer', outline: 'none',
            border: `1px solid ${active ? c.accent : c.border}`, borderRadius: radius,
            marginLeft: position === 'first' ? 0 : -1,
            background: active ? c.accent + '33' : 'transparent',
            color: active ? c.accent : c.text, fontWeight: active ? 600 : 400,
            position: 'relative', zIndex: active ? 1 : 0, whiteSpace: 'nowrap',
        },
    }, children);
}

export function Label({ children, c }) {
    return h('span', {
        style: { fontSize: 10, color: c.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' },
    }, children);
}

function normalizedNumber(raw, value, min, max) {
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) return { value, valid: false };
    return {
        value: Math.min(Math.max(parsed, min ?? -Infinity), max ?? Infinity),
        valid: true,
    };
}

export function Num({ value, onChange, min, max, step = 1, c, width = 70 }) {
    const [raw, setRaw] = useState(String(value));
    React.useEffect(() => { setRaw(String(value)); }, [value]);
    const commit = () => {
        const normalized = normalizedNumber(raw, value, min, max);
        if (normalized.valid) onChange(normalized.value);
        setRaw(String(normalized.value));
    };
    return h('input', {
        type: 'number', value: raw, min, max, step,
        onChange: (e) => setRaw(e.target.value), onBlur: commit,
        onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur(); },
        style: {
            width, height: 24, background: c.bg, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 5px',
            outline: 'none', textAlign: 'right',
        },
    });
}

export function Check({ checked, onChange, c, children }) {
    return h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: c.text, cursor: 'pointer' } },
        h(Checkbox, { c, checked, onChange: (e) => onChange(e.target.checked) }),
        children,
    );
}
