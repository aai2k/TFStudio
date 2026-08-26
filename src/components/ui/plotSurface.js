/**
 * Shared lifecycle and resize rules for every Apache ECharts surface.
 *
 * Docked windows can briefly collapse to a sliver or become `display:none`.
 * ECharts handles ordinary resizing well, but it still needs a measurable box.
 * Keeping these checks in one place prevents hidden tabs from being resized and
 * avoids creating a canvas whose drawable area is empty.
 */

const { useEffect, useRef } = React;

function numericInset(value) {
    return Number.isFinite(value) ? value : 0;
}

/** Whether the element leaves any chart area once the grid insets come out. */
export function hasRoomToDraw(element, option) {
    if (!element) return false;
    if (!Number.isFinite(element.clientWidth) || !Number.isFinite(element.clientHeight)) return true;
    const grid = Array.isArray(option?.grid) ? option.grid[0] || {} : option?.grid || {};
    const width = element.clientWidth - numericInset(grid.left) - numericInset(grid.right);
    const height = element.clientHeight - numericInset(grid.top) - numericInset(grid.bottom);
    return width > 10 && height > 10;
}

/** Whether the element is currently displayed by the docking layout. */
export function isDisplayed(element) {
    if (!element) return false;
    if (!Number.isFinite(element.offsetWidth) && !Number.isFinite(element.offsetHeight)) return true;
    return !!(element.offsetWidth || element.offsetHeight);
}

function runtime() {
    return globalThis.echarts;
}

// The option each chart is currently showing.
//
// Chart components rebuild their option on every render and have no dependency
// array, which is deliberate: it keeps the drawing in step with the design
// without every window having to enumerate what it depends on. The cost is that
// dragging a docking splitter re-renders the tree on each mouse move, and
// reapplying an option with `notMerge` discards and rebuilds the whole chart
// model, which reads as a flicker. Comparing against what is already displayed
// turns those renders into no-ops, leaving the ResizeObserver's `resize()` as
// the only work a resize does.
//
// Keyed by the instance, so a disposed chart drops its entry with it.
const appliedOptions = new WeakMap();

// How many values a comparison may look at before giving up and redrawing.
// Plot Engine permits a 700x700 surface, and comparing half a million points
// costs more than the redraw would, so the check is capped. Past the cap the
// answer is "not equal", which only ever means an extra redraw: a chart that
// large falls back to the behaviour it had before, never to a stale picture.
const COMPARE_BUDGET = 40000;
let remainingComparisons = 0;

function equalValue(a, b) {
    if (a === b) return true;
    if (--remainingComparisons < 0) return false;
    const type = typeof a;
    if (type !== typeof b) return false;
    // Formatters are rebuilt as new closures on every render, so comparing them
    // by identity would make every option look changed and skip nothing. What a
    // formatter closes over (a unit, a decimal count) is in practice also
    // visible elsewhere in the option, in an axis name or in the data itself,
    // so a real change still registers through that.
    if (type === 'function') return true;
    if (type === 'number') return Number.isNaN(a) && Number.isNaN(b);
    if (type !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (let index = 0; index < a.length; index++) {
            if (!equalValue(a[index], b[index])) return false;
        }
        return true;
    }
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
        if (!equalValue(a[key], b[key])) return false;
    }
    return true;
}

/** Whether two options would draw the same chart, within the budget above. */
function sameOption(a, b) {
    remainingComparisons = COMPARE_BUDGET;
    return equalValue(a, b);
}

// Summing the series lengths costs one addition per series, so a chart far over
// the budget is recognised before any of its points are walked. Measured from
// the series alone, which is where the size lives, and recomputed every call, so
// a chart that shrinks starts being compared again.
const MAX_COMPARED_POINTS = 20000;

function worthComparing(option) {
    const series = option?.series;
    if (!Array.isArray(series)) return true;
    let points = 0;
    for (const item of series) {
        if (Array.isArray(item?.data)) points += item.data.length;
        if (points > MAX_COMPARED_POINTS) return false;
    }
    return true;
}

// A chart driven by a running job rebuilds the same option every tick with new
// numbers in it. Replacing that option with `notMerge` discards the whole chart
// model, and the tooltip and axis pointer are part of what goes with it, so a
// stationary crosshair loses its readout on every progress tick. Where the new
// option differs from the applied one only in series data, the model can stay
// alive and take the new numbers by merge instead, which is what ECharts
// documents for streaming updates. It also keeps a wheel zoom across the tick.
//
// Anything structural still replaces the option: a series added or removed, a
// renamed curve, an axis, a legend, a toolbox. Merging can only ever overwrite,
// never delete, so restricting it to an unchanged shape keeps the guarantee
// that a removed series never lingers.
function optionShape(option) {
    const series = option?.series;
    if (!Array.isArray(series)) return option;
    return { ...option, series: series.map(item => ({ ...item, data: null })) };
}

function mergeableUpdate(previous, option) {
    if (!previous || !Array.isArray(previous.series) || !Array.isArray(option.series)) return false;
    if (previous.series.length !== option.series.length) return false;
    return sameOption(optionShape(previous), optionShape(option));
}

export function chartForElement(element) {
    return element && runtime()?.getInstanceByDom(element) || null;
}

/** Charts whose toolbox rectangle-zoom tool is currently armed. */
const rectangleZoomArmed = new WeakSet();

/**
 * Double-clicking inside the plot area returns every axis to its full range,
 * and the rectangle-zoom tool reports whether it is armed.
 *
 * Charts without a zoom ignore the double-click: `containPixel` is false where
 * there is no grid, and the action reaches no models where none exist. Both are
 * bound once, when the instance is created, so they live exactly as long as the
 * chart does and survive the option replacements below.
 */
function bindZoomHandlers(chart) {
    chart.getZr().on('dblclick', event => {
        if (!chart.containPixel('grid', [event.offsetX, event.offsetY])) return;
        chart.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
    });
    chart.on('globalcursortaken', params => {
        if (params?.key !== 'dataZoomSelect') return;
        if (params.dataZoomSelectActive) rectangleZoomArmed.add(chart);
        else rectangleZoomArmed.delete(chart);
    });
}

/**
 * Disarm the rectangle-zoom tool before an option replaces the one in place.
 *
 * Replacing an option rebuilds the toolbox, and ECharts 6.1 leaves the previous
 * rectangle tool's brush controller mounted on the canvas when it does. An
 * armed controller outlives the model it was built for: it goes on handling
 * drags, converting the pixels through the axes as they stood when it was
 * abandoned and applying the result to the axes that replaced them. A box
 * dragged on a plot that was already zoomed then zooms far past the box, and
 * nothing but disposing the chart clears it, so the plot stays wrong until its
 * window is reopened.
 *
 * Disarming first leaves nothing behind to fire. The tool comes back unarmed,
 * which is what the icon on the rebuilt toolbox shows in any case.
 */
function disarmRectangleZoom(chart) {
    if (!rectangleZoomArmed.has(chart)) return;
    chart.dispatchAction({
        type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: false,
    });
}

/**
 * Create or update a chart using a native ECharts option.
 *
 * `chartRef.current` stores the ECharts instance itself, which gives interactive
 * layers direct access to coordinate conversion and events without querying DOM
 * internals. Options are replaced atomically so removed series/axes never linger.
 */
export function drawChart(element, chartRef, option, initOptions) {
    const api = runtime();
    if (!element || !api || !option || !hasRoomToDraw(element, option)) return null;

    let chart = chartRef.current;
    if (!chart || chart.isDisposed?.()) {
        // Dirty-rect painting must stay off. Resizing reallocates the canvas,
        // which clears it, but the existing elements are not re-marked dirty,
        // so nothing is repainted until the next real update. Dragging a
        // docking splitter then leaves the plot blank for frame after frame.
        // Without it, resize() repaints synchronously and the drag is clean.
        chart = api.getInstanceByDom(element) || api.init(element, null, {
            renderer: 'canvas', ...initOptions,
        });
        chartRef.current = chart;
        bindZoomHandlers(chart);
    }
    const previous = appliedOptions.get(chart);
    if (previous !== undefined && worthComparing(option)
        && sameOption(previous, option)) return chart;
    const merge = mergeableUpdate(previous, option);
    if (!merge) disarmRectangleZoom(chart);
    chart.setOption(option, { notMerge: !merge, lazyUpdate: false });
    appliedOptions.set(chart, option);
    return chart;
}

/** Create/update a chart when the caller does not retain an instance ref. */
export function setChartOption(element, option, initOptions) {
    if (!element) return null;
    const holder = { current: chartForElement(element) };
    return drawChart(element, holder, option, initOptions);
}

/** Resize only a visible, initialized surface. */
export function resizeChart(element, chartRef) {
    if (!element || !isDisplayed(element)) return;
    const chart = chartRef?.current || chartForElement(element);
    if (chart && !chart.isDisposed?.()) chart.resize();
}

/** Dispose a chart owned by an imperative (non-React) caller. */
export function disposeChart(element, chartRef) {
    const chart = chartRef?.current || chartForElement(element);
    if (chart && !chart.isDisposed?.()) chart.dispose();
    if (chartRef) chartRef.current = null;
}

/** Observe non-React size changes and dispose the renderer on unmount. */
export function useChartTeardown(divRef, chartRef, onResize) {
    const resizeCallbackRef = useRef(onResize);
    resizeCallbackRef.current = onResize;
    useEffect(() => {
        const element = divRef.current;
        if (!element) return undefined;
        const observer = new ResizeObserver(() => {
            // ResizeObserver runs after layout and before paint. Resizing here
            // keeps the canvas in lockstep with the docking pane; deferring to
            // requestAnimationFrame exposes one frame of empty background.
            resizeChart(element, chartRef);
            resizeCallbackRef.current?.(chartRef.current);
        });
        observer.observe(element);
        return () => {
            observer.disconnect();
            const chart = chartRef.current || chartForElement(element);
            if (chart && !chart.isDisposed?.()) chart.dispose();
            chartRef.current = null;
        };
    }, []);
}
