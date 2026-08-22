import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { legendAbove, plotMargin } from '../chrome/plot.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useRef } = React;

export function placeTotalRegions(regions) {
    const coatingWidths = (regions || []).filter(region => region.key !== 'substrate').map(region => region.totalThk || 1);
    const averageCoating = coatingWidths.length ? coatingWidths.reduce((a, b) => a + b, 0) / coatingWidths.length : 200;
    const substrateWidth = Math.max(80, averageCoating * 0.5);
    const gap = Math.max(20, averageCoating * 0.08);
    let cursor = 0;
    const placed = (regions || []).map(region => {
        const span = region.totalThk || 1;
        const width = region.key === 'substrate' ? substrateWidth : span;
        const start = cursor;
        const plotX = (region.z || []).map(value => start + (value / span) * width);
        cursor = start + width + gap;
        return { ...region, start, end: start + width, width, span, plotX };
    });
    return { placed, totalWidth: placed.length ? placed.at(-1).end : 1 };
}

const mapX = (region, value) => region.start + (value / region.span) * region.width;

export function buildRITotalSeries(placed, quantity, curve = ANALYSIS_DEFAULTS.refractiveIndexProfiler.colors) {
    const both = quantity === 'both';
    const series = [];
    placed.forEach(region => {
        const dataFor = values => region.plotX.map((x, index) => ({
            value: [x, values[index]], depth: region.z[index], unit: region.unit, region: region.label,
        }));
        if (quantity === 'n' || both) series.push(lineSeries({
            data: dataFor(region.n), name: 'n', color: curve.n, width: 2, step: 'end',
        }));
        if (quantity === 'k' || both) series.push(lineSeries({
            data: dataFor(region.k), name: 'k', color: curve.k, width: 2,
            dash: both ? 'dash' : 'solid', yAxisIndex: both ? 1 : 0, step: 'end',
        }));
    });
    return series;
}

function regionDecorations(placed, matColorMap, colors) {
    const areas = [];
    const lines = [];
    placed.forEach(region => {
        if (region.key === 'substrate') areas.push([
            { xAxis: region.start, itemStyle: { color: colors.gridColor, opacity: 0.1 } },
            { xAxis: region.end },
        ]);
        const bounds = region.layerBounds || [];
        const layers = region.validLayers || [];
        for (let index = 0; index < layers.length && index + 1 < bounds.length; index++) areas.push([
            { xAxis: mapX(region, bounds[index]), itemStyle: { color: matColorMap[layers[index]?.materialId] || '#555555', opacity: 0.14 } },
            { xAxis: mapX(region, bounds[index + 1]) },
        ]);
        lines.push(...bounds.slice(1, -1).map(value => ({
            xAxis: mapX(region, value), lineStyle: { color: colors.gridColor, type: 'dotted' },
        })));
    });
    for (let index = 0; index < placed.length - 1; index++) lines.push({
        xAxis: (placed[index].end + placed[index + 1].start) / 2,
        lineStyle: { color: colors.textColor, type: 'dashed' },
    });
    return { areas, lines };
}

export function buildRITotalOption(regions, quantity, matColorMap, colors,
                                   curve = ANALYSIS_DEFAULTS.refractiveIndexProfiler.colors) {
    const { placed, totalWidth } = placeTotalRegions(regions);
    if (!placed.length) return { series: [] };
    const both = quantity === 'both';
    const showN = quantity === 'n' || both;
    const series = buildRITotalSeries(placed, quantity, curve);
    const decorations = regionDecorations(placed, matColorMap, colors);
    const visibleValues = placed.flatMap(region => showN ? region.n : region.k).filter(Number.isFinite);
    const labelY = Math.max(...visibleValues, 1);
    if (series.length) {
        series[0].markArea = { silent: true, data: decorations.areas };
        series[0].markLine = { silent: true, symbol: 'none', label: { show: false }, data: decorations.lines };
        series[0].markPoint = {
            silent: true, symbolSize: 1,
            data: placed.map(region => ({
                coord: [(region.start + region.end) / 2, labelY],
                label: {
                    show: true, position: 'top', color: colors.textColor, fontSize: 11,
                    formatter: region.key === 'substrate'
                        ? `${region.label} · ${region.totalThk.toFixed(2)} mm`
                        : `${region.label} · ${Math.round(region.totalThk)} nm`,
                },
            })),
        };
    }
    return cartesianOption({
        colors: { background: colors.bgColor, paper: colors.paperColor, grid: colors.gridColor, text: colors.textColor },
        grid: plotMargin({ rightAxis: both }),
        fileName: 'index_profile_total',
        legend: both ? legendAbove({ color: colors.textColor }) : { show: false },
        xAxis: {
            ...valueAxis({ color: colors.textColor, gridColor: colors.gridColor, min: 0, max: totalWidth, splitLine: false }),
            axisLabel: { show: false }, axisTick: { show: false },
        },
        yAxis: [
            valueAxis({ name: showN ? 'n' : 'k', color: colors.textColor, gridColor: colors.gridColor, min: 0, position: 'left' }),
            ...(both ? [valueAxis({ name: 'k', color: curve.k, gridColor: colors.gridColor, min: 0, position: 'right', splitLine: false })] : []),
        ],
        series,
    });
}

export function RITotalChart({ regions, quantity, matColorMap, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const curve = useAnalysisColors('refractiveIndexProfiler');
    const colors = {
        bgColor: c.bg || '#1e1e1e', paperColor: c.panel || '#252526',
        gridColor: c.border || '#3a3a3a', textColor: c.text || '#cccccc',
    };
    useEffect(() => { drawChart(divRef.current, chartRef,
        buildRITotalOption(regions, quantity, matColorMap, colors, curve)); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
