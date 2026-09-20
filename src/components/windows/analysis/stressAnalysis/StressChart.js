/**
 * Per-film stress as a bar per layer, in the material's colour, tensile up and
 * compressive down. It is the one thing here Essential Macleod's table does not
 * show, and it is what says at a glance which layers carry the force.
 */

import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { cartesianOption, formatChartReadout, itemTooltip, valueAxis } from '../../../ui/chartOptions.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { legendAbove, materialBarSeries, plotMargin } from '../chrome/plot.js';
import { barLabel } from './tableModel.js';

const { createElement: h, useEffect, useRef } = React;

export function buildStressOption({
    rows, matColorMap, bothSides, sa, c,
    colors = ANALYSIS_DEFAULTS.stressAnalysis.colors,
}) {
    // A film whose material states no stress has no bar; a stack where none of
    // them do has no chart.
    const drawn = rows.filter(row => row.stressMPa != null);
    if (!drawn.length) return { series: [] };
    const text = c.text || '#cccccc';
    const gridColor = c.border || '#3a3a3a';
    const labels = drawn.map(row => barLabel(row, sa, bothSides));
    const series = materialBarSeries(drawn, row => row.stressMPa,
        { matColorMap, gridColor, fallback: colors.fallback });
    return cartesianOption({
        colors: c,
        grid: plotMargin(),
        fileName: 'film_stress',
        legend: series.length > 1 ? legendAbove({ color: text }) : { show: false },
        tooltip: {
            ...itemTooltip(c),
            formatter: params => [
                `${sa.axisLayer} ${labels[params.dataIndex]}`,
                `${params.marker}${params.seriesName}&nbsp;&nbsp;<b>${
                    formatChartReadout(params.value)} MPa</b>`,
            ].join('<br/>'),
        },
        xAxis: {
            type: 'category', data: labels, name: sa.axisLayer,
            nameLocation: 'middle', nameGap: 30,
            nameTextStyle: { color: text, fontSize: 11 },
            axisLine: { lineStyle: { color: text } },
            axisLabel: {
                color: text, fontSize: 10,
                ...(labels.length <= 30 ? { interval: 0 } : {}),
            },
        },
        // No forced zero bound: the axis has to hold both signs, because
        // tensile and compressive films are what a balanced stack is made of.
        yAxis: valueAxis({ name: sa.axisStress, color: text, gridColor }),
        series,
    });
}

export function StressChart(props) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const colors = useAnalysisColors('stressAnalysis');
    useEffect(() => { drawChart(divRef.current, chartRef, buildStressOption({ ...props, colors })); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
