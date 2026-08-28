import { environmentOptions } from '../../../../utils/physics/environment.js';

const { createElement: h } = React;

export function EnvironmentSelector({ c, oe, design, envIndex, onChange }) {
  const opts = environmentOptions(design);
  const envs = (design && design.meritEnvironments) || [];
  return h('select', {
    value: String(envIndex),
    onChange: (e) => onChange(Number(e.target.value)),
    title: oe.environment || 'Environment',
    style: { fontSize: 12, marginLeft: 8 },
  }, opts.map(o => h('option', {
    key: o.value, value: String(o.value),
    title: o.value === -1 ? '' :
      `E${o.value + 1}: ${envs[o.value].incidentMedium || '?'} → ${envs[o.value].exitMedium || '?'}`,
  }, o.value === -1 ? (oe.designLevel || 'Design (all)') : o.label)));
}
