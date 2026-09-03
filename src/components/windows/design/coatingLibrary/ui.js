const { createElement: h } = React;

export const FONT = 'system-ui, -apple-system, sans-serif';

export function inputStyle(c, width) {
    return {
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, padding: '3px 6px', fontFamily: 'inherit',
        outline: 'none', boxSizing: 'border-box', ...(width ? { width } : {}),
    };
}

export function buttonStyle(c, { primary = false, disabled = false, danger = false } = {}) {
    return {
        background: primary ? c.accent : c.bg,
        color: primary ? '#fff' : danger ? c.error : c.text,
        border: `1px solid ${primary ? c.accent : c.border}`,
        borderRadius: 3, fontSize: 11, padding: '4px 12px', fontFamily: 'inherit',
        cursor: disabled ? 'default' : 'pointer', outline: 'none',
        opacity: disabled ? 0.45 : 1,
    };
}

/** Two or three mutually exclusive choices, drawn as one control. */
export function Segmented({ value, options, onChange, c, disabled }) {
    return h('div', {
        style: {
            display: 'inline-flex', border: `1px solid ${c.border}`, borderRadius: 3,
            overflow: 'hidden', opacity: disabled ? 0.5 : 1,
        },
    }, options.map(([key, label], i) => h('button', {
        key, disabled, onClick: () => onChange(key), 'aria-pressed': value === key,
        style: {
            padding: '3px 10px', fontSize: 11, fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer',
            border: 'none', borderLeft: i ? `1px solid ${c.border}` : 'none',
            background: value === key ? c.accent : c.bg,
            color: value === key ? '#fff' : c.text, outline: 'none',
        },
    }, label)));
}

export function SectionTitle({ c, children }) {
    return h('div', {
        style: {
            fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
            color: c.textDim, margin: '14px 0 6px',
        },
    }, children);
}

/** Label on the left, value on the right, on one line. */
export function KeyValue({ label, value, c, title }) {
    return h('div', {
        title,
        style: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '2px 0' },
    },
        h('span', { style: { color: c.textDim } }, label),
        h('span', { style: { fontVariantNumeric: 'tabular-nums', textAlign: 'right' } }, value));
}

export const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(2)} %` : '?';

/**
 * The angle and polarization something is stated at, as "45° s" or "0°".
 * Takes an entry or a qualifier (both carry `aoi`; entries name the
 * polarization `polarization`, qualifiers `pol`). The angle is always shown so
 * a coating meant for oblique use cannot be mistaken for a normal-incidence one.
 */
export function angleText(item, ts) {
    const pol = item.polarization ?? item.pol ?? 'avg';
    return pol === 'avg' ? `${item.aoi}°` : `${item.aoi}° ${ts.pols[pol] || pol}`;
}

// One hue per family, chosen to read on both themes and to sit with the
// ribbon's family colors.
export const TYPE_COLORS = {
    ar: '#1abc9c', mirror: '#e8943a', edge: '#a472d8', bandpass: '#4a90e2', notch: '#cf5fa0',
    beamsplitter: '#46b450', dichroic: '#e0653a', polarizer: '#6c7ae0', lowE: '#c9a227',
    chirped: '#b048b5', nd: '#8a94a6', other: '#7c8aa5',
};

// One hue per kind of tag (COATING_TAG_GROUPS), so a chip says what sort of
// thing it is before it is read.
export const TAG_GROUP_COLORS = {
    region: '#4a90e2', band: '#1abc9c', purpose: '#e8943a', function: '#cf5fa0',
    structure: '#a472d8', geometry: '#46b450', substrate: '#c9a227', context: '#7c8aa5',
};

/** A hex color with an alpha channel appended, for tinted backgrounds. */
export function alpha(hex, fraction) {
    return `${hex}${Math.round(fraction * 255).toString(16).padStart(2, '0')}`;
}

/** A small colored pill. With `onClick` it is a toggle; `active` fills it. */
export function Chip({ label, color, active = false, onClick, title, c }) {
    const style = {
        display: 'inline-block', fontSize: 11, fontFamily: 'inherit', lineHeight: '16px',
        padding: '0 8px', borderRadius: 9, whiteSpace: 'nowrap',
        border: `1px solid ${color}`,
        background: active ? color : alpha(color, 0.14),
        color: active ? '#fff' : c.text,
        cursor: onClick ? 'pointer' : 'default', outline: 'none',
    };
    return onClick
        ? h('button', { onClick, title, 'aria-pressed': active, style }, label)
        : h('span', { title, style }, label);
}

/** The family of an entry as a tinted label. */
export function TypeBadge({ type, ts }) {
    const color = TYPE_COLORS[type] || TYPE_COLORS.other;
    return h('span', {
        style: {
            display: 'inline-block', fontSize: 11, fontWeight: 600, lineHeight: '16px', padding: '0 8px',
            borderRadius: 3, background: alpha(color, 0.18), color, border: `1px solid ${alpha(color, 0.6)}`,
        },
    }, ts.types[type]);
}
