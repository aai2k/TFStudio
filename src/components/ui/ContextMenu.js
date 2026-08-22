const { createElement: h, useEffect, useRef, useState } = React;

/** Theme-aware application context menu, clamped to the visible viewport. */
export function ContextMenu({ x, y, items, c, onClose, ariaLabel = 'Context menu' }) {
    const menuRef = useRef(null);
    const [position, setPosition] = useState({ left: x, top: y });

    useEffect(() => {
        const menu = menuRef.current;
        if (!menu) return;
        const bounds = menu.getBoundingClientRect();
        setPosition({
            left: Math.max(4, Math.min(x, window.innerWidth - bounds.width - 4)),
            top: Math.max(4, Math.min(y, window.innerHeight - bounds.height - 4)),
        });
    }, [x, y, items]);

    useEffect(() => {
        const handleKeyDown = event => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
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
            style: {
                position: 'fixed', left: position.left, top: position.top,
                minWidth: 190, padding: '4px 0', zIndex: 1001,
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
                        minHeight: 28, padding: '4px 12px', fontSize: 13,
                        whiteSpace: 'nowrap', cursor: item.disabled ? 'default' : 'pointer',
                        opacity: item.disabled ? 0.4 : 1,
                        color: item.danger ? c.error : c.text,
                    },
                },
                    h('span', {
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
