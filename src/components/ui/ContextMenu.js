import { ownerWindow, listenForDismiss } from './ownerWindow.js';
import { tablerIcon } from './tablerIcons.js';

const { createElement: h, useEffect, useRef, useState } = React;

// From a panel's outer edge to its first row: the 1 px border and the 4 px of
// padding above the rows.
const PANEL_INSET = 5;

// Keep the menu inside the viewport it is drawn in, corner included. `view` is
// the menu's own window: a menu in a torn-off tool clamped against the main
// window's viewport is not clamped at all, and opens over the edge of the small
// window it belongs to.
export function clampToViewport(x, y, bounds, view) {
    return {
        left: Math.max(4, Math.min(x, view.innerWidth - bounds.width - 4)),
        top: Math.max(4, Math.min(y, view.innerHeight - bounds.height - 4)),
    };
}

// Where a submenu of `bounds` size opens beside the row `row` that opened it:
// just past the menu's right border with its first row level with that row, or
// past the menu's left border when the right side has no room for it. Rows run
// the full width of their menu, so the row's edges are the menu's.
export function submenuPosition(row, bounds, view) {
    const right = row.right + 1;
    const fitsRight = right + bounds.width <= view.innerWidth - 4;
    const x = fitsRight ? right : row.left - 1 - bounds.width;
    return clampToViewport(x, row.top - PANEL_INSET, bounds, view);
}

// A menu long enough to need it scrolls, a list of project folders say, so its
// lower items can always be reached.
const panelStyle = (c, dense, position) => ({
    position: 'fixed', left: position.left, top: position.top,
    minWidth: dense ? 150 : 190, padding: '4px 0', zIndex: 1001,
    maxHeight: '80vh', overflowY: 'auto',
    background: c.panel, border: `1px solid ${c.border}`,
    borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
});

const rowStyle = (item, c, dense, active) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    minHeight: dense ? 24 : 28, padding: dense ? '3px 10px' : '4px 12px',
    fontSize: dense ? 12 : 13,
    whiteSpace: 'nowrap', cursor: item.disabled ? 'default' : 'pointer',
    opacity: item.disabled ? 0.4 : 1,
    color: item.danger ? c.error : c.text,
    background: active ? c.hover : 'transparent',
});

// What a screen reader is told about an entry, and whether it opens a submenu.
function rowRole(item, active) {
    const opens = Array.isArray(item.children);
    return {
        role: 'menuitem',
        'aria-disabled': item.disabled ? 'true' : undefined,
        'aria-haspopup': opens ? 'menu' : undefined,
        'aria-expanded': opens ? String(active) : undefined,
    };
}

const iconCell = (item, c) => h('span', {
    style: {
        width: 16, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0,
        color: item.danger ? c.error : c.accent,
    },
}, item.icon ? tablerIcon(item.icon) : null);

// One entry. `active` keeps an entry lit while the submenu it opened shows.
function MenuRow({ item, c, dense, hasIcons, active, onEnter, onActivate }) {
    const role = rowRole(item, active);
    return h('div', {
        ...role,
        onClick: item.disabled ? undefined : event => {
            event.stopPropagation();
            onActivate(event);
        },
        onMouseEnter: event => {
            if (!item.disabled) event.currentTarget.style.background = item.danger
                ? c.error + '22' : c.hover;
            onEnter(event);
        },
        onMouseLeave: event => { if (!active) event.currentTarget.style.background = 'transparent'; },
        style: rowStyle(item, c, dense, active),
    },
        hasIcons && iconCell(item, c),
        h('span', { style: { flex: 1 } }, item.label),
        item.shortcut && h('span', {
            style: { marginLeft: 16, color: c.textDim, fontSize: 11 },
        }, item.shortcut),
        role['aria-haspopup'] && h('span', { className: 'tf-caret', style: { transform: 'rotate(-90deg)', marginLeft: 16 } }),
    );
}

// One panel of entries: the menu itself, or the submenu one of its entries opened.
function MenuPanel({ panelRef, items, c, dense, position, ariaLabel, activeIndex, onEnterRow, onActivateRow }) {
    const hasIcons = items.some(item => !item.separator && item.icon);
    return h('div', {
        ref: panelRef,
        role: 'menu',
        'aria-label': ariaLabel,
        onClick: event => event.stopPropagation(),
        onContextMenu: event => { event.preventDefault(); event.stopPropagation(); },
        // A wheel turn over the panel scrolls it. Without this the event reaches
        // the backdrop, which closes the menu on any wheel, and a panel long
        // enough to need scrolling could never be scrolled.
        onWheel: event => event.stopPropagation(),
        style: panelStyle(c, dense, position),
    },
        items.map((item, index) => item.separator
            ? h('div', {
                key: `separator-${index}`,
                role: 'separator',
                style: { height: 1, margin: '4px 0', background: c.border },
            })
            : h(MenuRow, {
                key: item.id || `${item.label}-${index}`,
                item, c, dense, hasIcons,
                active: index === activeIndex,
                onEnter: event => onEnterRow(item, index, event),
                onActivate: event => onActivateRow(item, index, event),
            })),
    );
}

/**
 * Theme-aware application context menu, clamped to the visible viewport.
 *
 * An item's `icon` is a name from tablerIcons.js, drawn in the accent colour,
 * or the error colour on a dangerous item. The icon column is drawn only when
 * an item carries an icon; a menu of plain labels would otherwise open with an
 * empty gutter. `dense` is the tighter spacing for menus over a table.
 *
 * An item with `children`, a list of items, runs nothing itself: hovering or
 * clicking it opens them in a submenu beside it, and hovering another entry
 * closes it. Submenus go one level deep.
 */
export function ContextMenu({ x, y, items, c, onClose, ariaLabel = 'Context menu', dense = false }) {
    const menuRef = useRef(null);
    const subRef = useRef(null);
    const [position, setPosition] = useState({ left: x, top: y });
    // The open submenu: the index of the entry that opened it, that entry's
    // rectangle, and once measured, where the submenu fits.
    const [sub, setSub] = useState(null);

    useEffect(() => {
        const menu = menuRef.current;
        if (!menu) return;
        setPosition(clampToViewport(x, y, menu.getBoundingClientRect(), ownerWindow(menu)));
    }, [x, y, items]);

    useEffect(() => {
        const panel = subRef.current;
        if (!sub || sub.placed || !panel) return;
        setSub({ ...sub, placed: submenuPosition(sub.row, panel.getBoundingClientRect(), ownerWindow(panel)) });
    }, [sub]);

    useEffect(() => {
        const handleKeyDown = event => {
            if (event.key === 'Escape') onClose();
        };
        return listenForDismiss(menuRef.current, { keydown: handleKeyDown });
    }, [onClose]);

    const openSub = (index, event) => {
        if (sub?.index === index) return;
        setSub({ index, row: event.currentTarget.getBoundingClientRect(), placed: null });
    };
    const run = item => {
        onClose();
        item.onClick?.();
    };
    const subItems = sub && items[sub.index]?.children;

    return h('div', {
        onClick: onClose,
        onContextMenu: event => { event.preventDefault(); onClose(); },
        onWheel: onClose,
        style: { position: 'fixed', inset: 0, zIndex: 1000 },
    },
        h(MenuPanel, {
            panelRef: menuRef, items, c, dense, position, ariaLabel,
            activeIndex: subItems ? sub.index : -1,
            onEnterRow: (item, index, event) => {
                if (item.children && !item.disabled) openSub(index, event);
                else setSub(null);
            },
            onActivateRow: (item, index, event) => (item.children ? openSub(index, event) : run(item)),
        }),
        subItems && h(MenuPanel, {
            panelRef: subRef, items: subItems, c, dense,
            position: sub.placed || { left: sub.row.right + 1, top: sub.row.top - PANEL_INSET },
            ariaLabel: items[sub.index].label,
            activeIndex: -1,
            onEnterRow: () => {},
            onActivateRow: (item) => run(item),
        }),
    );
}
