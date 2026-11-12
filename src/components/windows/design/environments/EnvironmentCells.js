/**
 * The cells of the Environments grid: the head of each environment's column
 * (current, on, name), and a field of one environment, drawn as a control
 * when the environment sets the field and as the value it follows otherwise.
 */
import { MaterialPicker } from '../../../ui/MaterialPicker.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { DebouncedInput } from '../../../ui/DebouncedInput.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';
import { NumInput } from '../../analysis/chrome/controls.js';
import { designMaterialName } from '../../../../utils/materials/designMaterials.js';
import { BASE_ENVIRONMENT, isEnvironmentOn } from '../../../../utils/environments/environments.js';
import { setEnvironment } from '../../../../utils/environments/environmentEdits.js';
import { fieldValue } from './environmentFields.js';

const { createElement: h } = React;

const FONT = 'system-ui, -apple-system, sans-serif';

/** The tint of the current environment's column. */
export const currentTint = c => c.accent + '17';

// The head of a column, set as one environment's name or switch: the change
// to the design, or nothing for a design with one environment, which holds
// neither.
function setHeadField(ctx, env, fields) {
    if (!ctx.many) return;
    ctx.updateDesign({ environments: setEnvironment(ctx.design, env.id, fields).environments });
}

/**
 * The head of environment `env`'s column: a radio button that makes it the
 * current environment, its number, its On switch and its name. On a design
 * with one environment the switch and the name are off: environment 1 takes
 * neither until there is another.
 */
export function HeadCell({ ctx, env, index }) {
    const { current, c, t } = ctx;
    const te = t.environments;
    const isCurrent = env.id === current.id;
    return h('th', {
        style: {
            padding: '5px 6px 4px', verticalAlign: 'top', textAlign: 'left', fontWeight: 400,
            borderLeft: `1px solid ${c.border}`, borderBottom: `1px solid ${c.border}`,
            background: isCurrent ? currentTint(c) : c.panel,
        },
    },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: c.text } },
            h('label', { title: te.currentTip, style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' } },
                h('input', {
                    type: 'radio', checked: isCurrent, onChange: () => current.select(env.id),
                    'aria-label': te.makeCurrent(index + 1),
                    style: { accentColor: c.accent, cursor: 'pointer', margin: 0 },
                }),
                h('b', null, index + 1)),
            h('label', {
                title: te.onTip,
                style: { display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto', color: c.textDim, cursor: ctx.many ? 'pointer' : 'default' },
            },
                h(Checkbox, {
                    c, checked: isEnvironmentOn(env), disabled: !ctx.many,
                    onChange: event => setHeadField(ctx, env, { enabled: event.target.checked }),
                }),
                te.on)),
        h(DebouncedInput, {
            value: env.name || '', validateNumber: false, disabled: !ctx.many,
            placeholder: te.namePlaceholder, 'aria-label': te.nameOf(index + 1),
            onChange: text => setHeadField(ctx, env, { name: String(text).trim() || null }),
            style: {
                width: '100%', boxSizing: 'border-box', marginTop: 3, height: 20, padding: '0 3px',
                background: 'transparent', border: `1px solid ${c.border}`, borderRadius: 3,
                color: c.text, fontSize: 12, fontWeight: 600, fontFamily: FONT, outline: 'none',
            },
        }));
}

// How a field's value reads where it is not a control: a material by its
// name, a thickness in mm, a factor as the number it is.
function valueText(ctx, row, value) {
    if (row.kind === 'material') return designMaterialName(ctx.design, value);
    if (row.kind === 'thickness') return `${value} ${ctx.t.units.mm}`;
    return String(value);
}

// The control of a field its environment sets.
function fieldControl(ctx, row, value, set) {
    const { c, t } = ctx;
    if (row.kind === 'material') {
        return h('div', { style: { flex: 1, minWidth: 0 } }, h(MaterialPicker, { value, onChange: set, c, t, compact: true }));
    }
    const thickness = row.kind === 'thickness';
    return h(React.Fragment, null,
        h(NumInput, {
            value, onChange: set, c, width: 64, positive: !thickness, min: thickness ? 0 : undefined,
            step: thickness ? 0.1 : 0.01,
        }),
        thickness && h('span', { style: { fontSize: 11, color: c.textDim } }, t.units.mm));
}

const plainButton = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, outline: 'none',
};

/**
 * Field `row.field` of environment `env`. Environment 1's is the design's own
 * field, or fixed for a factor or a swap, which it has none of. Another
 * environment's is its own control with an × that gives it back to
 * environment 1 when it sets it, and the value it follows, dimmed, when it
 * does not: a click sets that value for the environment, ready to change.
 */
export function FieldCell({ ctx, env, row }) {
    const { design, edit, c, t } = ctx;
    const te = t.environments;
    const { value, own, fixed } = fieldValue(design, env.id, row.field);
    const text = valueText(ctx, row, value);
    if (fixed) return h('span', { title: te.baseHasNoLayerFields, style: { color: c.textDim, fontSize: 12, padding: '0 5px' } }, text);
    if (!own) {
        return h('button', {
            type: 'button', title: te.followsCellTip, onClick: () => edit(env.id, row.field, value),
            style: {
                ...plainButton, width: '100%', height: 22, textAlign: 'left', padding: '0 5px', fontSize: 12,
                color: c.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                border: `1px dashed ${c.border}`, borderRadius: 3,
            },
        }, text);
    }
    const set = next => edit(env.id, row.field, next);
    return h('span', { style: { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 } },
        fieldControl(ctx, row, value, set),
        env.id !== BASE_ENVIRONMENT && h('button', {
            type: 'button', title: te.resetTip, 'aria-label': te.resetTip, onClick: () => set(null),
            style: { ...plainButton, display: 'flex', alignItems: 'center', color: c.textDim, padding: '0 2px' },
        }, tablerIcon('x', 12)));
}
