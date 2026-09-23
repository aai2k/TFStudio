/**
 * The game canvas: a fixed 720x420 logical stage scaled to the docked window.
 *
 * Games draw in stage units. The backing store is sized from the canvas's
 * on-screen width times the device pixel ratio, so a large window renders
 * sharp instead of stretching a 720-wide image.
 *
 * Keys are bound to the canvas, not the document, so the games only receive
 * arrows and space while the canvas has focus.
 *
 * Only the active tab of a dock group is mounted, so switching tabs or closing
 * the window stops the loop and ends the run in progress. Best scores are kept.
 */

export const W = 720;
export const H = 420;

// Upper limit on the backing store scale: 2880x1680 at most.
const MAX_SCALE = 4;

const PREVENT = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/**
 * Bind a game to a canvas and start it.
 * @returns {() => void} stop, which removes every listener and cancels the loop
 */
export function startStage({ canvas, game, skin }) {
    // A torn-off window is a separate OS window, so the canvas may not be in the
    // document this module was loaded from. Frames and resize events must come
    // from the canvas's own window: the browser stops serving animation frames
    // to a window that is behind another one, and a loop driven from the main
    // window stalls and leaves the torn-off stage blank.
    const view = canvas.ownerDocument.defaultView;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let last = 0;

    // Device pixels per stage unit. Before layout the canvas has no width, so
    // the device pixel ratio alone is used.
    const scaleNow = () => {
        const dpr = view.devicePixelRatio || 1;
        const onScreen = canvas.getBoundingClientRect().width;
        return Math.min(onScreen > 0 ? (onScreen / W) * dpr : dpr, MAX_SCALE);
    };

    let scale = 0;
    const resize = () => {
        const next = scaleNow();
        // Resizing the backing store clears it, so skip changes too small to matter.
        if (Math.abs(next - scale) < 0.01) return;
        scale = next;
        canvas.width = Math.round(W * scale);
        canvas.height = Math.round(H * scale);
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    resize();

    // Keys the game has been told are down. If focus leaves the canvas while one
    // is held, its key-up goes elsewhere, so they are released on blur.
    const held = new Set();
    const onKeyDown = (e) => {
        if (PREVENT.indexOf(e.code) >= 0) e.preventDefault();
        if (e.repeat) return;
        held.add(e.code);
        game.onKey?.(e.code, true);
    };
    const onKeyUp = (e) => {
        held.delete(e.code);
        game.onKey?.(e.code, false);
    };
    const onBlur = () => {
        for (const code of held) game.onKey?.(code, false);
        held.clear();
    };

    // No preventDefault here: on pointerdown it also cancels the mousedown that
    // closes open menus elsewhere in the app. Scrolling and text selection are
    // turned off in the canvas style instead.
    const pointer = (type) => (e) => {
        if (type === 'pointerdown') {
            canvas.focus();
            // Capture throws for a pointer already released. The event must
            // still reach the game.
            try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* keep going */ }
        }
        const r = canvas.getBoundingClientRect();
        game.onPointer?.(
            type === 'pointercancel' ? 'pointerup' : type,
            (e.clientX - r.left) * (W / r.width),
            (e.clientY - r.top) * (H / r.height),
        );
    };
    const pointerHandlers = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']
        .map(type => [type, pointer(type)]);

    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('blur', onBlur);
    for (const [type, fn] of pointerHandlers) canvas.addEventListener(type, fn);
    // The dock can resize the canvas without resizing the window, and moving to
    // another display changes the pixel ratio without resizing the canvas, so
    // both are watched.
    view.addEventListener('resize', resize);
    const paneResize = new view.ResizeObserver(resize);
    paneResize.observe(canvas);

    const paint = () => {
        game.draw(ctx);
        skin.post(ctx);
    };
    // Paint the first frame now rather than waiting for the first animation frame.
    paint();

    const tick = (ts) => {
        // Clamped, so a window hidden for a while does not resume with one huge step.
        const dt = last ? Math.min((ts - last) / 1000, 0.05) : 0;
        last = ts;
        game.update(dt);
        paint();
        raf = view.requestAnimationFrame(tick);
    };
    raf = view.requestAnimationFrame(tick);

    return () => {
        view.cancelAnimationFrame(raf);
        canvas.removeEventListener('keydown', onKeyDown);
        canvas.removeEventListener('keyup', onKeyUp);
        canvas.removeEventListener('blur', onBlur);
        for (const [type, fn] of pointerHandlers) canvas.removeEventListener(type, fn);
        view.removeEventListener('resize', resize);
        paneResize.disconnect();
    };
}
