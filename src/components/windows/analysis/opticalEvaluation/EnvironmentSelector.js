import { environmentOptions } from '../../../../utils/physics/environment.js';

const { createElement: h } = React;

export function EnvironmentSelector({ c, oe, design, envIndex, onChange }) {
  const opts = environmentOptions(design);
  return h('select', {
    value: String(envIndex),
    onChange: (e) => onChange(Number(e.target.value)),
    title: oe.environment || 'Environment',
    style: { fontSize: 12, marginLeft: 8 },
  }, opts.map(o => h('option', { key: o.value, value: String(o.value) },
    o.value === -1 ? (oe.designLevel || 'Design (all)') : o.label)));
}
