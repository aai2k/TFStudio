import { MaterialPicker } from '../../../ui/MaterialPicker.js';

const { createElement: h, useState } = React;

// ── Small UI helpers ──────────────────────────────────────────────────────────

export function Btn({ onClick, title, disabled, children, c, style = {} }) {
    const [hov, setHov] = useState(false);
    return h('button', {
        onClick, title, disabled,
        onMouseEnter: () => setHov(true),
        onMouseLeave: () => setHov(false),
        style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: '3px 9px', border: `1px solid ${c.border}`, borderRadius: 3,
            backgroundColor: disabled ? 'transparent' : hov ? c.hover : c.panel,
            color: disabled ? c.textDim : c.text, cursor: disabled ? 'default' : 'pointer',
            fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
            outline: 'none', gap: 4, flexShrink: 0,
            opacity: disabled ? 0.45 : 1,
            ...style
        }
    }, children);
}

export function IconBtn({ onClick, title, disabled, children, c }) {
    const [hov, setHov] = useState(false);
    return h('button', {
        onClick, title, disabled,
        onMouseEnter: () => setHov(true),
        onMouseLeave: () => setHov(false),
        style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 24, height: 24, border: 'none', borderRadius: 3, padding: 0,
            backgroundColor: hov && !disabled ? c.hover : 'transparent',
            color: disabled ? c.textDim : c.text, cursor: disabled ? 'default' : 'pointer',
            fontSize: 14, outline: 'none', opacity: disabled ? 0.4 : 1, flexShrink: 0
        }
    }, children);
}

export function Label({ text, c, width }) {
    return h('div', {
        style: { fontSize: 11, color: c.textDim, whiteSpace: 'nowrap', width: width || 'auto', flexShrink: 0 }
    }, text);
}

export function Sep({ c }) {
    return h('div', { style: { height: 1, background: c.border, margin: '6px 0' } });
}

// ── Medium selector row ───────────────────────────────────────────────────────

export function MediaRow({ label, materialId, onChange, c, t }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' } },
        h(Label, { text: label, c, width: 110 }),
        h(MaterialPicker, { value: materialId, onChange, c, t })
    );
}

// Compact medium picker: small label stacked above a compact MaterialPicker, so
// the three media (incident / substrate / exit) fit on ONE 3-column row instead
// of three stacked rows. Used in the (collapsible) Design-Editor settings.
export function MediaCol({ label, materialId, onChange, c, t }) {
    return h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
        h('div', {
            title: label,
            style: { fontSize: 10, color: c.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        }, label),
        h('div', { style: { minWidth: 0 } },
            h(MaterialPicker, { value: materialId, onChange, c, t, compact: true })
        )
    );
}
