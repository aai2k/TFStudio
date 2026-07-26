/**
 * Material Editor — catalog overflow menu.
 *
 * The "⋯" popup next to the catalog selector. Collects every catalog-scoped
 * action (create / rename / duplicate / delete) and the three material
 * importers, so the panel itself carries nothing but the selector, the search
 * box and the material list.
 *
 * `items` is a flat list of `{ id, glyph, label, onClick, disabled, danger }`
 * entries; an entry of `{ id, separator: true }` draws a divider.
 */

const { createElement: h, useEffect, useRef } = React;

function menuItemStyle(item, c) {
    const color = item.disabled ? c.textDim : item.danger ? '#e6194b' : c.text;
    return {
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap',
        color, opacity: item.disabled ? 0.45 : 1,
        cursor: item.disabled ? 'default' : 'pointer',
    };
}

function renderItem(item, onClose, c) {
    if (item.separator) {
        return h('div', { key: item.id, style: { height: 1, backgroundColor: c.border, margin: '4px 0' } });
    }
    return h('div', {
        key: item.id,
        onClick: () => { if (item.disabled) return; onClose(); item.onClick(); },
        style: menuItemStyle(item, c),
        onMouseEnter: e => { if (!item.disabled) e.currentTarget.style.backgroundColor = c.hover; },
        onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; },
    },
        h('span', { style: { width: 14, textAlign: 'center', flexShrink: 0, color: item.disabled ? c.textDim : c.accent } }, item.glyph),
        h('span', null, item.label)
    );
}

export function CatalogMenu({ items, onClose, c }) {
    const ref = useRef(null);

    // Dismiss on outside click or Escape. `mousedown` (not `click`) so the menu
    // closes before the click lands on whatever is underneath it.
    useEffect(() => {
        const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
        const onKey  = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

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
