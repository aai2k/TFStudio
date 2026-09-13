/**
 * The window-shaped thing that follows the cursor while a tab is being dragged,
 * and the handle a drag uses to move and dismiss it.
 */

import { toScreenPoint } from './PopoutWindow.js';

// ── Drag preview ──────────────────────────────────────────────────────────────
//
// Dragging a tab drags the window, so the thing under the cursor is shaped like
// the window: the same proportions as the pane it came from, its title strip and
// window buttons, and a dimmed body. A name chip on its own gave no sense of
// what was about to be moved or where it would end up.

const PREVIEW_MAX_W = 340;
const PREVIEW_MAX_H = 250;

export function previewSize(sourceRect) {
    const w = sourceRect?.width || 720;
    const h = sourceRect?.height || 520;
    const scale = Math.min(PREVIEW_MAX_W / w, PREVIEW_MAX_H / h, 1);
    return {
        width: Math.max(200, Math.round(w * scale)),
        height: Math.max(130, Math.round(h * scale)),
    };
}

function makeDragPreview({ c, title, sourceRect }) {
    const { width, height } = previewSize(sourceRect);
    const el = document.createElement('div');
    Object.assign(el.style, {
        position: 'fixed', width: `${width}px`, height: `${height}px`,
        // Held near the title strip, the way a window is held by its title bar.
        transform: 'translate(-38px, -12px)',
        background: c.panel,
        border: `1px solid ${c.accent}`,
        borderRadius: '4px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
        opacity: '0.9', pointerEvents: 'none', overflow: 'hidden',
        zIndex: '99999', userSelect: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    const strip = document.createElement('div');
    Object.assign(strip.style, {
        display: 'flex', alignItems: 'center', height: '24px',
        padding: '0 8px', background: c.bg,
        borderBottom: `1px solid ${c.border}`,
        color: c.text, fontSize: '11px',
    });
    const name = document.createElement('span');
    name.textContent = title;
    Object.assign(name.style, {
        flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    });
    const buttons = document.createElement('span');
    buttons.textContent = '– □ ×';
    Object.assign(buttons.style, { color: c.textDim, fontSize: '10px', letterSpacing: '2px' });
    strip.append(name, buttons);

    const body = document.createElement('div');
    Object.assign(body.style, { flex: '1', height: `${height - 24}px`, background: c.panel });

    el.append(strip, body);
    return el;
}

// Start the preview and hand back the two things a drag does with it.
//
// In the app it is a window of its own, because an element cannot be painted
// outside the window that owns it: as a `<div>` the preview was cut off at the
// frame edge, which is precisely where a tear-off is aimed. The browser build
// has no windows to give it and no desktop to drop it on, so there it stays an
// element and the viewport is the whole world anyway.
export function startDragPreview({ c, title, sourceRect, clientX, clientY }) {
    const { width, height } = previewSize(sourceRect);
    const bridge = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.dragGhost;

    if (bridge) {
        bridge.show({
            ...toScreenPoint(window, clientX, clientY), width, height, title,
            // Where the pane sits in the page, so the preview can be given a
            // picture of it and carry the window's contents rather than a blank
            // box with its name on it.
            pane: sourceRect && {
                x: sourceRect.left, y: sourceRect.top,
                width: sourceRect.width, height: sourceRect.height,
            },
            panel: c.panel, bg: c.bg, border: c.border,
            accent: c.accent, text: c.text, textDim: c.textDim,
        });
        return {
            move: (x, y) => bridge.move(toScreenPoint(window, x, y)),
            end: () => bridge.hide(),
        };
    }

    const el = makeDragPreview({ c, title, sourceRect });
    el.style.left = `${clientX}px`;
    el.style.top = `${clientY}px`;
    document.body.appendChild(el);
    return {
        move: (x, y) => { el.style.left = `${x}px`; el.style.top = `${y}px`; },
        end: () => { if (el.parentNode) el.parentNode.removeChild(el); },
    };
}
