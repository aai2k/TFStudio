// A ResizeObserver bound to the document its element actually lives in.
//
// The constructor reached through the global belongs to the window running the
// code, and an observer only reports elements belonging to its own document. A
// tool torn off into its own window is rendered there by a React portal while
// the code observing it still runs in the main window, so a plain
// `new ResizeObserver` on a floated element never fires once: its chart keeps
// whatever size the window had when it opened and spills out of the frame as
// soon as the user resizes it.
//
// Returns the observer, already observing, or null where there is none to be
// had (server rendering, an element that has been detached).
export function observeResize(element, callback) {
    if (!element) return null;
    const view = element.ownerDocument && element.ownerDocument.defaultView;
    const Observer = (view && view.ResizeObserver)
        || (typeof ResizeObserver !== 'undefined' ? ResizeObserver : null);
    if (!Observer) return null;
    const observer = new Observer(callback);
    observer.observe(element);
    return observer;
}
