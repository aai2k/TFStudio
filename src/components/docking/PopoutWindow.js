// ── A tool window living in its own top-level OS window ───────────────────────
//
// `window.open` gives a real desktop window the user can drag to a second
// monitor, but it stays in the main window's renderer process, so its document
// is reachable from here and a React portal can render into it. That is the
// whole reason this is a portal and not a second renderer: the torn-off window
// sits inside the same React tree, under the same DesignContext, so the design,
// `isOptimizing` and the analysis settings are literally the same objects. There
// is no snapshot to serialize and nothing to keep in step during a refinement
// that updates several times a second.
//
// What does NOT come across: native `document` listeners registered in the main
// document never see clicks in this window, and renderer-level modals still open
// over the main window.

const { createElement: h, useState, useEffect, useRef } = React;

// The child document starts empty, so it needs the app's stylesheets. Links are
// cloned by their resolved absolute href because the child's own base URL cannot
// resolve the relative ones. Inline <style> blocks are copied verbatim.
function copyStyles(from, to) {
    for (const node of from.querySelectorAll('link[rel="stylesheet"], style')) {
        if (node.tagName === 'LINK') {
            const link = to.createElement('link');
            link.rel = 'stylesheet';
            link.href = node.href;
            to.head.appendChild(link);
        } else {
            const style = to.createElement('style');
            style.textContent = node.textContent;
            to.head.appendChild(style);
        }
    }
}

// Screen-space position of a point given in a window's client coordinates.
// `screenX`/`screenY` are the viewport's own offset on the desktop, so no frame
// correction is needed. Both windows report CSS pixels, which is what the caller
// compares a drag in one window against the other's viewport with.
export function toScreenPoint(win, clientX, clientY) {
    return { x: (win.screenX || 0) + clientX, y: (win.screenY || 0) + clientY };
}

// The reverse: where a screen point falls inside `win`'s viewport. Returns null
// when the point is outside it, which is what "the pointer left this window"
// means for a tear-off or a redock.
export function toClientPoint(win, screenX, screenY) {
    const x = screenX - (win.screenX || 0);
    const y = screenY - (win.screenY || 0);
    if (x < 0 || y < 0 || x > win.innerWidth || y > win.innerHeight) return null;
    return { x, y };
}

export function PopoutWindow({ id, title, bounds, background, onClose, onWindowReady, children }) {
    const [container, setContainer] = useState(null);
    const winRef = useRef(null);

    useEffect(() => {
        const b = bounds || {};
        const features = [
            `width=${Math.round(b.width || 720)}`,
            `height=${Math.round(b.height || 520)}`,
            `left=${Math.round(b.left ?? 120)}`,
            `top=${Math.round(b.top ?? 120)}`,
        ].join(',');

        const win = window.open('', `tfstudio-float-${id}`, features);
        if (!win) { onClose?.(); return; }
        winRef.current = win;

        const doc = win.document;
        doc.title = title;
        copyStyles(document, doc);
        doc.body.style.margin = '0';
        doc.body.style.overflow = 'hidden';
        doc.body.style.background = background || '#1e1e1e';

        const mount = doc.createElement('div');
        mount.style.cssText = 'width:100vw;height:100vh;display:flex;flex-direction:column;overflow:hidden';
        doc.body.appendChild(mount);
        setContainer(mount);
        onWindowReady?.(win);

        // The user closing the OS window closes the tool, and closing the main
        // window has to take its floats with it or they outlive the app.
        const closed = () => onClose?.();
        win.addEventListener('beforeunload', closed);
        const closeOnExit = () => { try { win.close(); } catch (_) {} };
        window.addEventListener('beforeunload', closeOnExit);

        return () => {
            win.removeEventListener('beforeunload', closed);
            window.removeEventListener('beforeunload', closeOnExit);
            try { win.close(); } catch (_) {}
            winRef.current = null;
        };
        // Opening is a one-shot: a later title or bounds change must not reopen
        // the window. The title is kept in step by the effect below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    useEffect(() => {
        if (winRef.current) winRef.current.document.title = title;
    }, [title]);

    useEffect(() => {
        if (winRef.current) winRef.current.document.body.style.background = background || '#1e1e1e';
    }, [background]);

    if (!container) return null;
    // `children` may be a function so the frame can reach the window it is
    // drawing the title bar for: only that window's bridge controls it.
    const content = typeof children === 'function' ? children(winRef.current) : children;
    return ReactDOM.createPortal(content, container);
}
