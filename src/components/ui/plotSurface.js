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

export function chartForElement(element) {
    return element && runtime()?.getInstanceByDom(element) || null;
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
    }
    if (appliedOptions.has(chart) && worthComparing(option)
        && sameOption(appliedOptions.get(chart), option)) return chart;
    chart.setOption(option, { notMerge: true, lazyUpdate: false });
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
