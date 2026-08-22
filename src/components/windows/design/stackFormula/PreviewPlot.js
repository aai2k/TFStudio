import { previewSpectrum } from './model.js';
import { disposeChart, drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { axisTooltip, cartesianOption, horizontalLegend, lineSeries, valueAxis } from '../../../ui/chartOptions.js';

const { createElement: h, useMemo, useEffect, useRef } = React;

export function buildPreviewOption(data, c, referenceWavelength) {
    const series = [
        lineSeries({ x: data.lambda, y: data.T.map(value => value * 100), name: 'T', color: '#4fc3f7', width: 1.6 }),
        lineSeries({ x: data.lambda, y: data.R.map(value => value * 100), name: 'R', color: '#ef5350', width: 1.6 }),
    ];
    series[0].markLine = {
        silent: true, symbol: 'none', label: { show: false },
        lineStyle: { color: c.textDim, width: 1, type: 'dotted' },
        data: [{ xAxis: referenceWavelength }],
    };
    return cartesianOption({
        colors: c,
        grid: { left: 44, right: 12, top: 28, bottom: 32 },
        legend: horizontalLegend({ color: c.text, top: 0 }),
        tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
        xAxis: valueAxis({
            name: 'λ (nm)', color: c.text, gridColor: c.border, nameGap: 24,
            min: data.lambda[0], max: data.lambda.at(-1), interval: data.xInterval,
            axisLabel: { hideOverlap: true },
        }),
        yAxis: valueAxis({ name: '%', color: c.text, gridColor: c.border, min: 0, max: 100, interval: 10, nameGap: 30 }),
        series,
    });
}

export function PreviewPlot({ resolveMaterial, compiled, incidentId, substrateId, refLambda, c, height = 220 }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const data = useMemo(
        () => previewSpectrum(resolveMaterial, compiled, incidentId, substrateId, refLambda),
        [resolveMaterial, compiled, incidentId, substrateId, refLambda]);
    useEffect(() => {
        if (data.error) disposeChart(divRef.current, chartRef);
        else drawChart(divRef.current, chartRef, buildPreviewOption(data, c, refLambda));
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { style: { position: 'relative', width: '100%', height } },
        h('div', { ref: divRef, style: { width: '100%', height } }),
        data.error && h('div', {
            style: {
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: c.textDim, fontSize: 12, fontStyle: 'italic',
                background: c.panel, pointerEvents: 'none',
            },
        }, '— no preview —'),
    );
}
