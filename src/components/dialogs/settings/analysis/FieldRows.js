// Generic rows for one analysis-window setting, rendered from the registry so a
// new field is a registry entry rather than new UI.
import { Checkbox } from '../../../ui/Checkbox.js';
import { selectStyle } from '../ui.js';

const { createElement: h } = React;

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 0',
};

const nameStyle = (c) => ({ flex: 1, fontSize: '13px', color: c.text });

const Row = ({ c, label, children }) =>
  h('div', { style: rowStyle },
    h('span', { style: nameStyle(c) }, label),
    children);

export const ColorRow = ({ c, label, value, onChange }) =>
  h(Row, { c, label },
    h('input', {
      type: 'color',
      value,
      onChange: (e) => onChange(e.target.value.toLowerCase()),
      style: {
        width: '44px', height: '26px', padding: 0, cursor: 'pointer',
        backgroundColor: 'transparent', border: `1px solid ${c.border}`, borderRadius: '4px',
      },
    }),
    h('code', { style: { fontSize: '11px', color: c.textDim, width: '62px' } }, value));

// Commits on change; an empty or unparsable field is ignored rather than
// written as NaN, and the input keeps whatever the user typed until it parses.
export const NumberRow = ({ c, label, value, spec, onChange }) =>
  h(Row, { c, label },
    h('input', {
      type: 'number',
      value,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      onChange: (e) => {
        const parsed = parseFloat(e.target.value);
        if (Number.isFinite(parsed)) onChange(parsed);
      },
      style: { ...selectStyle(c), width: '120px', padding: '6px 8px' },
    }));

export const EnumRow = ({ c, label, value, spec, onChange }) =>
  h(Row, { c, label },
    h('select', {
      value,
      onChange: (e) => onChange(e.target.value),
      style: { ...selectStyle(c), width: '120px', padding: '6px 8px' },
    }, spec.options.map(option => h('option', { key: option, value: option }, option))));

export const BooleanRow = ({ c, label, value, onChange }) =>
  h(Row, { c, label },
    h(Checkbox, { c, checked: !!value, onChange: (e) => onChange(e.target.checked) }));
