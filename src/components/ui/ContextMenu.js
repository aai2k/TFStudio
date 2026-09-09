import { ownerWindow, listenForDismiss } from './ownerWindow.js';

const { createElement: h, useEffect, useRef, useState } = React;

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

/**
 * Theme-aware application context menu, clamped to the visible viewport.
 *
 * The icon column is drawn only when an item carries an icon; a menu of plain
 * labels would otherwise open with an empty gutter. `dense` is the tighter
 * spacing for menus over a table.
 */
export function ContextMenu({ x, y, items, c, onClose, ariaLabel = 'Context menu', dense = false }) {
    const menuRef = useRef(null);
    const [position, setPosition] = useState({ left: x, top: y });
    const hasIcons = items.some(item => !item.separator && item.icon);

    useEffect(() => {
        const menu = menuRef.current;
        if (!menu) return;
        setPosition(clampToViewport(x, y, menu.getBoundingClientRect(), ownerWindow(menu)));
    }, [x, y, items]);

    useEffect(() => {
        const handleKeyDown = event => {
            if (event.key === 'Escape') onClose();
        };
        return listenForDismiss(menuRef.current, { keydown: handleKeyDown });
    }, [onClose]);

    return h('div', {
        onClick: onClose,
        onContextMenu: event => { event.preventDefault(); onClose(); },
        onWheel: onClose,
        style: { position: 'fixed', inset: 0, zIndex: 1000 },
    },
        h('div', {
            ref: menuRef,
            role: 'menu',
            'aria-label': ariaLabel,
            onClick: event => event.stopPropagation(),
            onContextMenu: event => { event.preventDefault(); event.stopPropagation(); },
            // A wheel turn over the menu scrolls it. Without this the event
            // reaches the backdrop, which closes the menu on any wheel, and a
            // menu long enough to need scrolling could never be scrolled.
            onWheel: event => event.stopPropagation(),
            style: {
                position: 'fixed', left: position.left, top: position.top,
                minWidth: dense ? 150 : 190, padding: '4px 0', zIndex: 1001,
                // A menu listing something open-ended, project folders say, can
                // outgrow the window; without this its lower items sit off
                // screen with no way to reach them.
                maxHeight: '80vh', overflowY: 'auto',
                background: c.panel, border: `1px solid ${c.border}`,
                borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
            },
        },
            items.map((item, index) => item.separator
                ? h('div', {
                    key: `separator-${index}`,
                    role: 'separator',
                    style: { height: 1, margin: '4px 0', background: c.border },
                })
                : h('div', {
                    key: item.id || `${item.label}-${index}`,
                    role: 'menuitem',
                    'aria-disabled': item.disabled ? 'true' : undefined,
                    onClick: item.disabled ? undefined : event => {
                        event.stopPropagation();
                        onClose();
                        item.onClick?.();
                    },
                    onMouseEnter: event => {
                        if (!item.disabled) event.currentTarget.style.background = item.danger
                            ? c.error + '22' : c.hover;
                    },
                    onMouseLeave: event => { event.currentTarget.style.background = 'transparent'; },
                    style: {
                        display: 'flex', alignItems: 'center', gap: 8,
                        minHeight: dense ? 24 : 28, padding: dense ? '3px 10px' : '4px 12px',
                        fontSize: dense ? 12 : 13,
                        whiteSpace: 'nowrap', cursor: item.disabled ? 'default' : 'pointer',
                        opacity: item.disabled ? 0.4 : 1,
                        color: item.danger ? c.error : c.text,
                    },
                },
                    hasIcons && h('span', {
                        style: {
                            width: 16, display: 'flex', alignItems: 'center',
                            justifyContent: 'center', flexShrink: 0,
                            color: item.danger ? c.error : c.textDim,
                        },
                    }, item.icon || null),
                    h('span', { style: { flex: 1 } }, item.label),
                    item.shortcut && h('span', {
                        style: { marginLeft: 16, color: c.textDim, fontSize: 11 },
                    }, item.shortcut),
                )),
        ),
    );
}
