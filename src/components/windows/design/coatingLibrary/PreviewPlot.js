import { entrySpectrum } from '../../../../utils/coatingLibrary/entryModel.js';
import { disposeChart, drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import {
    axisTooltip, cartesianOption, dimmedBandSeries, horizontalLegend, lineSeries, valueAxis,
} from '../../../ui/chartOptions.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

// At normal incidence s and p coincide, so T, R and A are the whole story. At
// an angle the coating is specified by its s and p behaviour, so those are
// drawn as pairs (solid s, dashed p) and absorptance is left out.
const NORMAL_CURVES = [
    ['T', 'T', '#4fc3f7', 'solid'],
    ['R', 'R', '#ef5350', 'solid'],
    ['A', 'A', '#ffb74d', 'solid'],
];
const OBLIQUE_CURVES = [
    ['Ts', 'Ts', '#4fc3f7', 'solid'],
    ['Tp', 'Tp', '#4fc3f7', 'dashed'],
    ['Rs', 'Rs', '#ef5350', 'solid'],
    ['Rp', 'Rp', '#ef5350', 'dashed'],
];

/** ECharts option for a coating's spectrum at its own angle, the design bands marked and the angle stated. */
export function buildPreviewOption(spectrum, entry, c, ts) {
    const curves = entry.aoi > 0 ? OBLIQUE_CURVES : NORMAL_CURVES;
    const series = [
        ...dimmedBandSeries(entry.bands.map(([x0, x1], i) => ({ x0, x1, label: i === 0 ? ts.band : '' })), c),
        ...curves.map(([key, name, color, dash]) => lineSeries({
            x: spectrum.lambda, y: spectrum[key].map(value => value * 100), name, color, width: 1.6, dash,
        })),
    ];
    return cartesianOption({
        colors: c,
        grid: { left: 44, right: 12, top: 40, bottom: 32 },
        title: {
            text: ts.previewAt(entry.aoi, ts.pols[entry.polarization] || entry.polarization),
            left: 44, top: 0, textStyle: { fontSize: 11, fontWeight: 'normal', color: c.textDim },
        },
        legend: horizontalLegend({ color: c.text, top: 16 }),
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
