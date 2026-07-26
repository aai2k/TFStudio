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
        if (raw === String(value)) return;
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
            width, height: 24, backgroundColor: c.field, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '0 4px', outline: 'none', textAlign: 'right'
        }
    });
}

export function CurveGroup({ group, showCurves, onToggle, c, polLabels }) {
    const groupColor = CURVE_BY_KEY[group.members[0].key].color;
    const activeFill = groupColor + (c.light ? '20' : '38');
    return h('div', {
        style: {
            display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0,
            height: 28, padding: '0 3px 0 8px', border: `1px solid ${c.border}`,
            borderRadius: 7, backgroundColor: c.bg
        }
    },
        h('span', { style: { width: 8, height: 8, borderRadius: '50%', backgroundColor: groupColor, marginRight: 3 } }),
        h('span', { style: { fontSize: 12, fontWeight: 700, color: c.text, marginRight: 2 } }, group.q),
        group.members.map(member => {
            const curve = CURVE_BY_KEY[member.key];
            const active = !!showCurves[member.key];
            return h('button', {
                key: member.key,
                onClick: () => onToggle(member.key),
                title: curve.label,
                'aria-pressed': active,
                style: {
                    height: 22, padding: '0 7px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', outline: 'none', border: 'none', lineHeight: 1,
                    borderRadius: 4, backgroundColor: active ? activeFill : 'transparent',
                    color: active ? c.text : c.textDim,
                    fontSize: 11, fontWeight: 500,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                },
            }, polLabels[member.pol]);
        }));
}

export function SegmentedButton({ item, activeId, onSelect, c, title }) {
    const active = activeId === item.id;
    const activeFill = c.accent + (c.light ? '20' : '38');
    return h('button', {
        onClick: () => onSelect(item.id),
        title: item.tip || title,
        'aria-pressed': active,
        style: {
            height: 24, padding: '0 8px', cursor: 'pointer', outline: 'none', border: 'none',
            borderRadius: 4,
            backgroundColor: active ? activeFill : 'transparent',
            color: active ? c.text : c.textDim,
            fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 500,
        }
    }, item.label);
}
