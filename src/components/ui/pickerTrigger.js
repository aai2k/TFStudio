/**
 * The closed PickerDropdown: the trigger that shows the current value and opens
 * the list. `s` is the picker's shared state (PickerDropdown.js).
 *
 * A picker standing in a table cell covers the cell, so the trigger draws the
 * cell's selection, `mark`, and can leave a click to the cell,
 * `openOnDoubleClick`.
 */

const { createElement: h } = React;

/** The small colour dot beside a material's name. */
export function dotStyle(color) {
    return {
        width: 9, height: 9, borderRadius: '50%',
        backgroundColor: color || '#888', flexShrink: 0,
        display: 'inline-block', marginRight: 4
    };
}

// The trigger's own box: a field with a border on the panel's background. A
// picker standing in a table cell draws the cell's selection on it, since it
// covers the cell: `mark` 'focus' outlines it as the focused cell, and
// 'selected' shades it as a cell inside a selected rectangle.
function triggerBox({ mark, open, c }) {
    const tint = { focus: '12', selected: '33' }[mark];
    return {
        padding: '0 4px', backgroundColor: c.panel, color: c.text,
        border: `1px solid ${open || mark === 'focus' ? c.accent : c.border}`,
        backgroundImage: tint ? `linear-gradient(${c.accent}${tint}, ${c.accent}${tint})` : 'none',
        fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
    };
}

const onChevron = event => !!event.target.closest?.('[data-picker-chevron]');

/**
 * How the trigger opens the list. A picker standing in a table cell,
 * `openOnDoubleClick`, leaves a click to the cell, which it selects, and opens
 * on a double-click or on a click on its chevron; a click anywhere on it still
 * closes an open list. Elsewhere a click anywhere on the trigger opens it.
 *
 * Two quick clicks on the chevron have already opened the list and closed it
 * again by the time the browser reports them as a double-click, so that
 * double-click opens nothing.
 */
export function triggerOpeners({ onTrigger, open, openOnDoubleClick }) {
    if (!openOnDoubleClick) return { onClick: onTrigger };
    return {
        onClick: event => { if (open || onChevron(event)) onTrigger(); },
        onDoubleClick: event => { if (!open && !onChevron(event)) onTrigger(); },
    };
}

// The chevron every select and menu button carries (styles.css). On a picker
// that opens on a double-click it is also a button of its own, and the strip it
// sits in runs the trigger's height and out to its edge: the chevron alone is
// too small a mark to aim at.
function chevronEl(open, openOnDoubleClick) {
    const caret = h('span', { className: open ? 'tf-caret tf-caret-open' : 'tf-caret' });
    if (!openOnDoubleClick) return caret;
    return h('span', {
        'data-picker-chevron': '',
        style: { alignSelf: 'stretch', display: 'flex', alignItems: 'center', padding: '0 4px 0 2px', marginRight: -4, cursor: 'pointer' },
    }, caret);
}

export function triggerEl(s) {
    const { triggerRef, compact, open, triggerColor, triggerLabel, openOnDoubleClick } = s;
    return h('div', {
        ref: triggerRef,
        ...triggerOpeners(s),
        style: {
            display: 'flex', alignItems: 'center', boxSizing: 'border-box',
            flex: compact ? undefined : 1,
            width: compact ? '100%' : undefined,
            minWidth: 0,
            height: 22, ...triggerBox(s), borderRadius: 3,
            cursor: openOnDoubleClick ? 'default' : 'pointer', userSelect: 'none', gap: 4, overflow: 'hidden'
        }
    },
        triggerColor != null ? h('span', { style: dotStyle(triggerColor) }) : null,
        h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, triggerLabel),
        chevronEl(open, openOnDoubleClick),
    );
}
