import { DebouncedInput } from '../../../ui/DebouncedInput.js';

const { createElement: h } = React;

export function NumberInput({ value, onChange, step = 0.001, min, max, width = 64, c }) {
    return h(DebouncedInput, {
        value: String(Number.isFinite(value) ? value : 0),
        onChange: (v) => {
            const s = String(v).trim();
            const n = s === '' ? 0 : parseFloat(v);
            onChange(Number.isFinite(n) ? n : 0);
        },
        style: {
            background: c.inputBg || c.hover, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            padding: '1px 4px', fontSize: 12, width,
            fontFamily: 'system-ui, -apple-system, sans-serif',
        }
    });
}

export function UnitSelect({ value, onChange, c, title }) {
    return h('select', {
        value, onChange: (e) => onChange(e.target.value), title,
        style: {
            background: c.inputBg || c.hover, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            padding: '1px 2px', fontSize: 11, cursor: 'pointer',
            fontFamily: 'system-ui, -apple-system, sans-serif',
        }
    },
        h('option', { value: 'nm' }, 'nm'),
        h('option', { value: 'ot' }, 'OT'),
        h('option', { value: 'qw' }, 'QW'),
        h('option', { value: 'fw' }, 'FW'),
    );
}

export function SegBtn({ active, onClick, label, c, title }) {
    return h('button', {
        onClick, title,
        style: {
            padding: '2px 10px',
            background: active ? c.accent : (c.inputBg || c.hover),
            color: active ? '#fff' : c.text,
            border: `1px solid ${active ? c.accent : c.border}`,
            borderRadius: 3, cursor: 'pointer', fontSize: 12,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            whiteSpace: 'nowrap',
        }
    }, label);
}

export function controlStyles(c) {
    return {
        sectionTitle: {
            fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: 0.4, color: c.textDim, marginBottom: 4,
            fontFamily: 'system-ui, -apple-system, sans-serif',
        },
        fieldRow: {
            display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center',
            gap: 6, marginBottom: 3,
        },
        lbl: { color: c.text, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5 },
        unit: { color: c.textDim, fontSize: 11, minWidth: 16 },
    };
}

export function placeholder(c, msg) {
    return h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, msg);
}
