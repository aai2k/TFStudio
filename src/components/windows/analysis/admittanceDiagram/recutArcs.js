/**
 * Cutting the drawn arcs anew as the view moves.
 *
 * The chart is handed the arcs cut to a square a few views wide around the view
 * (chartFigure.js, cutAround). Panning toward its edge, or zooming in until the
 * square is many views wide, calls for a new cut around the view as it is.
 */

import { admittanceLociAround } from './chartFigure.js';

// The arcs are cut anew once the view comes within half its width of the edge
// of their square, which leaves a pan of half a view before the cut ends could
// show, or once the square is more than 8 views wide, twice its width when cut,
// so zooming in keeps the drawn area, and the points in it, near the view.
const RECUT_ROOM = 0.5;
const RECUT_WIDTH = 8;

// What each chart was last drawn from: the loci and their colours and names.
const drawnFrom = new WeakMap();

export function rememberDrawing(chart, drawing) {
    if (chart) drawnFrom.set(chart, drawing);
}

// The Re(Y), Im(Y) window on screen.
function viewOf(chart) {
    const model = chart.getModel();
    const x = model?.getComponent('xAxis', 0)?.axis?.scale?.getExtent();
    const y = model?.getComponent('yAxis', 0)?.axis?.scale?.getExtent();
    return x && y ? { x, y } : null;
}

// The square the drawn arcs were cut to, as their series record it.
function cutOf(chart) {
    return chart.getModel()?.getSeries().find(series => series.option.cutTo)?.option.cutTo || null;
}

function cutStillFits(box, view) {
    const span = Math.max(view.x[1] - view.x[0], view.y[1] - view.y[0]);
    const room = Math.min(view.x[0] - box.x[0], box.x[1] - view.x[1], view.y[0] - box.y[0], box.y[1] - view.y[1]);
    return room >= RECUT_ROOM * span && box.x[1] - box.x[0] <= RECUT_WIDTH * span;
}

function needsRecut(chart) {
    if (!drawnFrom.has(chart)) return false;
    const box = cutOf(chart), view = viewOf(chart);
    if (!box || !view) return false;
    return !cutStillFits(box, view);
}

function recut(chart) {
    const drawing = drawnFrom.get(chart), view = viewOf(chart);
    if (chart.isDisposed?.() || !drawing || !view) return;
    const series = admittanceLociAround(drawing.series, drawing.matColorMap, drawing.matName, view,
        { marks: drawing.marks });
    chart.setOption({ series }, { notMerge: false, lazyUpdate: false });
}

/**
 * After every render, cut the arcs anew around the view if it has outgrown
 * their square. Pan, wheel, box zoom and both resets all end in a render.
 * ECharts ignores setOption while it is still processing an update, so the new
 * cut is applied once the current one has finished.
 */
export function bindRecut(chart) {
    let queued = false;
    chart.on('finished', () => {
        if (queued || !needsRecut(chart)) return;
        queued = true;
        Promise.resolve().then(() => {
            queued = false;
            recut(chart);
        });
    });
}
