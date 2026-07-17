import { Checkbox } from '../../../ui/Checkbox.js';

const { createElement: h } = React;

export function fieldLabel(c) { return { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim }; }
export function inputStyle(c, w) { return { width: w, padding: '6px 8px', fontSize: 13, backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, outline: 'none' }; }

export function NumField({ label, value, min, max, step, onChange, c, suffix, width = 110, hint }) {
    return h('label', { style: fieldLabel(c) },
        h('span', {}, label),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('input', { type: 'number', value, min, max, step: step ?? 'any',
                onChange: (e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(v); },
                style: inputStyle(c, width) }),
            suffix && h('span', { style: { fontSize: 12, color: c.textDim } }, suffix)),
        hint && h('span', { style: { fontSize: 10.5, color: c.textDim, opacity: 0.85 } }, hint));
}
export function IntField({ label, value, min, max, onChange, c, hint }) {
    return h('label', { style: fieldLabel(c) },
        h('span', {}, label),
        h('input', { type: 'number', value, min, max, step: 1,
            onChange: (e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) onChange(v); },
            style: inputStyle(c, 90) }),
        hint && h('span', { style: { fontSize: 10.5, color: c.textDim, opacity: 0.85 } }, hint));
}
export function CheckField({ label, value, onChange, c, hint }) {
    return h('label', { style: { ...fieldLabel(c), cursor: 'pointer' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(Checkbox, { c, checked: !!value, onChange: (e) => onChange(e.target.checked) }),
            h('span', {}, label)),
        hint && h('span', { style: { fontSize: 10.5, color: c.textDim, opacity: 0.85 } }, hint));
}
export function StepHeader({ step, title, c }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0 12px', borderBottom: `1px solid ${c.border}`, marginBottom: 12 } },
        h('div', { style: { fontSize: 11, color: c.textDim, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 } }, `Step ${step} of 6`),
        h('div', { style: { fontSize: 16, fontWeight: 600, color: c.text } }, title));
}
