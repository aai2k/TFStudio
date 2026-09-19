/**
 * The mouse plumbing a draggable divider needs, shared by every split in the
 * app: the docking layout's panes and the Data Exchange import windows' panel.
 *
 * What differs between them is only the sizing, a share of the container in one
 * and pixels in the other. Everything around it is the same, including the one
 * thing that is easy to get wrong: React is kept out of the drag. Routing every
 * mouse move through state means the panes cannot move until a render commits,
 * which lands a frame or more after the cursor and is what makes a divider
 * trail it. The caller resizes the elements itself in `track`, and state is
 * caught up once per frame purely so the sizes persist.
 */

/**
 * Start a divider drag from the mousedown on it.
 *
 * @param {object} event  the mousedown event
 * @param {object} options
 *   options.axis    'h' for a divider dragged left and right, 'v' for up and down
 *   options.track   (moveEvent) => value|null  resize the elements and return the
 *                   value to persist, or null when the move changed nothing
 *   options.commit  (value) => void  called at most once per frame, and once when
 *                   the button is released, with the last value `track` returned
 */
export function startDividerDrag(event, { axis, track, commit }) {
    event.preventDefault();
    // The divider can sit in a torn-off window, whose mouse events never reach
    // this module's document: the drag listens on the divider's own.
    const doc = event.currentTarget.ownerDocument;
    const view = doc.defaultView || window;
    // A plain `body { cursor }` loses to any element under the pointer that
    // sets its own, so the cursor flickers as the drag crosses the plots and
    // the toolbars. The class wins everywhere, as layer dragging already does.
    const resizing = `tf-split-resizing-${axis}`;
    let latest = null;
    let committed = null;
    let frame = 0;

    const flush = () => {
        frame = 0;
        if (latest === null || latest === committed) return;
        committed = latest;
        commit(latest);
    };
    const onMove = (move) => {
        const next = track(move);
        if (next === null || next === undefined) return;
        latest = next;
        if (!frame) frame = view.requestAnimationFrame(flush);
    };
    const onUp = () => {
        doc.removeEventListener('mousemove', onMove);
        doc.removeEventListener('mouseup', onUp);
        if (frame) view.cancelAnimationFrame(frame);
        flush();
        doc.documentElement.classList.remove(resizing);
    };

    doc.documentElement.classList.add(resizing);
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
}
