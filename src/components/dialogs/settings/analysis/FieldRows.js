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

// Commits on blur or Enter, never while the field is being typed into: a field
// that rewrites itself on every keystroke cannot be cleared and retyped, and a
// half-typed number is not the number meant. Out-of-range entries are clamped,
// unparseable ones revert. `tfs-number` hides the native spinner.
export const NumberRow = ({ c, label, value, spec, onChange }) => {
  const { useState, useEffect } = React;
  const [raw, setRaw] = useState(String(value));
  useEffect(() => { setRaw(String(value)); }, [value]);

  const commit = () => {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      setRaw(String(value));
      return;
    }
    const next = Math.min(Math.max(parsed, spec.min ?? -Infinity), spec.max ?? Infinity);
    setRaw(String(next));
    if (next !== value) onChange(next);
  };

  return h(Row, { c, label },
    h('input', {
      type: 'number',
      className: 'tfs-number',
      value: raw,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      onChange: (e) => setRaw(e.target.value),
      onBlur: commit,
      onKeyDown: (e) => { if (e.key === 'Enter') commit(); },
      style: { ...selectStyle(c), width: '120px', padding: '6px 8px', textAlign: 'right' },
    }));
};

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

// A list is typed as separated numbers and committed only when the whole thing
// parses, so a half-typed entry never reaches the window. Out-of-range and
// duplicate entries are dropped rather than rejecting the edit outright.
export const ListRow = ({ c, label, value, spec, onChange }) => {
  const { useState, useEffect } = React;
  const text = (value || []).join(', ');
  const [raw, setRaw] = useState(text);
  useEffect(() => { setRaw(text); }, [text]);

  const commit = () => {
    const parsed = raw.split(/[,;\s]+/).filter(Boolean).map(parseFloat);
    const clean = parsed
      .filter(entry => Number.isFinite(entry) && entry >= spec.min && entry <= spec.max)
      .filter((entry, index, all) => all.indexOf(entry) === index)
      .slice(0, spec.maxLength);
    if (clean.length > 0) onChange(clean);
    else setRaw(text);
  };

  return h(Row, { c, label },
    h('input', {
      type: 'text',
      value: raw,
      onChange: (e) => setRaw(e.target.value),
      onBlur: commit,
      onKeyDown: (e) => { if (e.key === 'Enter') commit(); },
      style: { ...selectStyle(c), width: '120px', padding: '6px 8px', textAlign: 'right' },
    }));
};
