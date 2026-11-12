/**
 * The environment controls of the Design Editor's Settings, drawn only on a
 * design with more than one environment: the droplist of environments between
 * a previous and a next arrow, and the tag a field carries in environment 2 or
 * later, which says whether that environment sets the field or follows
 * environment 1.
 */
import { tablerIcon } from '../../../ui/tablerIcons.js';
import { SelectField } from '../../analysis/chrome/controls.js';
import { environmentsOf } from '../../../../utils/environments/environments.js';
import { environmentLabel } from '../environments/currentEnvironment.js';
import { IconBtn } from './ui.js';

const { createElement: h } = React;

/**
 * Which environment the Settings below show and edit. `current` is
 * useCurrentEnvironment's; the arrows stop at the first and the last.
 */
export function EnvironmentRow({ design, current, c, t }) {
    const te = t.environments;
    const options = environmentsOf(design).map((env, index) => ({ id: env.id, label: environmentLabel(env, index + 1) }));
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0 6px' } },
        h('span', { style: { fontSize: 11, color: c.textDim, whiteSpace: 'nowrap' } }, te.environment),
        h(IconBtn, {
            onClick: () => current.step(-1), title: te.previous, disabled: current.index === 0, c,
        }, tablerIcon('chevron-left', 14)),
        h('div', { style: { flex: '0 1 220px', minWidth: 0 } },
            h(SelectField, {
                value: current.id, onChange: current.select, options, c, width: '100%', title: te.currentTip,
            })),
        h(IconBtn, {
            onClick: () => current.step(1), title: te.next, disabled: current.index === current.count - 1, c,
        }, tablerIcon('chevron-right', 14)),
    );
}

/**
 * The tag after a field's name in environment `number` (2 or later): the
 * environment's number with an × when it sets the field, the × giving the
 * field back to environment 1, or a note that the field follows
 * environment 1.
 */
export function FieldTag({ own, number, onReset, c, t }) {
    const te = t.environments;
    const style = { fontSize: 10, marginLeft: 4, whiteSpace: 'nowrap', flexShrink: 0 };
    if (!own) return h('span', { title: te.followsTip, style: { ...style, color: c.textDim, opacity: 0.8 } }, te.follows);
    return h('button', {
        type: 'button', onClick: onReset, title: te.ownTip(number), 'aria-label': te.ownTip(number),
        style: {
            ...style, display: 'inline-flex', alignItems: 'center', gap: 2, padding: 0,
            border: 'none', background: 'none', color: c.accent, cursor: 'pointer', fontFamily: 'inherit',
        },
    }, te.own(number), tablerIcon('x', 10));
}
