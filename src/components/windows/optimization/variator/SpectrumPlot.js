import { buildTargetGeometry } from '../../../../utils/physics/spectrumTargets.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { axisTooltip, cartesianOption, horizontalLegend, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { targetSeries } from '../../../ui/targetSeries.js';

const { createElement: h, useEffect, useRef } = React;

function spectrumSeries(data, targets, showTargets) {
    if (!data?.lambda) return [];
    const series = [];
    const add = (values, name, color, width, dash) => {
        if (!values) return;
        const item = lineSeries({ x: data.lambda, y: values.map(value => value * 100), name, color, width, dash });
        if (name.includes('baseline')) item.lineStyle.opacity = 0.55;
        series.push(item);
    };
    add(data.T, 'T', '#4fc3f7', 1.6);
    add(data.R, 'R', '#ef5350', 1.6);
    add(data.Tbase, 'T (baseline)', '#4fc3f7', 1, 'dotted');
    add(data.Rbase, 'R (baseline)', '#ef5350', 1, 'dotted');
    if (showTargets) series.push(...targetSeries(buildTargetGeometry(targets)));
    return series;
}

export function SpectrumPlot({ data, c, targets, showTargets }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const text = c.text || '#cccccc';
    const grid = c.border || '#3a3a3a';
    useEffect(() => { drawChart(divRef.current, chartRef, cartesianOption({
        colors: c,
        grid: { left: 52, right: 16, top: 16, bottom: 44 },
        fileName: 'variator_spectrum',
        legend: horizontalLegend({ color: text, top: 0 }),
        tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
        xAxis: valueAxis({ name: 'Wavelength (nm)', color: text, gridColor: grid }),
        yAxis: valueAxis({ name: '%', color: text, gridColor: grid, min: 0, max: 100, interval: 10 }),
        series: spectrumSeries(data, targets, showTargets),
    })); });
    useChartTeardown(divRef, chartRef);
    if (typeof echarts === 'undefined') return h('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim },
    }, 'ECharts not loaded');
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
