/**
 * The window and documents an overlay actually belongs to.
 *
 * A torn-off tool renders through a React portal into its own OS window, so the
 * `window` and `document` a component module closes over are the main window's,
 * whatever window the component is drawn in. An overlay placed against those is
 * measured against the wrong viewport, and a listener registered on that
 * document never sees a click in the torn-off one: the two documents share no
 * event path.
 *
 * Anything that positions an overlay or watches for a click outside one takes
 * its window from the element it is anchored to instead.
 */

/** The window `element` is rendered in; the main window when it is unmounted. */
export function ownerWindow(element) {
    return element?.ownerDocument?.defaultView || window;
}

/**
 * The documents an outside-click or Escape listener has to cover: the one
 * holding the overlay, plus the main document when the overlay is in a torn-off
 * window. Covering both is what closes an open picker when the user clicks in
 * the other window, the same as clicking beside it in its own.
 */
export function dismissDocuments(element) {
    const own = element?.ownerDocument;
    return !own || own === document ? [document] : [own, document];
}

/**
 * Mount `handlers`, given as `{ eventType: listener }`, on every document an
 * overlay anchored to `element` has to hear from, and hand back the teardown
 * for them. Shaped for an effect: `return listenForDismiss(ref.current, { … })`.
 */
export function listenForDismiss(element, handlers) {
    const docs = dismissDocuments(element);
    const entries = Object.entries(handlers);
    const each = (method) => {
        for (const doc of docs) for (const [type, fn] of entries) doc[method](type, fn);
    };
    each('addEventListener');
    return () => each('removeEventListener');
}
