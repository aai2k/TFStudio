import { Field, selStyle } from './fields.js';

const { createElement: h } = React;

/**
 * The environment a check is judged in, on a design with environments
 * (`environments`, specEnvironments.js), as a merit row's Env cell picks it:
 * All, or one environment by its number and name. A check naming an
 * environment the design no longer has is judged nowhere, and the field says
 * so. Nothing on a design with one environment.
 */
export function EnvironmentField({ q, environments, setQualifierEnv, c, ts }) {
    if (!environments) return null;
    const chosen = q.env == null ? { label: ts.envAll } : environments.list.find(env => env.value === q.env);
    const color = chosen ? c.text : c.error;
    return h(Field, { label: ts.env, c },
        h('select', {
            value: q.env ?? '',
            onChange: e => setQualifierEnv(q.id, e.target.value || null),
            title: `${chosen?.label ?? ts.envGone}\n${ts.envTip}`,
            style: { ...selStyle(c), width: 120, color },
        },
            !chosen && h('option', { value: q.env, disabled: true, style: { background: c.panel } }, ts.envGone),
            h('option', { value: '', style: { background: c.panel, color: c.text } }, ts.envAll),
            environments.list.map(env => h('option', {
                key: env.value, value: env.value, style: { background: c.panel, color: c.text },
            }, env.label)),
        ));
}
