/**
 * Drawing rules shared by every Plotly chart in the app, so a chart cannot be
 * written that follows some of them and not others. Three separate failures are
 * being prevented here, all of them visible while a window is being resized.
 *
 * **Draw on every render, do not ask Plotly to resize.** Dragging a window edge
 * updates the docking layout on every mouse move, so a window re-renders
 * throughout the drag. Redrawing each time keeps the plot glued to the edge.
 * `Plotly.Plots.resize` defers through an internal timeout and lands roughly a
 * second late, so the plot visibly trails the window. A resize is a brief,
 * deliberate gesture; paying for a redraw per frame while it lasts is the right
 * trade. Callers keep a ResizeObserver as well, for size changes that do not
 * re-render, such as dragging the application window's own border.
 *
 * **Hand Plotly a layout it may keep.** Plotly writes the ranges, domains and
 * sizes it computes back into the layout object it is given. A memoized layout
 * therefore accumulates them, and one draw at an awkward size pins that state
 * permanently: squeeze a window to a sliver and it stays a sliver however it is
 * dragged afterwards. Build the layout fresh for every draw, nested axis objects
 * included. A shallow copy is not enough, because the axes are what get written.
 *
 * **Never draw into a box with no room in it.** Below its own margins the plot
 * area is zero or negative, Plotly divides by that length to place the axis
 * titles, and every computed position becomes Infinity. The draw then aborts
 * partway through and leaves a layout that later draws cannot repair.
 */

const { useEffect } = React;

/** Whether the element leaves any plot area once the axis margins come out. */
export function hasRoomToDraw(element, layout) {
    // A host that does not report element sizes cannot be judged, so let the
    // draw through rather than skipping it for a box that may be perfectly fine.
    if (!Number.isFinite(element.clientWidth) || !Number.isFinite(element.clientHeight)) return true;
    const margin = (layout && layout.margin) || {};
    const width = element.clientWidth - (margin.l || 0) - (margin.r || 0);
    const height = element.clientHeight - (margin.t || 0) - (margin.b || 0);
    return width > 10 && height > 10;
}

/**
 * Whether the element is on screen at all.
 *
 * Only the active tab of a dock group is displayed; the others are
 * `display: none`, which collapses their boxes and fires their ResizeObserver.
 * Plotly refuses to resize a plot it cannot measure, so a resize aimed at a
 * hidden plot has to be dropped rather than attempted. The tab redraws at its
 * real size when it is selected again.
 */
export function isDisplayed(element) {
    if (!element) return false;
    // As in hasRoomToDraw: a host that does not report element sizes cannot be
    // judged, so it is taken at its word rather than treated as hidden.
    if (!Number.isFinite(element.offsetWidth) && !Number.isFinite(element.offsetHeight)) return true;
    return !!(element.offsetWidth || element.offsetHeight);
}

// The layout actually handed to Plotly: autosizing on, and no explicit size,
// since either one pinned into the layout overrides the element's own size.
// Copied rather than edited in place, so a caller that keeps its layout object
// does not accumulate what Plotly writes back into it.
function sizedLayout(layout) {
    const sized = { autosize: true, ...layout };
    delete sized.width;
    delete sized.height;
    return sized;
}

/**
 * Draw `traces`/`layout` into `element`, creating the plot on first call.
 *
 * `layout` must be freshly built by the caller on every call. `initRef` is a ref
 * the caller also passes to `usePlotTeardown`, so both agree on whether a plot
 * currently exists.
 */
export function drawPlot(element, initRef, traces, layout, config) {
    if (!element || typeof Plotly === 'undefined') return;
    // autosize is what makes Plotly take its size from the element. Without it a
    // size measured once is reapplied on every later draw.
    const sized = sizedLayout(layout);
    if (!hasRoomToDraw(element, sized)) return;
    if (!initRef.current) {
        Plotly.newPlot(element, traces, sized, config);
        initRef.current = true;
    } else {
        Plotly.react(element, traces, sized, config);
    }
}

/**
 * `drawPlot` for callers that let `Plotly.react` create the plot on first use
 * and so keep no initialized flag of their own.
 */
export function reactPlot(element, traces, layout, config) {
    if (!element || typeof Plotly === 'undefined') return;
    const sized = sizedLayout(layout);
    if (!hasRoomToDraw(element, sized)) return;
    Plotly.react(element, traces, sized, config);
}

/**
 * Releases the plot when the component unmounts, and covers size changes that
 * arrive without a render.
 */
export function usePlotTeardown(divRef, initRef) {
    useEffect(() => {
        const element = divRef.current;
        if (!element) return undefined;
        const observer = new ResizeObserver(() => {
            if (initRef.current && isDisplayed(element)) Plotly.Plots.resize(element);
        });
        observer.observe(element);
        return () => {
            observer.disconnect();
            try { Plotly.purge(element); } catch (_) { /* already gone */ }
            initRef.current = false;
        };
    }, []);
}
