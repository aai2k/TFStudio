import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { cartesianOption, lineSeries, niceAxisBounds, valueAxis } from '../../../ui/chartOptions.js';
import { legendAbove, plotMargin } from '../chrome/plot.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useRef } = React;

export function buildRISeries(profile, quantity, curve = ANALYSIS_DEFAULTS.refractiveIndexProfiler.colors) {
    if (!profile) return [];
    const series = [];
    if (quantity === 'n' || quantity === 'both') series.push(lineSeries({
        x: profile.z, y: profile.n, name: 'n', color: curve.n, width: 2, step: 'end',
    }));
    if (quantity === 'k' || quantity === 'both') series.push(lineSeries({
        x: profile.z, y: profile.k, name: 'k', color: curve.k, width: 2,
        dash: quantity === 'both' ? 'dash' : 'solid', yAxisIndex: quantity === 'both' ? 1 : 0,
        step: 'end',
    }));
    return series;
}

function layerDecorations(profile, matColorMap, gridColor) {
    const bounds = profile?.layerBounds || [];
    const validLayers = profile?.validLayers || [];
    return {
        areas: validLayers.slice(0, Math.max(0, bounds.length - 1)).map((layer, index) => [
            { xAxis: bounds[index], itemStyle: { color: matColorMap[layer?.materialId] || '#555555', opacity: 0.14 } },
            { xAxis: bounds[index + 1] },
        ]),
        lines: bounds.slice(1, -1).map(value => ({ xAxis: value, lineStyle: { color: gridColor, type: 'dotted' } })),
    };
}

export function buildRIOption(profile, quantity, matColorMap, colors,
                              curve = ANALYSIS_DEFAULTS.refractiveIndexProfiler.colors) {
    const { bgColor, paperColor, gridColor, textColor } = colors;
    const series = buildRISeries(profile, quantity, curve);
    const decorations = layerDecorations(profile, matColorMap, gridColor);
    if (series.length) {
        series[0].markArea = { silent: true, data: decorations.areas };
        series[0].markLine = { silent: true, symbol: 'none', label: { show: false }, data: decorations.lines };
    }
    const both = quantity === 'both';
    const showN = quantity === 'n' || both;
    const zStart = profile?.z?.[0];
    const zEnd = profile?.z?.at(-1) ?? profile?.totalThk;
    const zBounds = niceAxisBounds(zStart, zEnd, { targetTicks: 10 });
    return cartesianOption({
        colors: { background: bgColor, paper: paperColor, grid: gridColor, text: textColor },
        grid: plotMargin({ rightAxis: both }),
        fileName: 'index_profile',
        legend: both ? legendAbove({ color: textColor }) : { show: false },
        xAxis: valueAxis({
            name: 'Depth (nm)', color: textColor, gridColor,
            min: zBounds?.min, max: zBounds?.max, interval: zBounds?.interval,
        }),
        yAxis: [
            valueAxis({ name: showN ? 'n' : 'k', color: textColor, gridColor, min: 0, position: 'left' }),
            ...(both ? [valueAxis({ name: 'k', color: curve.k, gridColor, min: 0, position: 'right', splitLine: false })] : []),
        ],
        series,
    });
}

export function RIChart({ profile, quantity, matColorMap, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const curve = useAnalysisColors('refractiveIndexProfiler');
    const colors = {
        bgColor: c.bg || '#1e1e1e', paperColor: c.panel || '#252526',
        gridColor: c.border || '#3a3a3a', textColor: c.text || '#cccccc',
    };
    useEffect(() => { drawChart(divRef.current, chartRef,
        buildRIOption(profile, quantity, matColorMap, colors, curve)); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
