import { parseAxisVar, xAxisLabel, surfaceAxisLabel } from '../../../../utils/physics/plotQuantities.js';
import { disposeChart, drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import {
    axisTooltip, cartesianOption, chartToolbox, formatChartNumber, formatChartReadout, itemTooltip,
    lineSeries, niceAxisBounds, valueAxis,
} from '../../../ui/chartOptions.js';
import { legendAbove, plotMargin } from '../chrome/plot.js';

const { createElement: h, useMemo, useEffect, useRef } = React;

const COLOR_SCALES = {
    viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
    cividis: ['#00204c', '#424086', '#7c7b78', '#bcae5c', '#ffea46'],
    plasma: ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921'],
    inferno: ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'],
    jet: ['#00007f', '#0000ff', '#00ffff', '#ffff00', '#ff0000', '#7f0000'],
    hot: ['#000000', '#b00000', '#ff7a00', '#ffff00', '#ffffff'],
    portland: ['#0c3383', '#0a88ba', '#f2d338', '#f28f38', '#d63230'],
    electric: ['#000000', '#1f00ff', '#ff00e6', '#ff1f00', '#ffff00'],
    greys: ['#111111', '#555555', '#aaaaaa', '#f5f5f5'],
};

const SURFACE_INTERACTION = Object.freeze({
    rotateSensitivity: 2.5,
    zoomSensitivity: 2,
    panSensitivity: 1.5,
});

function colorScale(name) { return COLOR_SCALES[String(name || 'viridis').toLowerCase()] || COLOR_SCALES.viridis; }

function surfacePlotAxisLabel(token, design) {
    const parsed = parseAxisVar(token);
    if (parsed.kind === 'thk') return `L${parsed.layer + 1} d (nm)`;
    if (parsed.kind === 'n' || parsed.kind === 'k') return `L${parsed.layer + 1} ${parsed.kind}`;
    return surfaceAxisLabel(token, design);
}

export function buildCurveSeries(curves, results) {
    return curves
        .filter(curve => curve.visible && results[curve.id])
        .map(curve => lineSeries({
            x: results[curve.id].x,
            y: results[curve.id].y.map(value => value * 100),
            name: curve.label || curve.id,
            color: curve.color,
            width: curve.width || 2,
            dash: curve.dash,
        }));
}

function dominantXAxis(curves) {
    return curves.find(curve => curve.visible)?.xAxis || 'wavelength';
}

function buildCurveOption(curves, results, c) {
    const text = c.text || '#cccccc';
    const grid = c.border || '#3a3a3a';
    return cartesianOption({
        colors: c,
        grid: plotMargin(),
        fileName: 'curves',
        legend: legendAbove({ color: text }),
        tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
        xAxis: valueAxis({ name: xAxisLabel(dominantXAxis(curves)), color: text, gridColor: grid }),
        yAxis: valueAxis({ name: '%', color: text, gridColor: grid, min: 0, max: 100, interval: 10 }),
        series: buildCurveSeries(curves, results),
    });
}

export function MultiCurveChart({ curves, results, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    useEffect(() => { drawChart(divRef.current, chartRef, buildCurveOption(curves, results, c)); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
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

function valueExtent(data) {
    let min = Infinity, max = -Infinity;
    for (const item of data) { min = Math.min(min, item[2]); max = Math.max(max, item[2]); }
    return { min, max: max > min ? max : min + 1e-12 };
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

function surfaceTooltip(result, xName, yName, zLabel, c) {
    return {
        ...itemTooltip(c),
        formatter: ({ value }) => `${zLabel}<br/>${xName}: ${formatChartReadout(result.x[value[0]])}`
            + `<br/>${yName}: ${formatChartReadout(result.y[value[1]])}`
            + `<br/>${formatChartReadout(value[2])}`,
    };
}

function surface3DTooltip(xName, yName, zLabel, c) {
    return {
        ...itemTooltip(c),
        formatter: ({ value }) => `${zLabel}<br/>${xName}: ${formatChartReadout(value[0])}`
            + `<br/>${yName}: ${formatChartReadout(value[1])}`
            + `<br/>${formatChartReadout(value[2])}`,
    };
}

export function buildSurfaceOption(result, spec, design, c) {
    if (!result?.ok) return null;
    const xName = surfacePlotAxisLabel(spec.xVar, design);
    const yName = surfacePlotAxisLabel(spec.yVar, design);
    const colors = colorScale(spec.colorscale);
    const percent = ['T', 'R', 'A'].includes(spec.z);
    const scale = percent ? 100 : 1;
    const zLabel = `${result.zLabel}${percent ? ' (%)' : ''}`;
    // The visual map already carries the full quantity name. Keep the 3D axis
    // caption compact so it remains readable in a narrow split-pane window.
    const zAxisLabel = percent ? '%' : result.zLabel;
    const data = surfaceData(result, scale);
    const extent = valueExtent(data);
    const zBounds = niceAxisBounds(extent.min, extent.max, {
        targetTicks: 6, minInterval: percent ? 1 : 0,
    });
    if (spec.render === 'heatmap') {
        const heatmap = surfaceData(result, scale, true);
        return cartesianOption({
            colors: c,
            grid: { ...plotMargin(), right: 72 },
            fileName: 'surface',
            tooltip: surfaceTooltip(result, xName, yName, zLabel, c),
            xAxis: heatmapAxis(result.x, xName, c),
            yAxis: heatmapAxis(result.y, yName, c),
            visualMap: {
                type: 'continuous', min: extent.min, max: extent.max,
                dimension: 2, right: 6, top: 44, bottom: 44, itemWidth: 14,
                formatter: formatChartNumber,
                text: [zLabel, ''], textStyle: { color: c.text, fontSize: 9 },
                inRange: { color: colors }, calculable: true,
            },
            series: [{
                name: zLabel, type: 'heatmap', data: heatmap, progressive: 5000,
                emphasis: { itemStyle: { borderColor: c.text, borderWidth: 1 } }, animation: false,
            }],
        });
    }
    return {
        backgroundColor: c.panel || '#252526',
        textStyle: { color: c.text, fontFamily: 'system-ui, -apple-system, sans-serif' },
        tooltip: surface3DTooltip(xName, yName, zLabel, c),
        toolbox: chartToolbox('surface', { dataZoom: false, colors: c }),
        visualMap: {
            show: true, min: extent.min, max: extent.max, dimension: 2,
            right: 6, top: 42, bottom: 42, itemWidth: 14,
            formatter: formatChartNumber,
            text: [zLabel, ''], textStyle: { color: c.text, fontSize: 9 },
            inRange: { color: colors }, calculable: true,
        },
        grid3D: {
            show: true,
            left: 8, right: 54, top: 28, bottom: 18,
            boxWidth: 110, boxDepth: 110, boxHeight: 76,
            environment: c.bg || '#1e1e1e',
            axisPointer: { show: true },
            viewControl: {
                projection: 'perspective', alpha: 24, beta: -42, distance: 220,
                ...SURFACE_INTERACTION,
            },
            light: { main: { intensity: 1.15, shadow: false }, ambient: { intensity: 0.55 } },
        },
        xAxis3D: axis3D(xName, c),
        yAxis3D: axis3D(yName, c),
        zAxis3D: axis3D(zAxisLabel, c, zBounds),
        series: [{
            type: 'surface', name: zLabel, data,
            shading: 'lambert', wireframe: { show: false },
            itemStyle: { opacity: 1 }, silent: false,
        }],
        animation: false,
    };
}

function surfacePrompt(message, c) {
    return h('div', { style: {
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: c.textDim, fontSize: 13, fontStyle: 'italic', textAlign: 'center', padding: 20,
    } }, message);
}

function surfaceError(message, c) {
    return h('div', { style: {
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: c.danger || '#ef5350', fontSize: 13, textAlign: 'center', padding: 20,
    } }, message);
}

export function SurfaceChart({ result, spec, design, c, t }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const labels = t?.plotEngine || {};
    const option = useMemo(() => buildSurfaceOption(result, spec, design, c), [result, spec, design, c]);
    useEffect(() => {
        if (option) drawChart(divRef.current, chartRef, option);
        else disposeChart(divRef.current, chartRef);
    }, [option]);
    useChartTeardown(divRef, chartRef);
    let overlay = null;
    if (!result) overlay = surfacePrompt(labels.surfacePrompt || 'Configure the axes and quantity, then press Compute.', c);
    else if (!result.ok) overlay = surfaceError(result.error || 'Cannot compute surface.', c);
    return h('div', { style: { width: '100%', height: '100%', position: 'relative', overflow: 'hidden' } },
        h('div', { ref: divRef, style: { width: '100%', height: '100%', visibility: overlay ? 'hidden' : 'visible' } }),
        overlay && h('div', { style: { position: 'absolute', inset: 0 } }, overlay));
}
