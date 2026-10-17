import { edgePreviewSpectrum } from './model.js';
import { disposeChart, drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { axisTooltip, cartesianOption, horizontalLegend, lineSeries, valueAxis } from '../../../ui/chartOptions.js';

const { createElement: h, useMemo, useEffect, useRef } = React;

// s and p in the colors the Coating Library draws them, solid s and dashed p,
// and their mean, the transmittance of unpolarized light, in the text color.
function curves(c) {
    return [['Ts', '#4fc3f7', 'solid'], ['Tp', '#4fc3f7', 'dashed'], ['T', c.text, 'solid']];
}

/** ECharts option: Ts, Tp and T in %, the edge wavelength marked. */
export function buildEdgePreviewOption(data, c, edgeLambda, lambdaAxis) {
    const series = curves(c).map(([key, color, dash]) => lineSeries({
        x: data.lambda, y: data[key].map(value => value * 100), name: key, color, width: 1.6, dash,
    }));
    series[0].markLine = {
        silent: true, symbol: 'none', label: { show: false },
        lineStyle: { color: c.textDim, width: 1, type: 'dotted' },
        data: [{ xAxis: edgeLambda }],
    };
    return cartesianOption({
        colors: c,
        grid: { left: 44, right: 12, top: 28, bottom: 32 },
        legend: horizontalLegend({ color: c.text, top: 0 }),
        tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
        xAxis: valueAxis({
            name: lambdaAxis, color: c.text, gridColor: c.border, nameGap: 24,
            min: data.lambda[0], max: data.lambda.at(-1), interval: data.xInterval,
            axisLabel: { hideOverlap: true }, wavelength: true,
        }),
        yAxis: valueAxis({ name: '%', color: c.text, gridColor: c.border, min: 0, max: 100, interval: 10, nameGap: 30 }),
        series,
    });
}

/** The finished filter's spectrum at the angle of incidence, filling its pane. */
export function PreviewPlot({ design, compiled, inputs, c, noPreviewText, lambdaAxis }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const data = useMemo(() => edgePreviewSpectrum(design, compiled, inputs), [design, compiled, inputs]);
    useEffect(() => {
        if (data.error) disposeChart(divRef.current, chartRef);
        else drawChart(divRef.current, chartRef, buildEdgePreviewOption(data, c, inputs.edgeLambda, lambdaAxis));
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { style: { position: 'relative', width: '100%', height: '100%' } },
        h('div', { ref: divRef, style: { width: '100%', height: '100%' } }),
        data.error && h('div', {
            style: {
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: c.textDim, fontSize: 12, fontStyle: 'italic',
                background: c.panel, pointerEvents: 'none',
            },
        }, noPreviewText),
    );
}
