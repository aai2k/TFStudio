/**
 * Dragging a grid's fill handle, the small square on the bottom-right corner
 * of the selection. Pressed and dragged down or up it reaches over the rows the
 * pointer passes, and the pane scrolls on while the pointer is past its top or
 * bottom edge, so a fill can run far past the rows in view. A release past the
 * selection fills (gridFill.js); a release back inside it, Escape, or a drag
 * that loses its button or its window fills nothing. Other keys are held back
 * from the table until the drag ends, as a spreadsheet does.
 *
 *   options  read at call time:
 *     source  the rectangle the handle sits on (gridFill.js fillSource), or
 *             null when there is none
 *     onFill(source, reach, ctrl)  a release past the selection; `ctrl` says
 *             whether Ctrl was held at the release
 *
 * `begin(event, geometry)` is the handle's mousedown. `geometry` is the pane
 * the rows scroll in: { pane, header, rowHeight }, `header` being the height
 * of the sticky heading over the first row. While the button is held, `drag`
 * is { source, reach, ctrl, x, y, blankRows }: how far the fill reaches
 * (fillReach), whether Ctrl is down, the pointer in client pixels as it was
 * when either last changed, and how many empty rows the table draws under its
 * last one, a pane's height of them, so the pointer can go below the last row
 * and the pane can scroll on.
 */
import { fillReach } from './gridFill.js';

const { useEffect, useState, useRef, useMemo } = React;

// How fast the pane scrolls: each frame, a third of how far the pointer is past
// the edge. Just past it that is a pixel a frame; held a pane's height past the
// edge, hundreds of rows go by in seconds.
const SCROLL_DIVISOR = 3;

const held = event => !!(event.ctrlKey || event.metaKey);

// The client heights between which the pane shows rows, under its heading.
function rowsBand({ pane, header }) {
    const rect = pane.getBoundingClientRect();
    return { top: rect.top + header, bottom: rect.bottom };
}

// The row under the pointer. A pointer above or below the pane counts as on
// its edge row, so the reach grows past the rows in view only as the pane
// scrolls.
function rowAt(geometry, clientY) {
    const { top, bottom } = rowsBand(geometry);
    const y = Math.min(Math.max(clientY, top), bottom - 1) - top + geometry.pane.scrollTop;
    return Math.floor(y / geometry.rowHeight);
}

// The pixels to scroll this frame: up while the pointer is above the rows, over
// the heading or past it, and down while it is below the pane. Only past the
// edge: a handle pressed on the first or last row in view must not set the pane
// moving on its own.
function scrollStep(geometry, clientY) {
    const { top, bottom } = rowsBand(geometry);
    let depth = 0;
    if (clientY < top) depth = clientY - top;
    else if (clientY > bottom) depth = clientY - bottom;
    return Math.sign(depth) * Math.ceil(Math.abs(depth) / SCROLL_DIVISOR);
}

// A drag in progress is a session `s`: the hook's `ctx`, the pane, its
// document and window, the state shown, the pending animation frame and the
// document listeners.

// The drag is handed to the table again only when the reach or Ctrl changes,
// with the pointer where it is then, not on every pixel the pointer moves: a
// table may redraw much more than its rows each time.
function show(s) {
    const { reach, ctrl } = s.state;
    const shown = `${reach?.up}:${reach?.count}:${ctrl}`;
    if (shown === s.shown) return;
    s.shown = shown;
    s.ctx.setDrag({ ...s.state });
}

function follow(s) {
    s.state.reach = fillReach(s.state.source, rowAt(s.geometry, s.state.y));
    show(s);
}

function autoscroll(s) {
    s.frame = 0;
    const step = scrollStep(s.geometry, s.state.y);
    if (!step) return;
    s.geometry.pane.scrollTop += step;
    follow(s);
    s.frame = s.view.requestAnimationFrame(() => autoscroll(s));
}

// A move with no button down means the release went somewhere this document
// never heard of it, outside the window while another one had focus. Where the
// pointer was then is unknown, so the drag is dropped rather than filled.
function pointerMoved(s, event) {
    if (event.buttons === 0) {
        end(s);
        return;
    }
    Object.assign(s.state, { x: event.clientX, y: event.clientY, ctrl: held(event) });
    follow(s);
    if (!s.frame) s.frame = s.view.requestAnimationFrame(() => autoscroll(s));
}

function end(s) {
    for (const [type, listener] of Object.entries(s.listeners)) s.doc.removeEventListener(type, listener, true);
    s.view.removeEventListener?.('blur', s.lost);
    if (s.frame) s.view.cancelAnimationFrame(s.frame);
    s.ctx.session.current = null;
    s.ctx.setDrag(null);
}

function released(s, event) {
    end(s);
    if (s.state.reach) s.ctx.live.current.onFill(s.state.source, s.state.reach, held(event));
}

// Every key is caught before the table's own keys see it. Escape drops the
// drag, Ctrl changes what a single number fills with, and the rest wait: a
// Delete or an undo under a drag would change the cells it is filling from.
function keyChanged(s, event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') end(s);
    else if (event.key === 'Control' || event.key === 'Meta') {
        s.state.ctrl = event.type === 'keydown';
        show(s);
    }
}

function startSession(ctx, event, geometry) {
    const doc = geometry.pane.ownerDocument;
    const s = {
        ctx, geometry, doc, view: doc.defaultView, frame: 0,
        state: {
            source: ctx.live.current.source, reach: null, ctrl: held(event), x: event.clientX, y: event.clientY,
            blankRows: Math.ceil(geometry.pane.clientHeight / geometry.rowHeight),
        },
    };
    s.listeners = {
        mousemove: e => pointerMoved(s, e),
        mouseup: e => released(s, e),
        keydown: e => keyChanged(s, e),
        keyup: e => keyChanged(s, e),
    };
    // A torn-off window has a document of its own, and the button may be
    // released anywhere in it.
    for (const [type, listener] of Object.entries(s.listeners)) doc.addEventListener(type, listener, true);
    s.lost = () => end(s);
    s.view.addEventListener?.('blur', s.lost);
    ctx.session.current = s;
    show(s);
}

export function useFillDrag(options) {
    const [drag, setDrag] = useState(null);
    const live = useRef();
    const session = useRef(null);
    live.current = options;
    const begin = useMemo(() => (event, geometry) => {
        if (event.button !== 0 || !live.current.source || session.current) return;
        // The press is the handle's, not the cell's under it, which would
        // start a new selection.
        event.preventDefault();
        event.stopPropagation();
        startSession({ live, setDrag, session }, event, geometry);
    }, []);
    // A grid closed with the button still held lets go of the document.
    useEffect(() => () => { if (session.current) end(session.current); }, []);
    return { drag, begin };
}
