import { CURVE_BY_KEY } from './model.js';

const { createElement: h, useState, useEffect } = React;

export function FieldLabel({ children, c }) {
    return h('span', {
        style: { fontSize: 11, color: c.textDim, fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0 }
    }, children);
}

export function Divider({ c }) {
    return h('div', { style: { width: 1, height: 22, background: c.border, flexShrink: 0 } });
}

export function NumInput({ value, onChange, min, max, step = 1, c, width = 60 }) {
    const [raw, setRaw] = useState(String(value));
    useEffect(() => { setRaw(String(value)); }, [value]);
    const commit = () => {
        const parsed = parseFloat(raw);
        if (!isNaN(parsed)) onChange(Math.min(Math.max(parsed, min ?? -Infinity), max ?? Infinity));
        else setRaw(String(value));
    };
    return h('input', {
        type: 'number', value: raw, min, max, step,
        onChange: event => setRaw(event.target.value),
        onBlur: commit,
        onKeyDown: event => { if (event.key === 'Enter') commit(); },
        style: {
            width, height: 22, backgroundColor: c.panel, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '0 4px', outline: 'none', textAlign: 'right'
        }
    });
}

export function CurveGroup({ group, showCurves, onToggle, c, polLabels }) {
    return h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 } },
        h('span', { style: { fontSize: 11, fontWeight: 700, color: c.textDim, marginRight: 1 } }, group.q),
        group.members.map(member => {
            const curve = CURVE_BY_KEY[member.key];
            const active = !!showCurves[member.key];
            return h('button', {
                key: member.key,
                onClick: () => onToggle(member.key),
                title: curve.label,
                style: {
                    padding: '2px 6px', cursor: 'pointer', outline: 'none',
                    border: `1px solid ${active ? curve.color : c.border}`,
                    borderRadius: 3, backgroundColor: active ? curve.color + '22' : 'transparent',
                    color: active ? c.text : c.textDim,
                    fontSize: 11, fontWeight: active ? 600 : 400,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                },
            }, polLabels[member.pol]);
        }));
}

export function SegmentedButton({ item, activeId, onSelect, c, title }) {
    const active = activeId === item.id;
    return h('button', {
        onClick: () => onSelect(item.id),
        title: item.tip || title,
        style: {
            padding: '2px 8px', cursor: 'pointer', outline: 'none',
            border: `1px solid ${active ? c.accent : c.border}`,
            borderRadius: 3,
            backgroundColor: active ? c.accent + '22' : 'transparent',
            color: active ? c.accent : c.textDim,
            fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: active ? 600 : 400,
        }
    }, item.label);
}
