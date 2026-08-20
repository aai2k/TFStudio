/**
 * The controls every analysis window is built from.
 *
 * One definition per control, so a size, a corner radius or an active-state
 * tint cannot drift between windows. Two rules hold across all of them:
 *
 *   • A control that sits in a toolbar row is 28 px tall; a bare input or
 *     select inside one is 24 px, so it clears the row's edges.
 *   • Active means a translucent wash of the accent (or the control's own
 *     colour) behind full-strength text, never a solid fill with reversed
 *     text. Inactive text is dimmed instead of outlined.
 */

import { Checkbox } from '../../../ui/Checkbox.js';

const { createElement: h, useState, useEffect } = React;

const FONT = 'system-ui, -apple-system, sans-serif';

/** Wash used behind an active control. Lighter on light themes. */
export function activeFill(c, color) {
    return (color || c.accent) + (c.light ? '20' : '38');
}

/** Name to the left of a field, sized to sit on a toolbar row. */
export function FieldLabel({ children, c }) {
    return h('span', {
        style: { fontSize: 11, color: c.textDim, fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0 }
    }, children);
}

/** Vertical rule separating groups of controls in one row. */
export function Divider({ c }) {
    return h('div', { style: { width: 1, height: 22, background: c.border, flexShrink: 0 } });
}

/**
 * Number field that commits on blur or Enter, so a partially typed value never
 * reaches the calculation. Out-of-range entries are clamped rather than
 * rejected; unparseable ones revert.
 */
export function NumInput({ value, onChange, min, max, step = 1, c, width = 60, title, disabled }) {
    const [raw, setRaw] = useState(String(value));
    useEffect(() => { setRaw(String(value)); }, [value]);
    const commit = () => {
        if (raw === String(value)) return;
        const parsed = parseFloat(raw);
        if (!isNaN(parsed)) onChange(Math.min(Math.max(parsed, min ?? -Infinity), max ?? Infinity));
        else setRaw(String(value));
    };
    return h('input', {
        type: 'number', value: raw, min, max, step, title, disabled,
        // Hides the native spinner, which otherwise appears on hover and pushes
        // the digits sideways. See `.tfs-number` in styles.css.
        className: 'tfs-number',
        onChange: event => setRaw(event.target.value),
        onBlur: commit,
        onKeyDown: event => { if (event.key === 'Enter') commit(); },
        style: {
            width, height: 24, backgroundColor: c.field, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            fontSize: 12, fontFamily: FONT,
            padding: '0 4px', outline: 'none', textAlign: 'right',
            opacity: disabled ? 0.5 : 1,
        }
    });
}

/**
 * Dropdown for a list too long to spend a row on as buttons.
 *
 *   options  [{ id, label }]
 */
export function SelectField({ value, onChange, options, c, width, title, disabled }) {
    return h('select', {
        value, title, disabled,
        onChange: event => onChange(event.target.value),
        style: {
            height: 24, width, backgroundColor: c.field, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            fontSize: 11, padding: '0 5px', outline: 'none',
            fontFamily: FONT, cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
        },
    }, options.map(option => h('option', { key: option.id, value: option.id }, option.label)));
}

function choiceButtonStyle(c, active, color) {
    return {
        height: 22, padding: '0 8px', display: 'inline-flex', alignItems: 'center', gap: 5,
        border: 'none', borderRadius: 4, outline: 'none', cursor: 'pointer',
        backgroundColor: active ? activeFill(c, color) : 'transparent',
        color: active ? c.text : c.textDim,
        fontSize: 11, fontWeight: 500, fontFamily: FONT,
    };
}

/**
 * One choice out of a few, as a labelled pill of buttons — the app's answer to
 * a radio group. Prefer it to a dropdown up to about four options.
 *
 *   label   optional name carried inside the pill
 *   items   [{ id, label, title?, color? }] - `color` tints the active wash and
 *           adds a dot, for a choice that maps to a curve colour
 */
export function ChoiceGroup({ label, items, activeId, onSelect, c, ariaLabel }) {
    return h('div', {
        role: 'group', 'aria-label': ariaLabel || label,
        style: {
            height: 28, display: 'inline-flex', alignItems: 'center', gap: 2,
            padding: label ? '0 3px 0 8px' : '0 3px',
            border: `1px solid ${c.border}`, borderRadius: 7,
            backgroundColor: c.bg, flexShrink: 0,
        },
    },
        label && h('span', {
            style: {
                marginRight: 3, color: c.text, fontSize: 11,
                fontWeight: 600, whiteSpace: 'nowrap',
            },
        }, label),
        items.map(item => {
            const active = item.id === activeId;
            return h('button', {
                key: item.id, type: 'button', title: item.title,
                onClick: () => onSelect(item.id), 'aria-pressed': active,
                style: choiceButtonStyle(c, active, item.color),
            },
                item.color && h('span', {
                    style: {
                        width: 7, height: 7, borderRadius: '50%',
                        backgroundColor: item.color, flexShrink: 0,
                    },
                }),
                item.label,
            );
        }),
    );
}

function rowButtonStyle(c, { active, disabled, color }) {
    return {
        height: 28, padding: '0 9px', display: 'inline-flex', alignItems: 'center', gap: 4,
        border: `1px solid ${c.border}`, borderRadius: 6, outline: 'none',
        backgroundColor: active ? activeFill(c, color) : 'transparent',
        color: disabled ? c.textDim : c.text,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 11, fontWeight: 500, fontFamily: FONT, whiteSpace: 'nowrap',
    };
}

/** Standalone on/off control, for a layer of the plot rather than a choice. */
export function ToggleButton({ label, active, onClick, c, title, disabled, color, children }) {
    return h('button', {
        type: 'button', title, disabled,
        onClick: () => { if (!disabled) onClick(); },
        'aria-pressed': !!active,
        style: rowButtonStyle(c, { active, disabled, color }),
    }, children, label);
}

/** Button that performs an action rather than holding a state. */
export function ActionButton({ label, onClick, c, title, disabled, children }) {
    return h('button', {
        type: 'button', title, disabled,
        onClick: () => { if (!disabled) onClick(); },
        style: rowButtonStyle(c, { active: false, disabled }),
    }, children, label);
}

/** Checkbox with its label, sized for a toolbar or axis row. */
export function CheckField({ label, checked, onChange, c, title, disabled }) {
    return h('label', {
        title,
        style: {
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            color: c.text, fontSize: 11, whiteSpace: 'nowrap',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
        },
    },
        h(Checkbox, { c, checked, disabled, onChange }),
        label,
    );
}

/**
 * Low/high pair around a dash, the shape every range in the app uses.
 *
 *   label  symbol shown ahead of the pair, e.g. 'λ'
 *   unit   optional trailing unit
 */
export function RangeField({ label, unit, c, from, to, width = 62 }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 } },
        label && h(FieldLabel, { c }, label),
        h(NumInput, { ...from, c, width }),
        h('span', { style: { color: c.textDim, fontSize: 11 } }, '–'),
        h(NumInput, { ...to, c, width }),
        unit && h('span', { style: { color: c.textDim, fontSize: 11 } }, unit),
    );
}
