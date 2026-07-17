const { createElement: h } = React;

export function SliderRow({ label, value, min, max, step, unit, color, onChange, c, displayPrecision = 2, resetTip }) {
    const dirty = Math.abs(value) > 1e-9;
    return h('div', {
        style: {
            display: 'grid',
            gridTemplateColumns: '110px 1fr 80px 18px',
            alignItems: 'center', gap: 8,
            padding: '4px 8px', borderBottom: `1px solid ${c.border}30`
        }
    },
        h('div', {
            title: label,
            style: {
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, color: c.text,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }
        },
            color && h('span', { style: {
                width: 9, height: 9, borderRadius: 2,
                background: color, flexShrink: 0,
                border: `1px solid ${c.border}`
            }}),
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, label)
        ),
        h('input', {
            type: 'range', min, max, step, value,
            onChange: (e) => onChange(parseFloat(e.target.value)),
            // Double-click the rail to snap back to zero — quick keyboard-free reset.
            onDoubleClick: () => onChange(0),
            style: { width: '100%', accentColor: c.accent, cursor: 'pointer' }
        }),
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 3, justifySelf: 'end',
                fontSize: 11, fontVariantNumeric: 'tabular-nums', color: c.textDim
            }
        },
            h('span', { style: { color: dirty ? c.accent : c.textDim } },
                (value >= 0 ? '+' : '') + value.toFixed(displayPrecision)),
            h('span', null, unit || '')
        ),
        // Per-row reset (×) — only clickable when this slider is off-baseline.
        // Renders an empty cell when at baseline so the grid alignment stays.
        h('button', {
            onClick: () => onChange(0),
            disabled: !dirty,
            title: resetTip || 'Reset to baseline',
            style: {
                width: 16, height: 16, padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent',
                border: `1px solid ${dirty ? c.border : 'transparent'}`,
                borderRadius: 3,
                color: dirty ? c.textDim : 'transparent',
                cursor: dirty ? 'pointer' : 'default',
                fontSize: 11, lineHeight: 1,
                outline: 'none',
                transition: 'color 0.1s, border-color 0.1s',
            },
            onMouseEnter: (e) => { if (dirty) { e.currentTarget.style.color = c.accent; e.currentTarget.style.borderColor = c.accent; } },
            onMouseLeave: (e) => { if (dirty) { e.currentTarget.style.color = c.textDim; e.currentTarget.style.borderColor = c.border; } },
        }, '×')
    );
}
