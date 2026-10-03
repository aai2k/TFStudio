/**
 * The geometry the target editor overlay (TargetEditorOverlay.js) works in, and
 * what a drag on it amounts to. Pure: the only renderer contract is a chart
 * instance that converts between data and pixel space.
 *
 * An item is one of two shapes:
 *   a line   { opId, x0, y0, x1, y1, color, dash }, a target held by its two
 *            ends and dragged by either end or by its body
 *   a point  { opId, shape: 'point', x0, y0, color }, one reading, which keeps
 *            its wavelength and is dragged up and down
 * An item may carry `yAxisIndex` when it belongs to a second value axis.
 */

const AXES = { xAxisIndex: 0, yAxisIndex: 0 };
const PLOT = { gridIndex: 0 };

export function finitePoint(point) {
    return Array.isArray(point) && point.length >= 2 && point.every(Number.isFinite);
}

/** The axes an item's data coordinates are read on. */
export function itemAxes(item) {
    return item?.yAxisIndex ? { xAxisIndex: 0, yAxisIndex: item.yAxisIndex } : AXES;
}

export function isPointItem(item) {
    return item?.shape === 'point';
}

// The plot area's rectangle in pixels, or null where the chart does not give it.
function plotRect(chart) {
    return chart?.getModel?.()?.getComponent?.('grid', 0)?.coordinateSystem?.getRect?.() || null;
}

/**
 * A pixel moved onto the nearest edge of the plot area when it lies outside.
 * A handle at an axis limit, a T of 100 % on the top edge, is half outside the
 * plot, and a press on that half or a drag past the edge reads the value at the
 * edge instead of nothing. Unchanged where the chart gives no rectangle.
 */
export function clampToPlot(chart, pixel) {
    const rect = plotRect(chart);
    if (!rect) return pixel;
    return [
        Math.min(Math.max(pixel[0], rect.x), rect.x + rect.width),
        Math.min(Math.max(pixel[1], rect.y), rect.y + rect.height),
    ];
}

export function dataPoint(chart, pixel, axes = AXES) {
    // Axis models convert coordinates, but in ECharts 6 they do not own a
    // coordinate system and therefore can never contain a pixel. The grid owns
    // the Cartesian coordinate system, so containment and conversion need
    // different finders.
    if (chart?.containPixel && !chart.containPixel(PLOT, pixel)) return null;
    const point = chart?.convertFromPixel(axes, pixel);
    return finitePoint(point) ? point : null;
}

/** `point` carried by a fixed pixel offset, converted through the chart's axes. */
function shiftedPoint(chart, point, shift) {
    const pixel = chart?.convertToPixel(AXES, point);
    if (!finitePoint(pixel)) return null;
    const moved = chart.convertFromPixel(AXES, [pixel[0] + shift[0], pixel[1] + shift[1]]);
    return finitePoint(moved) ? moved : null;
}

// A handle drag places that end at the pointer. A drag on the line body moves
// the whole line by the pointer's pixel travel, each end converted through the
// axes on its own: on a logarithmic axis a constant pixel step is a constant
// ratio, and adding one data-space difference to both ends would bend the line
// and push its lower end below zero. A point keeps its wavelength.
export function moveGeometry(chart, source, part, current, shift) {
    if (part === 'point') return { ...source, y0: current[1] };
    if (part === 'start') return { ...source, x0: current[0], y0: current[1] };
    if (part === 'end') return { ...source, x1: current[0], y1: current[1] };
    const start = shiftedPoint(chart, [source.x0, source.y0], shift);
    const end = shiftedPoint(chart, [source.x1, source.y1], shift);
    return start && end
        ? { ...source, x0: start[0], y0: start[1], x1: end[0], y1: end[1] }
        : source;
}

export function hasPointerTravelled(start, end, minimum = 3) {
    return finitePoint(start) && finitePoint(end)
        && Math.hypot(end[0] - start[0], end[1] - start[1]) >= minimum;
}

// A point has no far end, and two missing ends are the same end.
export function targetGeometryChanged(source, result) {
    return ['x0', 'y0', 'x1', 'y1'].some(key => !Object.is(Number(source?.[key]), Number(result?.[key])));
}

/**
 * What a released pointer amounts to: `{ create }`, `{ edit }` or null.
 *
 * A pointer that never travelled is a click. A click on empty plot area is
 * ignored unless the host asked for `createOnClick`, in which case it creates
 * a target of zero length at the point pressed: the preview may have wandered
 * a pixel or two before release, so its far end is folded back onto the start.
 */
export function dropOutcome(drag, result, travelled, createOnClick = false) {
    if (!result) return null;
    if (drag.mode === 'create') {
        if (travelled) return { create: result };
        return createOnClick ? { create: { ...result, x1: result.x0, y1: result.y0 } } : null;
    }
    return travelled && targetGeometryChanged(drag.source, result) ? { edit: result } : null;
}

// The wavelengths the overlay spans, read off the x axis at its two edges, or
// null when the chart cannot place them.
function spannedX(chart, width) {
    const left = chart.convertFromPixel(AXES, [0, 0]);
    const right = chart.convertFromPixel(AXES, [width, 0]);
    if (!finitePoint(left) || !finitePoint(right)) return null;
    return [Math.min(left[0], right[0]), Math.max(left[0], right[0])];
}

/**
 * Every item that is drawn, in pixels. Points are drawn only where the plot
 * shows them, and only while there are no more of them in view than the
 * overlay is pixels wide: past that the handles overlap beyond telling apart,
 * and a scan of thousands of points would put thousands of them in the page.
 * A zoom spreads them out.
 */
export function projectGeometry(chart, geometry, width) {
    const lines = geometry.filter(item => !isPointItem(item));
    const span = spannedX(chart, width);
    const points = geometry.filter(item => isPointItem(item) && (!span || (item.x0 >= span[0] && item.x0 <= span[1])));
    const shown = points.length <= width ? points : [];
    return [...lines, ...shown].map(item => projectItem(chart, item)).filter(Boolean);
}

/**
 * An item in pixels: `start` and, for a line, `end`. Null when it cannot be
 * placed, and for a point outside the plot, which a zoom has left off it.
 */
export function projectItem(chart, item) {
    const axes = itemAxes(item);
    const start = chart.convertToPixel(axes, [item.x0, item.y0]);
    if (!finitePoint(start)) return null;
    if (isPointItem(item)) {
        return !chart.containPixel || chart.containPixel(PLOT, start) ? { ...item, start } : null;
    }
    const end = chart.convertToPixel(axes, [item.x1, item.y1]);
    return finitePoint(end) ? { ...item, start, end } : null;
}
