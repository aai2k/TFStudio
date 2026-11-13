/**
 * The cells of the Environments grid: the head of each environment's column
 * (current, on, name), and a field of one environment, drawn as a control
 * when the environment sets the field and as the value it follows otherwise.
 */
import { MaterialPicker } from '../../../ui/MaterialPicker.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { DebouncedInput } from '../../../ui/DebouncedInput.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';
import { NumInput, SelectField } from '../../analysis/chrome/controls.js';
import { coneText } from '../../../SurfaceModeBar.js';
import { CONE_DEFAULT, coneEdit } from '../designEditor/ConeAngleControl.js';
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

// The words of the back side's two values, 'side' and 'total'.
const backSideWord = (te, value) => (value === 'total' ? te.backSideCounted : te.backSideIgnored);

// How a field's value reads where it is not a control, by the kind of its
// row: a material by its name, a thickness in mm, a cone as the Cone badge
// reads it, the back side in words, a temperature in °C, a factor as the
// number it is.
const VALUE_TEXT = {
    material: ({ design }, value) => designMaterialName(design, value),
    thickness: ({ t }, value) => `${value} ${t.units.mm}`,
    cone: ({ t }, value) => coneText({ cone: value }, t) ?? t.environments.noCone,
    backSide: ({ t }, value) => backSideWord(t.environments, value),
    temperature: ({ t }, value) => `${value} ${t.units.celsius}`,
};
const valueText = (ctx, row, value) => VALUE_TEXT[row.kind]?.(ctx, value) ?? String(value);

// The cone a field cell sets: its switch and its half-angle, the rest in the
// Design Editor's Settings.
function coneControl(ctx, value, set, burstKey) {
    const { c, t } = ctx;
    const cone = { ...CONE_DEFAULT, ...value };
    const patch = (part, step) => set(coneEdit(value, part), step);
    return h(React.Fragment, null,
        h(Checkbox, { c, checked: !!cone.enabled, onChange: event => patch({ enabled: event.target.checked }) }),
        h(NumInput, {
            value: cone.halfAngleDeg, c, width: 52, min: 0, max: 89.9, step: 0.5, title: t.designEditor.cone.halfAngle,
            burstKey, onChange: (v, step) => patch({ halfAngleDeg: v }, step),
        }),
        h('span', { style: { fontSize: 11, color: c.textDim } }, '°'));
}

// The control of a field its environment sets. `set(value, step)` takes a
// number field's step, so a burst of steps on one design and environment
// (`burstKey`) is one undo step.
function fieldControl(ctx, row, value, set, burstKey) {
    const { c, t } = ctx;
    if (row.kind === 'material') {
        return h('div', { style: { flex: 1, minWidth: 0 } }, h(MaterialPicker, { value, onChange: set, c, t, compact: true }));
    }
    if (row.kind === 'cone') return coneControl(ctx, value, set, burstKey);
    if (row.kind === 'backSide') {
        const options = ['side', 'total'].map(id => ({ id, label: backSideWord(t.environments, id) }));
        return h(SelectField, { value, onChange: set, options, c, width: 96 });
    }
    if (row.kind === 'temperature') {
        return h(React.Fragment, null,
            h(NumInput, { value, c, width: 64, step: 5, burstKey, onChange: (v, step) => { if (v > -273.15) set(v, step); } }),
            h('span', { style: { fontSize: 11, color: c.textDim } }, t.units.celsius));
    }
    const thickness = row.kind === 'thickness';
    return h(React.Fragment, null,
        h(NumInput, {
            value, onChange: set, c, width: 64, positive: !thickness, min: thickness ? 0 : undefined,
            step: thickness ? 0.1 : 0.01, burstKey,
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
            type: 'button', title: te.followsCellTip, onClick: () => edit(env.id, row.field, row.copy ? row.copy(value) : value),
            style: {
                ...plainButton, width: '100%', height: 22, textAlign: 'left', padding: '0 5px', fontSize: 12,
                color: c.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                border: `1px dashed ${c.border}`, borderRadius: 3,
            },
        }, text);
    }
    const set = (next, step) => edit(env.id, row.field, next, step);
    return h('span', { style: { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 } },
        fieldControl(ctx, row, value, set, `${design.id}|${env.id}`),
        env.id !== BASE_ENVIRONMENT && h('button', {
            type: 'button', title: te.resetTip, 'aria-label': te.resetTip, onClick: () => set(null),
            style: { ...plainButton, display: 'flex', alignItems: 'center', color: c.textDim, padding: '0 2px' },
        }, tablerIcon('x', 12)));
}
