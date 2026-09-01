import {
    axisTooltip, cartesianOption, horizontalLegend, lineSeries, valueAxis, xyData,
} from '../../../ui/chartOptions.js';

function stepColor(index, count, alpha = 0.55) {
    const hue = count <= 1 ? 200 : 220 - (index / (count - 1)) * 220;
    return `hsla(${hue}, 70%, 55%, ${alpha})`;
}

// Layers that are not in focus stay drawn rather than being hidden: a
// monitoring curve is read against the ones before it, so a turning point means
// nothing on its own.
function dimColor(text) {
    const hex = /^#[0-9a-f]{6}$/i.test(text || '') ? text : '#cccccc';
    return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},0.16)`;
}

export function spectraColors(c) {
    return {
        background: c.bg || '#1e1e1e', paper: c.panel || '#252526',
        grid: c.border || '#3a3a3a', text: c.text || '#cccccc', accent: c.accent || '#3aafff',
    };
}

/**
 * Plot points for the finished-spectrum curves, as percentages.
 *
 * Held apart from the series so the caller can build them once per design and
 * reuse them across the frames of a run. A sixty-layer stack over a 350-point
 * grid is twenty thousand points, and rebuilding them on every progress tick is
 * what made a long run stutter.
 */
export function buildStepPoints(lambdas, stepCurves) {
    return (stepCurves || []).map(values => xyData(lambdas, values.map(value => value * 100)));
}

/** The step curve the chart is following, or null when there are none. */
export function focusedStep(data) {
    const step = data.focusStep;
    if (!Number.isFinite(step)) return null;
    return step >= 1 && step <= (data.stepPoints?.length || 0) ? step : null;
}

// Grid margins, shared with the haze bitmap so the two can never disagree
// about where the plot area sits.
const GRID = { left: 52, right: 16, top: 34, bottom: 42 };

export function buildSpectraSeries(data, colors, labels) {
    const series = [];
    const focus = focusedStep(data);
    if (data.baselinePoints) {
        const baseline = lineSeries({
            data: data.baselinePoints,
            name: labels.legendBaseline, color: colors.text, width: 1, dash: 'dot',
        });
        baseline.lineStyle.opacity = 0.55;
        series.push(baseline);
    }
    if (focus !== null) {
        series.push(lineSeries({
            data: data.stepPoints[focus - 1],
            name: labels.legendStep(focus),
            color: stepColor(focus - 1, data.stepPoints.length, 0.95),
            width: 2.4,
            z: 3,
        }));
    }
    if (data.liveCurve) {
        series.push(lineSeries({
            x: data.lambdas, y: data.liveCurve.map(value => value * 100),
            name: labels.legendLive, color: colors.accent, width: 2.6,
        }));
    }
    return series;
}

// ── The all-layers haze, as a bitmap ─────────────────────────────────────────
//
// With "show all layers" on, the unfocused step curves are drawn from a
// pre-rasterized offscreen canvas rather than as series. ECharts clears and
// repaints every canvas on any option apply and on every axis pointer move, so
// two hundred curves kept as series are re-stroked per timeline tick, per
// hover frame and per resize step; on a 200-step run that stroke alone is the
// whole frame budget. As a bitmap the same haze costs one drawImage.
//
// The bitmap holds every step, the focused one included: the bright focused
// series draws exactly over its dim copy, so following the run does not
// invalidate it. It is rebuilt when the curves change or when the plot size
// settles after a resize, and stretched in between.

const CONTEXT_IMAGE_ID = 'processContextImage';
const contextImages = new WeakMap();   // chart instance → { stepPoints, key, canvas, lastData, lastColors, zoomTimer }
const zoomWired = new WeakSet();       // charts whose dataZoom events re-sync the bitmap

function gridRect(chart) {
    return {
        x: GRID.left,
        y: GRID.top,
        w: Math.max(1, chart.getWidth() - GRID.left - GRID.right),
        h: Math.max(1, chart.getHeight() - GRID.top - GRID.bottom),
    };
}

// Everything the raster depends on besides the curves themselves: the plot
// size, the axis window (a toolbox zoom remaps the axes without touching the
// data), and the haze color (the theme can change under a live chart).
function contextKey(chart, rect, color) {
    const lo = chart.convertFromPixel({ gridIndex: 0 }, [rect.x, rect.y + rect.h]);
    const hi = chart.convertFromPixel({ gridIndex: 0 }, [rect.x + rect.w, rect.y]);
    const window = lo && hi ? `${lo[0]},${lo[1]},${hi[0]},${hi[1]}` : '';
    return `${rect.w}x${rect.h}|${window}|${color}`;
}

// A zoom leaves the series remapped but the bitmap rasterized under the old
// axes; re-sync it once the zoom has applied. Deferred a tick so
// convertToPixel reads the post-zoom coordinate system.
function wireZoomResync(chart) {
    if (zoomWired.has(chart)) return;
    zoomWired.add(chart);
    chart.on('datazoom', () => {
        const entry = contextImages.get(chart);
        if (!entry) return;
        clearTimeout(entry.zoomTimer);
        entry.zoomTimer = setTimeout(() => {
            if (!chart.isDisposed?.()) syncContextImage(chart, entry.lastData, entry.lastColors);
        }, 0);
    });
}

function paintContext(chart, stepPoints, color, rect) {
    const ratio = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.w * ratio));
    canvas.height = Math.max(1, Math.round(rect.h * ratio));
    const g = canvas.getContext('2d');
    g.scale(ratio, ratio);
    g.strokeStyle = color;
    g.lineWidth = 1.1;
    for (const points of stepPoints) {
        g.beginPath();
        for (let k = 0; k < points.length; k++) {
            const [px, py] = chart.convertToPixel({ gridIndex: 0 }, points[k]);
            if (k === 0) g.moveTo(px - rect.x, py - rect.y);
            else g.lineTo(px - rect.x, py - rect.y);
        }
        g.stroke();
    }
    return canvas;
}

/**
 * Bring the haze bitmap in line with the chart: absent unless Show all layers
 * is on, rebuilt when the curves or the settled plot size changed, reattached
 * otherwise. Runs after every option apply, because a full apply drops the
 * graphic with the rest of the old option.
 */
export function syncContextImage(chart, data, colors) {
    if (!chart || chart.isDisposed?.()) return;
    if (!data.showAll || !data.stepPoints?.length) {
        if (contextImages.has(chart)) {
            contextImages.delete(chart);
            chart.setOption({ graphic: [{ id: CONTEXT_IMAGE_ID, $action: 'remove' }] });
        }
        return;
    }
    wireZoomResync(chart);
    const color = dimColor(colors.text);
    const rect = gridRect(chart);
    const key = contextKey(chart, rect, color);
    const cached = contextImages.get(chart);
    let canvas = cached && cached.stepPoints === data.stepPoints && cached.key === key
        ? cached.canvas
        : null;
    if (!canvas) {
        canvas = paintContext(chart, data.stepPoints, color, rect);
    }
    contextImages.set(chart, {
        stepPoints: data.stepPoints, key, canvas,
        lastData: data, lastColors: colors,
        zoomTimer: cached?.zoomTimer,
    });
    chart.setOption({ graphic: [{
        type: 'image', id: CONTEXT_IMAGE_ID, silent: true, z: 1,
        style: { image: canvas, x: rect.x, y: rect.y, width: rect.w, height: rect.h },
    }] });
}

/**
 * Follow a resize in progress: the existing bitmap is stretched to the new
 * plot rect, which keeps the drag fluid; the caller rebuilds it crisp via
 * syncContextImage once the size settles.
 */
export function stretchContextImage(chart) {
    if (!chart || chart.isDisposed?.() || !contextImages.has(chart)) return;
    const rect = gridRect(chart);
    chart.setOption({ graphic: [{
        id: CONTEXT_IMAGE_ID,
        style: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
    }] });
}

/**
 * The curves the legend names, which are also the ones the readout reports.
 *
 * Step curves scale with the layer count, so neither the legend nor the tooltip
 * can hold them all. Both stay bounded to the baseline, the layer the timeline
 * is on, and the live curve; selecting a layer brings it into both.
 */
function namedCurves(focus, labels) {
    return focus === null
        ? [labels.legendBaseline, labels.legendLive]
        : [labels.legendBaseline, labels.legendStep(focus), labels.legendLive];
}

export function buildSpectraOption(data, colors, labels) {
    const focus = focusedStep(data);
    const named = new Set(namedCurves(focus, labels));
    return cartesianOption({
        colors,
        grid: { ...GRID },
        fileName: 'process',
        legend: {
            ...horizontalLegend({ color: colors.text, top: 3, right: 72 }),
            data: namedCurves(focus, labels),
            itemWidth: 18,
            itemGap: 6,
            formatter: name => name === labels.legendBaseline
                ? name.replace(/\s*\([^)]*\)\s*$/, '')
                : name,
        },
        // The readout lists the curves the legend names. With every layer drawn
        // the rest are context: sixty rows would run off the window, and no
        // reader can tell which grey trace is which anyway. Select a layer to
        // bring it into both.
        tooltip: axisTooltip({
            colors, valueSuffix: '%',
            include: row => named.has(row.seriesName),
        }),
        xAxis: valueAxis({ name: 'Wavelength (nm)', color: colors.text, gridColor: colors.grid, nameGap: 28 }),
        yAxis: valueAxis({ name: '%', color: colors.text, gridColor: colors.grid, min: 0, max: 100, interval: 10 }),
        series: buildSpectraSeries(data, colors, labels),
    });
}
