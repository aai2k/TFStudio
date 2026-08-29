// ── Chrome for a torn-off tool window ─────────────────────────────────────────
//
// The window is frameless, like the main one, so this strip is its whole title
// bar: the tool's name on the left, then the window buttons. Dragging it moves
// the window, exactly as a title bar does, and dropping it over the layout
// docks the tool.
//
// The window buttons talk to the main process through the child window's own
// bridge, not this document's, or they would act on the main window.

import { HelpButton } from '../ui/HelpButton.js';
import { TabIcon } from './TabGroup.js';

const { createElement: h, useState, useEffect } = React;

const CtrlBtn = ({ c, title, danger, onClick, children }) => {
    const [hov, setHov] = useState(false);
    return h('button', {
        onClick, title,
        onMouseDown: (e) => e.stopPropagation(),
        onMouseEnter: () => setHov(true),
        onMouseLeave: () => setHov(false),
        style: {
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: '100%', flexShrink: 0,
            border: 'none', padding: 0, outline: 'none', cursor: 'pointer',
            backgroundColor: hov ? (danger ? '#e81123' : c.hover) : 'transparent',
            color: hov && danger ? '#ffffff' : c.text,
            transition: 'background-color 0.15s, color 0.15s',
        }
    }, children);
};

const glyph = (d, extra) => h('svg', { width: 11, height: 11, viewBox: '0 0 11 11', fill: 'none' },
    h('path', { d, stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    extra);

export function FloatFrame({
    c, t, toolId, title, locale, ribbonStyle = 'colorful', win,
    helpAnchor, onDock, onClose, onDragOver, onDrop, children,
}) {
    const colorful = ribbonStyle !== 'minimalist';
    const dk = (t && t.docking) || {};
    const [isMaximized, setIsMaximized] = useState(false);

    // The child window's own bridge, not this document's: `window.electronAPI`
    // here belongs to the main window and would minimize the wrong thing.
    const control = (action) => { try { win?.electronAPI?.windowControl?.(action); } catch (_) {} };

    useEffect(() => {
        if (!win?.electronAPI) return;
        try {
            win.electronAPI.onWindowMaximized?.(() => setIsMaximized(true));
            win.electronAPI.onWindowUnmaximized?.(() => setIsMaximized(false));
        } catch (_) {}
    }, [win]);

    // Dragging the title bar moves the window, and the app does the moving
    // rather than the OS. An OS window drag delivers no mouse events here, so
    // the layout underneath cannot light its drop targets as the window passes
    // over them, which is how the window gets docked again.
    //
    // Cursor and window position track each other: the pointer's screen
    // position is the window's own origin plus the pointer inside it, and both
    // halves change together as the window follows, so the grab point stays put.
    const handleStripMouseDown = (e) => {
        if (e.button !== 0 || !win) return;
        e.preventDefault();
        const doc = e.currentTarget.ownerDocument;
        const grabX = e.clientX, grabY = e.clientY;
        let moved = false;

        const screenPoint = (me) => ({
            x: (win.screenX || 0) + me.clientX,
            y: (win.screenY || 0) + me.clientY,
        });

        const onMove = (me) => {
            // A mouseup can be lost to a focus change mid-drag; the next move
            // then arrives with no button held. Finishing the drag here keeps
            // the window from following a released pointer, and closes the
            // window-move bracket the lost mouseup would have closed.
            if (me.buttons === 0) { onUp(me); return; }
            if (!moved && Math.hypot(me.clientX - grabX, me.clientY - grabY) <= 4) return;
            moved = true;
            const at = screenPoint(me);
            // Position only. The size is the main process's business: measuring
            // it here, in CSS pixels, resized the window a little on every grab.
            try { win.electronAPI?.moveWindow?.({ x: at.x - grabX, y: at.y - grabY }); } catch (_) {}
            onDragOver?.(at);
        };

        const onUp = (me) => {
            doc.removeEventListener('mousemove', onMove);
            doc.removeEventListener('mouseup', onUp);
            if (moved) {
                // Closes the drag bracket: resize events after this are the
                // user's again. See the window-move handler.
                try { win.electronAPI?.moveWindow?.({ end: true }); } catch (_) {}
                onDrop?.(screenPoint(me));
            }
        };

        doc.addEventListener('mousemove', onMove);
        doc.addEventListener('mouseup', onUp);
    };

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column',
            width: '100%', height: '100%', overflow: 'hidden',
            backgroundColor: c.panel, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif',
        }
    },
        h('div', {
            onMouseDown: handleStripMouseDown,
            title: dk.dragToDock || 'Drag onto the main window to dock',
            style: {
                display: 'flex', alignItems: 'stretch', flexShrink: 0,
                height: 32, backgroundColor: c.bg,
                borderBottom: `1px solid ${c.border}`,
                userSelect: 'none', fontSize: 12,
                cursor: 'default',
            }
        },
            // The window's name, not a tab. There is one tool in this window and
            // nothing to switch to, so a tab here only makes it look like the
            // layout it just left. Dragging the strip moves the window, and
            // dropping it over the layout is what docks it.
            h('div', {
                style: {
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '0 12px', minWidth: 0, color: c.text,
                }
            },
                h(TabIcon, { toolId, colorful }),
                h('span', {
                    style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                }, title)
            ),

            h('div', { style: { flex: 1 } }),

            helpAnchor && h('div', {
                // The strip is the window's drag handle, so anything on it that
                // is not the handle has to keep its own mousedown.
                onMouseDown: (e) => e.stopPropagation(),
                style: {
                    display: 'flex', alignItems: 'center', padding: '0 8px',
                    flexShrink: 0,
                }
            },
                h(HelpButton, { c, anchor: helpAnchor, locale, size: 18, title: 'Help for this window (F1)' })
            ),

            h(CtrlBtn, { c, title: dk.dock || 'Dock back into the layout', onClick: onDock },
                h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none' },
                    h('rect', { x: 0.75, y: 1.75, width: 10.5, height: 8.5, rx: 1, stroke: 'currentColor', strokeWidth: 1 }),
                    h('path', { d: 'M0.75 4.5h10.5M6 4.5v5.75', stroke: 'currentColor', strokeWidth: 1 }))),

            h(CtrlBtn, { c, title: dk.minimize || 'Minimize', onClick: () => control('minimize') },
                glyph('M1 5.5h9')),

            h(CtrlBtn, { c, title: dk.maximize || 'Maximize', onClick: () => control('maximize') },
                isMaximized
                    ? glyph('M3.5 1.5h6v6',
                        h('rect', { x: 0.5, y: 3.5, width: 7, height: 7, stroke: 'currentColor', strokeWidth: 1, fill: 'none' }))
                    : h('svg', { width: 11, height: 11, viewBox: '0 0 11 11', fill: 'none' },
                        h('rect', { x: 0.5, y: 0.5, width: 10, height: 10, stroke: 'currentColor', strokeWidth: 1 }))),

            h(CtrlBtn, { c, title: dk.close || 'Close', danger: true, onClick: onClose },
                glyph('M1 1l9 9M10 1L1 10'))
        ),

        h('div', {
            'data-tutorial-tool': toolId,
            style: { flex: 1, overflow: 'hidden', position: 'relative', backgroundColor: c.panel }
        }, children)
    );
}
