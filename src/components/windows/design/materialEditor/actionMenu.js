/**
 * Material Editor: the drop-down menus of the left panel.
 *
 * Two buttons open one: ⋯ beside the catalog selector, holding what acts on
 * catalogs, and Add above the material list, holding every way of getting a
 * material in.
 *
 * `items` is a flat list of `{ id, icon, label, onClick, disabled, danger }`
 * entries, `icon` being a name from ui/tablerIcons.js; an entry of
 * `{ id, separator: true }` draws a divider, and one of
 * `{ id, header: true, label }` a line of dim text naming what the entries
 * under it act on.
 */

import { useDismiss } from '../../../ui/PickerDropdown.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';

const { createElement: h, useRef } = React;

function menuItemStyle(item, c) {
    const color = item.disabled ? c.textDim : item.danger ? '#e6194b' : c.text;
    return {
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap',
        color, opacity: item.disabled ? 0.45 : 1,
        cursor: item.disabled ? 'default' : 'pointer',
    };
}

function renderItem(item, onClose, c) {
    if (item.separator) {
        return h('div', { key: item.id, style: { height: 1, backgroundColor: c.border, margin: '4px 0' } });
    }
    if (item.header) {
        return h('div', {
            key: item.id, title: item.label,
            style: {
                padding: '4px 12px 3px', fontSize: 11, color: c.textDim, maxWidth: 260,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            },
        }, item.label);
    }
    return h('div', {
        key: item.id,
        onClick: () => { if (item.disabled) return; onClose(); item.onClick(); },
        style: menuItemStyle(item, c),
        onMouseEnter: e => { if (!item.disabled) e.currentTarget.style.backgroundColor = c.hover; },
        onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; },
    },
        h('span', {
            style: { display: 'inline-flex', flexShrink: 0,
                     color: item.disabled ? c.textDim : item.danger ? '#e6194b' : c.accent },
        }, tablerIcon(item.icon)),
        h('span', null, item.label)
    );
}

export function ActionMenu({ items, onClose, c, triggerRef }) {
    const ref = useRef(null);

    // A press outside the menu or Escape closes it. A press on the button that
    // opened it is left to that button, which toggles: closing here too would
    // have the click that follows open the menu again.
    useDismiss(true, onClose, ref, triggerRef);

    return h('div', {
        ref,
        style: {
            position: 'absolute', top: '100%', left: 8, zIndex: 50, marginTop: 2,
            minWidth: 232, padding: '4px 0',
            backgroundColor: c.panel, border: `1px solid ${c.border}`, borderRadius: 6,
            boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
        }
    }, items.map(item => renderItem(item, onClose, c)));
}
