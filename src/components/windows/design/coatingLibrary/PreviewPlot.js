import { entrySpectrum } from '../../../../utils/coatingLibrary/entryModel.js';
import { disposeChart, drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import {
    axisTooltip, cartesianOption, dimmedBandSeries, horizontalLegend, lineSeries, valueAxis,
} from '../../../ui/chartOptions.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

const CURVES = [
    ['T', '#4fc3f7'],
    ['R', '#ef5350'],
    ['A', '#ffb74d'],
];

/** ECharts option for a coating's T, R and A over its preview range, with the design band marked. */
export function buildPreviewOption(spectrum, entry, c, ts) {
    const series = [
        ...dimmedBandSeries(entry.bands.map(([x0, x1], i) => ({ x0, x1, label: i === 0 ? ts.band : '' })), c),
        ...CURVES.map(([key, color]) => lineSeries({
            x: spectrum.lambda, y: spectrum[key].map(value => value * 100), name: key, color, width: 1.6,
        })),
    ];
    return cartesianOption({
        colors: c,
        grid: { left: 44, right: 12, top: 28, bottom: 32 },
        legend: horizontalLegend({ color: c.text, top: 0 }),
        tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
        xAxis: valueAxis({
            name: 'λ (nm)', color: c.text, gridColor: c.border, nameGap: 24,
            min: spectrum.lambda[0], max: spectrum.lambda.at(-1),
        }),
        yAxis: valueAxis({ name: '%', color: c.text, gridColor: c.border, min: 0, max: 100, interval: 10, nameGap: 30 }),
        series,
    });
}

export function PreviewPlot({ entry, c, ts, height = 240 }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const spectrum = useMemo(() => entrySpectrum(entry), [entry]);
    useEffect(() => {
        if (spectrum.error) disposeChart(divRef.current, chartRef);
        else drawChart(divRef.current, chartRef, buildPreviewOption(spectrum, entry, c, ts));
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { style: { position: 'relative', width: '100%', height } },
        h('div', { ref: divRef, style: { width: '100%', height } }),
        spectrum.error && h('div', {
            style: {
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: c.textDim, fontSize: 12, fontStyle: 'italic',
                background: c.panel, pointerEvents: 'none', padding: 12, textAlign: 'center',
            },
        }, ts.noPreview),
    );
}
