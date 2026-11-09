/**
 * The controls every analysis window is built from.
 *
 * One definition per control, so a size, a corner radius or an active-state
 * tint cannot drift between windows. Two rules hold across all of them:
 *
 *   • A button in a toolbar row is 24 px tall, the height of the inputs and
 *     selects beside it. A group of choices is a 28 px pill holding 22 px
 *     buttons.
 *   • Active means a translucent wash of the accent (or the control's own
 *     colour) behind full-strength text, never a solid fill with reversed
 *     text. Inactive text is dimmed instead of outlined.
 *
 * The one solid fill is SolidButton, for the button that starts, stops or
 * applies a window's work.
 */

import { Checkbox } from '../../../ui/Checkbox.js';
import { NumberField } from '../../../ui/numberField.js';
import { dropPositionFrom, useDismiss } from '../../../ui/PickerDropdown.js';
import { ownerWindow } from '../../../ui/ownerWindow.js';
import { fillForWhiteText } from '../../../../constants/colorPalettes.js';

const { createElement: h, useRef, useState } = React;

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
 * Number field sized for a toolbar row. It takes either decimal separator,
 * applies on blur or Enter, and steps with its arrows, the arrow keys and the
 * mouse wheel as a Design Editor thickness cell does; `NumberField` has the
 * rules and the options.
 */
export function NumInput({
    value, onChange, min, max, step, c, width = 60, title, disabled,
    nullable, placeholder, emptyStep, positive,
}) {
    return h(NumberField, {
        title, disabled, placeholder, value, onChange, min, max, step, nullable, emptyStep, positive,
        spin: true, c,
        style: {
            width, height: 24, backgroundColor: c.field, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            fontSize: 12, fontFamily: FONT,
            // The value is right-aligned; 7 px keeps it off the border, as the
            // angle chips pad theirs.
            padding: '0 7px 0 4px', outline: 'none', textAlign: 'right',
            opacity: disabled ? 0.5 : 1,
        }
    });
}

/**
 * A list of plain values as `SelectField` options, where the value is its own
 * id. `label`, when given, is what each one is shown as.
 */
export function valueOptions(values, label) {
    return values.map(value => ({ id: value, label: label ? label(value) : value }));
}

/**
 * Dropdown for a list too long to spend a row on as buttons. The chosen label
 * stays on one line and is cut off when the box is narrower (styles.css), so
 * with no `title` of its own the box shows the whole label on hover.
 *
 *   options  [{ id, label }]
 */
export function SelectField({ value, onChange, options, c, width, title, disabled }) {
    const chosen = options.find(option => String(option.id) === String(value))?.label;
    return h('select', {
        value, title: title ?? (typeof chosen === 'string' ? chosen : undefined), disabled,
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

function choiceButtonStyle(c, active, color, disabled) {
    return {
        height: 22, padding: '0 8px', display: 'inline-flex', alignItems: 'center', gap: 5,
        border: 'none', borderRadius: 4, outline: 'none', cursor: disabled ? 'default' : 'pointer',
        backgroundColor: active ? activeFill(c, color) : 'transparent',
        color: active ? c.text : c.textDim, opacity: disabled ? 0.45 : 1,
        fontSize: 11, fontWeight: 500, fontFamily: FONT,
    };
}

/**
 * One choice out of a few, as a labelled pill of buttons — the app's answer to
 * a radio group. Prefer it to a dropdown up to about four options.
 *
 *   label   optional name carried inside the pill
 *   items   [{ id, label, title?, color?, disabled? }] - `color` tints the
 *           active wash and adds a dot, for a choice that maps to a curve
 *           colour; a `disabled` choice is greyed and cannot be picked
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
                key: item.id, type: 'button', title: item.title, disabled: item.disabled,
                onClick: () => onSelect(item.id), 'aria-pressed': active,
                style: choiceButtonStyle(c, active, item.color, item.disabled),
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

const RESPONSE_COLORS = { R: '#ef5350', T: '#03a9f4' };

/**
 * Transmitted or reflected light, as one switch the windows share: T with a
 * blue dot and R with a red one, in the order of the T, R and A switches, the
 * words on hover.
 *
 *   ids  the choices offered, both by default; a window leaves one out where
 *        a setting rules it out, as the whole part rules out reflection
 */
export function ResponseChoice({ c, t, activeId, onSelect, ids = ['T', 'R'] }) {
    const words = t.analysisChrome;
    return h(ChoiceGroup, {
        c, ariaLabel: words.response, activeId, onSelect,
        items: ids.map(id => ({
            id, label: id, color: RESPONSE_COLORS[id],
            title: id === 'R' ? words.reflection : words.transmission,
        })),
    });
}

/**
 * One quantity and the polarizations it can be drawn in: a colour dot, the
 * quantity's letter, then a button per polarization. The dot carries the
 * curve's own colour, so the row doubles as the plot's key.
 *
 * Prefer this to a channel dropdown wherever a window draws T, R and A: it
 * shows what is on the plot without opening anything, and lets two of them be
 * compared at once.
 *
 *   quantity  letter in the pill, e.g. 'T'
 *   color     the quantity's curve colour
 *   members   [{ pol, key }] - `key` indexes `active`
 *   active    { key: boolean }
 *   labels    polarization names, keyed by `pol`
 */
export function CurveToggleGroup({
    c, quantity, color, members, active, onToggle, labels, disabled, disabledTitle,
}) {
    const fill = activeFill(c, color);
    return h('div', {
        role: 'group', 'aria-label': quantity, title: disabled ? disabledTitle : undefined,
        style: {
            display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0,
            height: 28, padding: '0 3px 0 8px', border: `1px solid ${c.border}`,
            borderRadius: 7, backgroundColor: c.bg,
            opacity: disabled ? 0.45 : 1,
        },
    },
        h('span', {
            style: {
                width: 8, height: 8, borderRadius: '50%',
                backgroundColor: color, marginRight: 3,
            },
        }),
        h('span', {
            style: { fontSize: 12, fontWeight: 700, color: c.text, marginRight: 2 },
        }, quantity),
        members.map(member => {
            const on = !!active[member.key] && !disabled;
            return h('button', {
                key: member.key, type: 'button', disabled,
                title: disabled ? disabledTitle : member.title,
                onClick: () => onToggle(member.key), 'aria-pressed': on,
                style: {
                    height: 22, padding: '0 7px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: disabled ? 'default' : 'pointer',
                    outline: 'none', border: 'none', lineHeight: 1,
                    borderRadius: 4, backgroundColor: on ? fill : 'transparent',
                    color: on ? c.text : c.textDim,
                    fontSize: 11, fontWeight: 500, fontFamily: FONT,
                },
            }, labels[member.pol]);
        }),
    );
}

/** The look of a toolbar button, for a window that draws its own. */
export function rowButtonStyle(c, { active, disabled, color }) {
    return {
        height: 24, padding: '0 8px', display: 'inline-flex', alignItems: 'center', gap: 4,
        border: `1px solid ${c.border}`, borderRadius: 5, outline: 'none',
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

// A row button filled with `color`, solid with white text or a wash behind
// full-strength text. A solid fill is darkened as far as white needs to read on
// it. Disabled, it is drawn as any disabled button.
function colorButtonStyle(c, color, solid, disabled) {
    const base = rowButtonStyle(c, { active: false, disabled });
    if (disabled) return base;
    const fill = solid ? fillForWhiteText(color) : activeFill(c, color);
    return {
        ...base,
        border: `1px solid ${solid ? fill : color + '99'}`,
        backgroundColor: fill,
        color: solid ? '#fff' : c.text,
        fontWeight: solid ? 600 : 500,
    };
}

/**
 * The button that starts, stops or applies a window's work, such as Run,
 * Stop, Compute or Apply: solid in `color` with white text, so it is the
 * first thing found on the row.
 */
export function SolidButton({ label, onClick, c, color, title, disabled, children }) {
    return h('button', {
        type: 'button', title, disabled,
        onClick: () => { if (!disabled) onClick(); },
        style: colorButtonStyle(c, color, true, disabled),
    }, children, label);
}

// A menu's list of commands, placed against the button that opened it.
function menuList({ label, items, position, dropRef, pick }) {
    return h('div', {
        ref: dropRef, role: 'menu', 'aria-label': label, className: 'tf-menu',
        style: {
            position: 'fixed', zIndex: 9999,
            ...(position.top != null ? { top: position.top } : { bottom: position.bottom }),
            left: position.left, width: position.width, maxHeight: position.maxH, overflowY: 'auto',
        },
    }, items.map(item => h('div', {
        key: item.id, role: 'menuitem', className: 'tf-menu-item', onClick: () => pick(item),
    }, item.label)));
}

/**
 * A row button that opens a list of commands, each run when it is picked.
 * The list flips above the button at the foot of a window.
 *
 *   items  [{ id, label, onSelect }]
 */
export function MenuButton({ label, items, c, title, minWidth = 200 }) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState(null);
    const triggerRef = useRef(null);
    const dropRef = useRef(null);
    useDismiss(open, setOpen, dropRef, triggerRef);
    // Outside-click dismissal ignores the button, so it closes the list itself.
    const toggle = () => {
        if (open) { setOpen(false); return; }
        const trigger = triggerRef.current;
        if (!trigger) return;
        setPosition(dropPositionFrom(trigger.getBoundingClientRect(), minWidth, ownerWindow(trigger)));
        setOpen(true);
    };
    const pick = (item) => { setOpen(false); item.onSelect(); };
    return h(React.Fragment, null,
        h('button', {
            ref: triggerRef, type: 'button', title, 'aria-haspopup': 'menu', 'aria-expanded': open,
            onClick: toggle, style: { ...rowButtonStyle(c, {}), flexShrink: 0 },
        }, label, h('span', { className: open ? 'tf-caret tf-caret-open' : 'tf-caret' })),
        open && position && menuList({ label, items, position, dropRef, pick }),
    );
}

/**
 * A button that takes the design back to a kept state, such as Reset or
 * Best: a wash of `color`, so the two are told apart by color.
 */
export function WashButton({ label, onClick, c, color, title, disabled, children }) {
    return h('button', {
        type: 'button', title, disabled,
        onClick: () => { if (!disabled) onClick(); },
        style: colorButtonStyle(c, color, false, disabled),
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
