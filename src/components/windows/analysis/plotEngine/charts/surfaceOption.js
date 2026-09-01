/**
 * A computed grid as a chart option, for either way of drawing it.
 *
 * Pure: no React, no chart instance. `render: 'heatmap'` gives a flat cartesian
 * map, anything else the 3D mesh. The flat map is drawn either as one image the
 * caller has already rasterised or as a rectangle per cell, which is the
 * fallback where there is no canvas to rasterise onto.
 */

import { parseAxisVar, surfaceAxisLabel } from '../../../../../utils/physics/plotQuantities.js';
import {
    cartesianOption, chartToolbox, formatChartNumber, formatChartReadout, itemTooltip,
    niceAxisBounds,
} from '../../../../ui/chartOptions.js';
import { plotMargin } from '../../chrome/plot.js';
import { colorScale } from './colorScales.js';

const SURFACE_INTERACTION = Object.freeze({
    rotateSensitivity: 2.5,
    zoomSensitivity: 2,
    panSensitivity: 1.5,
});

export function surfacePlotAxisLabel(token, design) {
    const parsed = parseAxisVar(token);
    if (parsed.kind === 'thk') return `L${parsed.layer + 1} d (nm)`;
    if (parsed.kind === 'n' || parsed.kind === 'k') return `L${parsed.layer + 1} ${parsed.kind}`;
    return surfaceAxisLabel(token, design);
}

function surfaceData(result, scale = 1, categorical = false) {
    const data = [];
    for (let yIndex = 0; yIndex < result.y.length; yIndex++) {
        for (let xIndex = 0; xIndex < result.x.length; xIndex++) {
            data.push([
                categorical ? xIndex : result.x[xIndex],
                categorical ? yIndex : result.y[yIndex],
                result.z[yIndex][xIndex] * scale,
            ]);
        }
    }
    return data;
}

// T, R and A are fractions of the incident flux and are shown as percentages.
export function isPercentQuantity(spec) { return ['T', 'R', 'A'].includes(spec.z); }
export function heatmapScale(spec) { return isPercentQuantity(spec) ? 100 : 1; }

/** Widen `bounds` to cover one row's evaluated cells. */
function widenToRow(bounds, row, scale) {
    for (const cell of row) {
        const value = cell * scale;
        if (!Number.isFinite(value)) continue;
        if (value < bounds.min) bounds.min = value;
        if (value > bounds.max) bounds.max = value;
    }
}

/**
 * The range of values in the grid.
 *
 * Cells the sweep could not evaluate are skipped. A grid point that cannot be
 * computed comes back as NaN, and taking one of those into the extent carries
 * both ends to NaN, which maps every cell to the bottom of the scale: a map
 * with one hole in it would then misreport every value it does have.
 *
 * Reads the grid itself rather than the [x, y, z] triples a cell series is
 * built from. At the 700 x 700 the Plot Engine permits, building half a million
 * triples to find two numbers is the most expensive part of a redraw.
 */
function valueExtent(result, scale = 1) {
    const bounds = { min: Infinity, max: -Infinity };
    for (const row of result.z) {
        if (row) widenToRow(bounds, row, scale);
    }
    // A grid with nothing in it still needs a range for the bar to draw on.
    if (!Number.isFinite(bounds.min)) return { min: 0, max: 1 };
    const { min, max } = bounds;
    return { min, max: max > min ? max : min + 1e-12 };
}

// Exactly the range the colour bar spans, so the image and the bar cannot
// disagree about which colour a value is.
export function heatmapExtent(result, spec) {
    return valueExtent(result, heatmapScale(spec));
}

function axis3D(name, c, bounds) {
    return {
        type: 'value', name,
        ...(bounds || {}),
        nameTextStyle: { color: c.text, fontSize: 11 },
        axisLabel: { color: c.text, fontSize: 9, formatter: formatChartNumber },
        axisLine: { lineStyle: { color: c.border } },
        splitLine: { lineStyle: { color: c.border } },
        axisPointer: { lineStyle: { color: c.text } },
    };
}

/**
 * The interval an axis was actually swept over.
 *
 * A 3D value axis is left to work its own range out, and ECharts forces that
 * range to include zero. A 400 to 800 nm sweep was drawn from 0, with every
 * sample crammed into the right-hand half of the box, so the bounds are given
 * to it instead. There is no data outside the sweep, so they are its ends.
 */
function sweptBounds(values) {
    const first = values[0];
    const last = values[values.length - 1];
    const min = Math.min(first, last);
    const max = Math.max(first, last);
    // Both ends entered the same leaves an axis with no width to draw on.
    return max > min ? { min, max } : niceAxisBounds(min, max);
}

function heatmapAxis(data, name, c) {
    const stride = Math.max(1, Math.ceil((data.length - 1) / 6));
    const showLabel = index => index === 0 || index === data.length - 1 || index % stride === 0;
    return {
        type: 'category', data, name, boundaryGap: true,
        nameLocation: 'middle', nameGap: 28,
        nameTextStyle: { color: c.text, fontSize: 11 },
        axisLine: { show: true, lineStyle: { color: c.text } },
        axisTick: { show: true, interval: showLabel },
        axisLabel: {
            color: c.text, fontSize: 10, hideOverlap: true,
            interval: showLabel, formatter: formatChartNumber,
        },
        splitLine: { show: false },
    };
}

// Where the point is, then what it reads, as one `name: value` line each. The
// quantity names its own value rather than heading the readout, so the number
// is never left as a bare figure at the bottom with its name three lines above
// it. Taken as `[name, value]` pairs, because the flat map builds the same
// three lines for the readout it draws itself.
export function readoutLines(pairs) {
    return pairs.map(([name, value]) => `${name}: ${formatChartReadout(value)}`);
}

function surfaceTooltip(result, xName, yName, zLabel, c) {
    return {
        ...itemTooltip(c),
        formatter: ({ value }) => readoutLines([
            [xName, result.x[value[0]]],
            [yName, result.y[value[1]]],
            [zLabel, value[2]],
        ]).join('<br/>'),
    };
}

function surface3DTooltip(xName, yName, zLabel, c) {
    return {
        ...itemTooltip(c),
        formatter: ({ value }) => readoutLines([
            [xName, value[0]],
            [yName, value[1]],
            [zLabel, value[2]],
        ]).join('<br/>'),
    };
}

// ECharts gives a continuous visual map a fixed 140 px bar whatever the chart
// is, which reads as a stub in a full-height window. `barHeight` is what the
// chart measured for its own box; the fallback is the height a half-pane plot
// works out to, so a caller that cannot measure still gets a usable bar.
export const DEFAULT_BAR_HEIGHT = 160;

/**
 * The bar's end labels, at the precision the bar itself can resolve.
 *
 * A number is worth only as many places as the range it sits in. A
 * transmittance floor of 5.24e-24 on a bar running to 99.5 is zero, and
 * spelling it out in full runs the label off the bar and over the plot, since
 * the labels are drawn in the margin beside it. Ends are therefore rounded to
 * the span rather than formatted on their own.
 */
function barTickFormat(extent) {
    const span = Math.abs(extent.max - extent.min);
    if (!(span > 0)) return formatChartNumber;
    // Two places past the span's leading digit: enough to tell the ends and the
    // middle of the bar apart, and no more digits than it has room for.
    const decimals = Math.max(0, Math.min(100, 2 - Math.floor(Math.log10(span))));
    return (value) => {
        const number = Number(value);
        if (!Number.isFinite(number)) return String(value ?? '');
        const rounded = Number(number.toFixed(decimals));
        return rounded === 0 ? '0' : formatChartNumber(rounded);
    };
}

function colorBar({ label, colors, extent, barHeight, c, legendOnly = false, range = null }) {
    return {
        type: 'continuous', min: extent.min, max: extent.max, dimension: 2,
        right: 10, top: 'middle', itemWidth: 16, itemHeight: barHeight,
        formatter: barTickFormat(extent),
        text: [label, ''], textStyle: { color: c.text, fontSize: 10 },
        inRange: { color: colors }, calculable: true,
        // An image already carries the colours, so the bar maps no series. Its
        // handles still narrow the band, which the window applies by clearing
        // the cells outside it when it rasterises. The band travels in the
        // option so a redraw leaves the handles where the user put them.
        ...(legendOnly ? { seriesIndex: [], ...(range ? { range } : {}) } : {}),
    };
}

/**
 * The whole grid as one image. `renderItem` runs again on a resize and blits
 * the same image at the new size, which is the entire cost.
 *
 * The corners are taken through the axes rather than from the plot rect, so a
 * zoomed axis moves and scales the image with its own labels. Drawn to the
 * outer edges of the first and last band, because a category axis puts index 0
 * at the centre of its band and the image starts half a band earlier.
 */
function heatmapImageSeries(zLabel, image, columns, rows) {
    return {
        name: zLabel, type: 'custom', coordinateSystem: 'cartesian2d',
        data: [0], animation: false, silent: true,
        // The canvas reaches the chart only through the closure below, and the
        // option comparison in plotSurface.js reads every function as equal, so
        // a freshly rasterised grid would look like no change at all and the
        // chart would go on drawing the previous one. Its id is what that
        // comparison sees instead. ECharts ignores the field.
        imageId: image?.imageId ?? null,
        renderItem: (params, api) => {
            // A category axis puts whole indices at band centres and rounds
            // anything between, so the band size is measured from two adjacent
            // centres rather than asked for at a half index. The image's outer
            // edge is then half a band beyond the first centre. The y axis runs
            // bottom up and the image top down, so its origin is the far end.
            const first = api.coord([0, 0]);
            const next = api.coord([1, 1]);
            const bandX = next[0] - first[0];
            const bandY = first[1] - next[1];
            const width = columns * bandX;
            const height = rows * bandY;
            return {
                type: 'image',
                style: {
                    image,
                    x: first[0] - bandX / 2,
                    y: first[1] + bandY / 2 - height,
                    width, height,
                },
                // Zoomed in, most of the image falls outside the plot.
                clipPath: { type: 'rect', shape: params.coordSys },
            };
        },
    };
}

// One rectangle per cell, each of them hit-testable. Kept for a caller with no
// canvas to rasterise onto, such as a server render.
function heatmapCellSeries(zLabel, heatmap, c) {
    return {
        name: zLabel, type: 'heatmap', data: heatmap, progressive: 5000,
        emphasis: { itemStyle: { borderColor: c.text, borderWidth: 1 } }, animation: false,
    };
}

/**
 * The chart option for a computed grid.
 *
 * `view` is how the grid is being shown rather than what is in it:
 * `barHeight` the colour bar's measured height, `image` the grid already
 * rasterised, and `range` the band selected on the bar.
 */
export function buildSurfaceOption(result, spec, design, c, view = {}) {
    const { barHeight = DEFAULT_BAR_HEIGHT, image = null, range = null } = view;
    if (!result?.ok) return null;
    const xName = surfacePlotAxisLabel(spec.xVar, design);
    const yName = surfacePlotAxisLabel(spec.yVar, design);
    const colors = colorScale(spec.colorscale);
    const percent = isPercentQuantity(spec);
    const scale = heatmapScale(spec);
    const zLabel = `${result.zLabel}${percent ? ' (%)' : ''}`;
    // The tooltip and the series name carry the quantity's full name. The
    // captions on the chart itself take the symbol instead: a colour bar sits in
    // a margin about as wide as it is, and "Transmittance (%)" centred over it
    // runs off the edge of a narrow split-pane window.
    const barLabel = percent ? `${spec.z} (%)` : spec.z;
    const zAxisLabel = percent ? '%' : result.zLabel;
    const extent = valueExtent(result, scale);
    const zBounds = niceAxisBounds(extent.min, extent.max, {
        targetTicks: 6, minInterval: percent ? 1 : 0,
    });
    if (spec.render === 'heatmap') {
        return cartesianOption({
            colors: c,
            grid: { ...plotMargin(), right: 84 },
            fileName: 'surface',
            // An image has one element, so there is nothing per cell to hover,
            // and the window reads the grid out under the pointer itself. Said
            // rather than left out: the shared option falls back to an axis
            // tooltip for a missing key, which would put a second crosshair and
            // readout on top of the window's own.
            tooltip: image
                ? { show: false }
                : surfaceTooltip(result, xName, yName, zLabel, c),
            xAxis: heatmapAxis(result.x, xName, c),
            yAxis: heatmapAxis(result.y, yName, c),
            visualMap: colorBar({
                label: barLabel, colors, extent, barHeight, c,
                legendOnly: !!image, range,
            }),
            series: [image
                ? heatmapImageSeries(zLabel, image, result.x.length, result.y.length)
                : heatmapCellSeries(zLabel, surfaceData(result, scale, true), c)],
        });
    }
    return {
        backgroundColor: c.panel || '#252526',
        textStyle: { color: c.text, fontFamily: 'system-ui, -apple-system, sans-serif' },
        tooltip: surface3DTooltip(xName, yName, zLabel, c),
        toolbox: chartToolbox('surface', { dataZoom: false, colors: c }),
        visualMap: colorBar({ label: barLabel, colors, extent, barHeight, c }),
        grid3D: {
            show: true,
            left: 8, right: 66, top: 28, bottom: 18,
            boxWidth: 110, boxDepth: 110, boxHeight: 76,
            environment: c.bg || '#1e1e1e',
            axisPointer: { show: true },
            viewControl: {
                projection: 'perspective', alpha: 24, beta: -42, distance: 220,
                ...SURFACE_INTERACTION,
            },
            light: { main: { intensity: 1.15, shadow: false }, ambient: { intensity: 0.55 } },
        },
        xAxis3D: axis3D(xName, c, sweptBounds(result.x)),
        yAxis3D: axis3D(yName, c, sweptBounds(result.y)),
        zAxis3D: axis3D(zAxisLabel, c, zBounds),
        series: [{
            // The mesh is the one series that wants the grid as points; the
            // flat map draws an image or its own cells and never reads this.
            type: 'surface', name: zLabel, data: surfaceData(result, scale),
            shading: 'lambert', wireframe: { show: false },
            itemStyle: { opacity: 1 }, silent: false,
        }],
        animation: false,
    };
}
