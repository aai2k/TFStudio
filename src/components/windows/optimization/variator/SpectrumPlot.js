import { buildTargetGeometry } from '../../../../utils/physics/spectrumTargets.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { axisTooltip, cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { targetSeries } from '../../../ui/targetSeries.js';

const { createElement: h, useEffect, useRef } = React;

export function spectrumSeries(data, targets, showTargets, t) {
    if (!data?.lambda) return [];
    const series = [];
    // The baseline is drawn thin, dotted and faint behind the varied curve.
    const add = (values, name, color, baseline) => {
        if (!values) return;
        const item = lineSeries({
            x: data.lambda, y: values.map(value => value * 100), name, color,
            width: baseline ? 1 : 1.6, dash: baseline ? 'dotted' : undefined,
        });
        if (baseline) item.lineStyle.opacity = 0.55;
        series.push(item);
    };
    add(data.T, 'T', '#4fc3f7', false);
    add(data.R, 'R', '#ef5350', false);
    add(data.Tbase, t.variator.baselineCurve('T'), '#4fc3f7', true);
    add(data.Rbase, t.variator.baselineCurve('R'), '#ef5350', true);
    if (showTargets) series.push(...targetSeries(buildTargetGeometry(targets, { names: t.legendNames })));
    return series;
}

export function SpectrumPlot({ data, c, t, targets, showTargets, xLabel }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const text = c.text || '#cccccc';
    const grid = c.border || '#3a3a3a';
    useEffect(() => { drawChart(divRef.current, chartRef, cartesianOption({
        colors: c,
        grid: { left: 52, right: 16, top: 16, bottom: 44 },
        fileName: 'variator_spectrum',
        tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
        xAxis: valueAxis({ name: xLabel, color: text, gridColor: grid, wavelength: true }),
        yAxis: valueAxis({ name: '%', color: text, gridColor: grid, min: 0, max: 100, interval: 10 }),
        series: spectrumSeries(data, targets, showTargets, t),
    })); });
    useChartTeardown(divRef, chartRef);
    if (typeof echarts === 'undefined') return h('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim },
    }, 'ECharts not loaded');
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
