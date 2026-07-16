import { Checkbox } from '../../../ui/Checkbox.js';
import { parseAoiList } from './model.js';

const { createElement: h, useState, useEffect } = React;

// ── Style atoms (mirror MonoWizard / FilterDesignWizard) ────────────────────
export function inputStyle(c, w) {
  return { width: w, padding: '5px 7px', fontSize: 13, backgroundColor: c.bg, color: c.text,
           border: `1px solid ${c.border}`, borderRadius: 4, outline: 'none', boxSizing: 'border-box' };
}
export function TextField({ label, value, onChange, c, width = '100%', placeholder }) {
  return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim, flex: 1 } },
    label && h('span', null, label),
    h('input', { type: 'text', value: value || '', placeholder: placeholder || '',
      onChange: (e) => onChange(e.target.value), style: inputStyle(c, width) }));
}
export function NumField({ label, value, min, max, step, onChange, c, width = 90, suffix }) {
  return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
    label && h('span', null, label),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
      h('input', { type: 'number', value, min, max, step: step ?? 'any',
        onChange: (e) => { const v = parseFloat(e.target.value); onChange(Number.isNaN(v) ? 0 : v); },
        style: inputStyle(c, width) }),
      suffix && h('span', { style: { fontSize: 12, color: c.textDim } }, suffix)));
}
export function AoiListField({ label, thetas, onChange, c, fallback = 0, width = 150 }) {
  const [raw, setRaw] = useState((thetas || []).join(', '));
  useEffect(() => { setRaw((thetas || []).join(', ')); }, [JSON.stringify(thetas)]);
  const commit = () => onChange(parseAoiList(raw, fallback));
  return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
    label && h('span', null, label),
    h('input', { type: 'text', value: raw, placeholder: 'e.g. 0, 30, 45',
      onChange: (e) => setRaw(e.target.value), onBlur: commit,
      onKeyDown: (e) => { if (e.key === 'Enter') commit(); }, style: inputStyle(c, width) }));
}
export function Check({ checked, onChange, label, c }) {
  return h('label', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: c.text, cursor: 'pointer' } },
    h(Checkbox, { c, checked: !!checked, onChange: (e) => onChange(e.target.checked) }), label);
}
export function btn(c, primary) {
  return { padding: '8px 18px', fontSize: 13, fontWeight: primary ? 600 : 400,
           background: primary ? c.accent : c.bg, color: primary ? '#fff' : c.text,
           border: primary ? 'none' : `1px solid ${c.border}`, borderRadius: 4, cursor: 'pointer' };
}
export function smallBtn(c, on) {
  return { padding: '3px 9px', fontSize: 12, cursor: 'pointer',
           border: `1px solid ${on ? c.accent : c.border}`, borderRadius: 3,
           background: on ? c.accent + '22' : c.bg, color: on ? c.accent : c.text };
}
