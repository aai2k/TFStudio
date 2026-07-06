const { createElement: h, useRef, useEffect } = React;   // React is a window global

/**
 * Themed checkbox — the single checkbox style used across the app.
 *
 * A native <input type="checkbox"> whose `accentColor` follows the active theme
 * accent, so the control is light/dark aware everywhere (previously many windows
 * rendered bare, browser-default checkboxes that ignored the theme).
 *
 * Drop-in for `h('input', { type: 'checkbox', ... })`: pass the usual `checked` /
 * `defaultChecked` / `onChange` / `disabled` and the theme object `c`. `onChange`
 * receives the native event, so existing `e => e.target.checked` handlers are
 * unchanged. Set `indeterminate` to render the tri-state dash (managed via a ref;
 * do not also pass your own `ref`). Any `style` is merged over the defaults.
 */
export function Checkbox({ c, style, indeterminate = false, disabled = false, ...props }) {
    const ref = useRef(null);
    useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
    return h('input', {
        type: 'checkbox', ref, disabled, ...props,
        style: {
            accentColor: c?.accent,
            cursor: disabled ? 'default' : 'pointer',
            flexShrink: 0,
            ...style,
        },
    });
}
