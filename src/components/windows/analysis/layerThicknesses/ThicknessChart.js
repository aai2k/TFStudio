import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { cartesianOption, formatChartReadout, itemTooltip, valueAxis } from '../../../ui/chartOptions.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { legendAbove, plotMargin } from '../chrome/plot.js';
import { rowValue } from './thicknessModel.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useRef } = React;

/**
 * One bar series per distinct material, overlapped onto the same category
 * slots, so the legend doubles as the material key. Only one series holds a
 * value at any layer, which is what makes the overlap safe.
 */
function materialSeries(rows, unit, matColorMap, gridColor, fallback) {
    const byName = new Map();
    rows.forEach((row, index) => {
        if (!byName.has(row.materialName)) {
            byName.set(row.materialName, {
                name: row.materialName,
                type: 'bar',
                data: new Array(rows.length).fill(null),
                barGap: '-100%',
                barCategoryGap: '20%',
                itemStyle: {
                    color: matColorMap[row.materialId] || fallback,
                    borderColor: gridColor,
                    borderWidth: 1,
                },
                animation: false,
            });
        }
        byName.get(row.materialName).data[index] = rowValue(row, unit);
    });
    return [...byName.values()];
}

export function buildThicknessOption({
    rows, unit, matColorMap, c, xTitle, yTitle, valueSuffix = '',
    colors = ANALYSIS_DEFAULTS.layerThicknesses.colors,
}) {
    if (!rows?.length) return { series: [] };
    const text = c.text || '#cccccc';
    const gridColor = c.border || '#3a3a3a';
    const labels = rows.map(row => String(row.layerNumber));
    const series = materialSeries(rows, unit, matColorMap, gridColor, colors.fallback);
    return cartesianOption({
        colors: c,
        grid: plotMargin(),
        fileName: 'layer_thicknesses',
        legend: series.length > 1 ? legendAbove({ color: text }) : { show: false },
        tooltip: {
            ...itemTooltip(c),
            formatter: params => [
                `${xTitle} ${labels[params.dataIndex]}`,
                `${params.marker}${params.seriesName}&nbsp;&nbsp;<b>${
                    formatChartReadout(params.value)}${valueSuffix}</b>`,
            ].join('<br/>'),
        },
        xAxis: {
            type: 'category', data: labels, name: xTitle, nameLocation: 'middle', nameGap: 30,
            nameTextStyle: { color: text, fontSize: 11 },
            axisLine: { lineStyle: { color: text } },
            axisLabel: {
                color: text, fontSize: 10,
                // Every bar is labelled while they fit; past that ECharts thins
                // the labels itself.
                ...(labels.length <= 30 ? { interval: 0 } : {}),
            },
        },
        yAxis: valueAxis({ name: yTitle, color: text, gridColor, min: 0 }),
        series,
    });
}

export function ThicknessChart(props) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const colors = useAnalysisColors('layerThicknesses');
    useEffect(() => { drawChart(divRef.current, chartRef, buildThicknessOption({ ...props, colors })); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
