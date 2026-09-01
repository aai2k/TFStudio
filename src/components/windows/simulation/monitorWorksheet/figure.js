/**
 * The run as the monitor sees it: signal against cumulative optical thickness,
 * every cut marked and numbered, and every layer continued past its cut so the
 * turning point that sets its amplitude is on the picture.
 */

import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import {
    axisTooltip, cartesianOption, formatChartReadout, lineSeries, valueAxis,
} from '../../../ui/chartOptions.js';
import { chartTools, plotMargin } from '../../analysis/chrome/plot.js';

// A run of a hundred layers drawn end to end is a picket fence. The chart opens
// on the first few layers and scrolls along the run instead, which is also how
// a strip chart is read at the machine.
export const ZOOM_ID = 'monitorWorksheetX';
// Room under the plot for the scrollbar, on top of the axis title.
const SCROLLBAR = { height: 24, bottom: 6, gridBottom: 88 };

// The traversed part of a layer's curve and the continuation past its cut,
// joined at the exact cut so the two meet.
function splitAtCut(row) {
    const deposited = [];
    const rest = [];
    for (let k = 0; k < row.curve.x.length; k++) {
        const point = [row.curve.x[k], row.curve.y[k] * 100];
        (point[0] <= row.xCut ? deposited : rest).push(point);
    }
    const cutPoint = [row.xCut, row.signal * 100];
    deposited.push(cutPoint);
    rest.unshift(cutPoint);
    return { deposited, rest };
}

// The whole run as one polyline. The scrollbar draws its overview from the
// first series on the axis, and what belongs there is the shape of the entire
// run, not the one layer that happens to be drawn first. It is invisible in the
// plot itself, where the per-layer segments carry the colour.
function runOverview(rows) {
    const data = [];
    for (const row of rows) {
        if (!row.curve) continue;
        for (let k = 0; k < row.curve.x.length; k++) {
            if (row.curve.x[k] > row.xCut) break;
            data.push([row.curve.x[k], row.curve.y[k] * 100]);
        }
        data.push([row.xCut, row.signal * 100]);
    }
    const overview = lineSeries({ data, color: 'transparent', width: 0, z: 0, silent: true });
    // Painted in one pass (a long run puts this over the progressive
    // threshold, and a hover restarts a progressive render) and off the base
    // layer, which the axis pointer dirties on every mouse move.
    overview.progressive = 0;
    overview.zlevel = 1;
    return overview;
}

// One series per style rather than two per layer. Segments sharing a style are
// joined into a single series with a [NaN, NaN] break between layers, which
// draws identically: ECharts costs are per series far more than per point, and
// two series per layer made a 200-layer run rebuild 400 series models on every
// option apply.
function layerSeries(rows, colors) {
    const signal = [];
    const poor = [];
    const continuation = [];
    const gap = [NaN, NaN];
    for (const row of rows) {
        if (!row.curve) continue;
        const { deposited, rest } = splitAtCut(row);
        const target = row.poor ? poor : signal;
        if (target.length) target.push(gap);
        for (const point of deposited) target.push(point);
        if (continuation.length) continuation.push(gap);
        for (const point of rest) continuation.push(point);
    }
    // Out of the axis pointer's collection (the readout is built from the rows,
    // not from these), painted in one pass (past the progressive threshold a
    // hover restarts a progressive render), and on their own canvas layer: the
    // axis pointer rebuilds its elements through the base layer on every mouse
    // move, and a long run's curves re-rasterized per move is the whole frame
    // budget. The overview stays collected so the axis tooltip still fires.
    const merged = (options) => {
        const one = lineSeries({ ...options, silent: true, tooltip: { show: false } });
        one.progressive = 0;
        one.zlevel = 1;
        return one;
    };
    const series = [];
    if (continuation.length) {
        series.push(merged({ data: continuation, color: colors.continuation, width: 1, dash: 'dash', z: 1 }));
    }
    if (signal.length) {
        series.push(merged({ data: signal, color: colors.signal, width: 2, z: 3 }));
    }
    if (poor.length) {
        series.push(merged({ data: poor, color: colors.poor, width: 2, z: 3 }));
    }
    return series;
}

function cutMarkers(rows, colors, text) {
    return {
        type: 'scatter',
        data: rows.map(row => ({ value: [row.xCut, row.signal * 100], name: String(row.step) })),
        symbolSize: 5,
        itemStyle: { color: colors.cut },
        label: {
            show: true, position: 'top', color: text, fontSize: 9,
            formatter: params => params.name,
        },
        labelLayout: { hideOverlap: true },
        z: 4,
        // With the curves: off the base layer the axis pointer dirties, so a
        // mouse move does not re-rasterize two hundred marks and labels.
        zlevel: 1,
        silent: true,
        animation: false,
    };
}

// One shaded band per stretch of the run spent on one chip. Keyed on the
// stretch rather than on the chip number, because a chip can be returned to
// later in the run and a band drawn from its first layer to its last would then
// cover everything in between.
function chipVisits(rows) {
    const visits = [];
    let current = null;
    for (const row of rows) {
        if (!current || current.chip !== row.chip) {
            current = { chip: row.chip, from: row.xStart, to: row.xCut };
            visits.push(current);
        } else {
            current.to = row.xCut;
        }
    }
    return visits;
}

function chipBands(rows, colors, text, chipLabel) {
    const areas = chipVisits(rows).map((visit, index) => [
        {
            xAxis: visit.from,
            name: chipLabel(visit.chip),
            itemStyle: { color: index % 2 ? `${colors.cut}22` : 'transparent' },
            label: { show: true, position: 'insideTop', color: text, fontSize: 9 },
        },
        { xAxis: visit.to },
    ]);
    return {
        type: 'line', data: [], silent: true, animation: false, z: 0,
        markArea: { silent: true, data: areas },
    };
}

// The layer's signal at run position `x`, read off its sampled curve.
function signalAtX(row, x) {
    const xs = row.curve.x;
    const ys = row.curve.y;
    let k = 1;
    while (k < xs.length - 1 && xs[k] < x) k++;
    const span = xs[k] - xs[k - 1];
    const w = span > 0 ? Math.min(1, Math.max(0, (x - xs[k - 1]) / span)) : 0;
    return (ys[k - 1] + (ys[k] - ys[k - 1]) * w) * 100;
}

function tooltipRow(label, color, value) {
    const marker = `<span style="display:inline-block;margin-right:5px;border-radius:5px;`
        + `width:9px;height:9px;background-color:${color};"></span>`;
    return '<div style="display:flex;gap:14px;align-items:baseline">'
        + `<span style="flex:1">${marker}${label}</span>`
        + `<span style="font-weight:600">${formatChartReadout(value)} %</span>`
        + '</div>';
}

/**
 * The native axis tooltip lists the series that own the sample the pointer
 * snapped to, and with every layer sampled on its own grid that is not reliably
 * the layer under the pointer. The readout is built from the rows instead: the
 * layer the pointer is over always reports its deposited signal, and every
 * curve continued past its cut is read where it crosses the pointer, after it.
 */
function worksheetTooltip(rows, colors, mw) {
    return params => {
        const x = (Array.isArray(params) ? params[0] : params)?.axisValue;
        if (!Number.isFinite(x)) return '';
        const own = [];
        const past = [];
        for (const row of rows) {
            if (!row.curve) continue;
            if (x >= row.xStart && x <= row.xCut) {
                own.push(tooltipRow(mw.tipLayer(row.step),
                    row.poor ? colors.poor : colors.signal, signalAtX(row, x)));
            } else if (x > row.xCut && x <= row.xEnd) {
                past.push(tooltipRow(mw.tipPastCut(row.step), colors.continuation, signalAtX(row, x)));
            }
        }
        if (!own.length && !past.length) return '';
        return [`<div style="margin-bottom:3px">${formatChartReadout(x)}</div>`, ...own, ...past].join('');
    };
}

// The opening window: the first `layersInView` layers, out to the end of the
// last one's continuation so its turning point is inside the view.
function viewport(rows, layersInView) {
    const wanted = Math.max(1, Math.round(layersInView) || 1);
    const last = rows[Math.min(rows.length, wanted) - 1];
    return { startValue: 0, endValue: last.xEnd };
}

function scrollbars({ rows, layersInView, colors, c, text, gridColor }) {
    const view = viewport(rows, layersInView);
    return [
        {
            id: ZOOM_ID, type: 'slider', xAxisIndex: 0, filterMode: 'none',
            ...view, height: SCROLLBAR.height, bottom: SCROLLBAR.bottom,
            showDataShadow: true, showDetail: false,
            borderColor: gridColor, backgroundColor: 'transparent',
            fillerColor: `${colors.cut}33`,
            handleStyle: { color: c.panel, borderColor: text },
            moveHandleStyle: { color: gridColor },
            textStyle: { color: text, fontSize: 9 },
            dataBackground: {
                lineStyle: { color: gridColor, width: 1 },
                areaStyle: { color: `${gridColor}55` },
            },
            selectedDataBackground: {
                lineStyle: { color: colors.signal, width: 1 },
                areaStyle: { color: `${colors.signal}33` },
            },
        },
        {
            type: 'inside', xAxisIndex: 0, filterMode: 'none',
            ...view, zoomOnMouseWheel: true, moveOnMouseMove: false, moveOnMouseWheel: false,
        },
    ];
}

export function buildWorksheetOption({
    rows, c, t, layersInView = 8, colors = ANALYSIS_DEFAULTS.monitorWorksheet.colors,
}) {
    if (!rows?.length) return { series: [] };
    const mw = t.monitorWorksheet;
    const text = c.text || '#cccccc';
    const gridColor = c.border || '#3a3a3a';
    const dataZoom = scrollbars({ rows, layersInView, colors, c, text, gridColor });
    return cartesianOption({
        colors: c,
        grid: { ...plotMargin(), bottom: SCROLLBAR.gridBottom },
        toolbox: chartTools('monitor_worksheet', {
            colors: c,
            // Reset goes back to the opening window over the run, not to the
            // whole run, which is the view the chart is unreadable at.
            resetView: { dataZoom: [{ id: ZOOM_ID, ...viewport(rows, layersInView) }] },
        }),
        tooltip: {
            ...axisTooltip({ colors: c, cross: true, valueSuffix: ' %' }),
            formatter: worksheetTooltip(rows, colors, mw),
        },
        xAxis: valueAxis({
            name: mw.axisThickness, color: text, gridColor, nameGap: 32, min: 0,
        }),
        yAxis: valueAxis({ name: mw.axisSignal, color: text, gridColor, min: 0, max: 100 }),
        dataZoom,
        series: [
            runOverview(rows),
            chipBands(rows, colors, text, chip => mw.chipLabel(chip)),
            ...layerSeries(rows, colors),
            cutMarkers(rows, colors, text),
        ],
    });
}
