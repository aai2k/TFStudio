import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import {
    axisTooltip, cartesianOption, lineSeries, niceAxisBounds, valueAxis,
} from '../../../ui/chartOptions.js';
import { legendAbove, plotMargin } from '../chrome/plot.js';

/** Native ECharts line series for the selected polarization. */
export function efieldSeries(profileData, pol, curve = ANALYSIS_DEFAULTS.eFieldEvaluation.colors) {
    if (!profileData) return [];
    const series = [];
    const addCurve = (e2arr, z, name, color, dash) => series.push(lineSeries({
        x: z, y: e2arr.map(value => value * 100), name, color, width: 2, dash,
    }));
    if (pol === 'avg' && profileData.avg) {
        addCurve(profileData.avg.e2, profileData.avg.z, '|E|² (avg)', curve.avg);
        addCurve(profileData.s.e2, profileData.s.z, '|E|² (s)', curve.s, 'dot');
        addCurve(profileData.p.e2, profileData.p.z, '|E|² (p)', curve.p, 'dash');
    } else if (pol === 's' && profileData.s) {
        addCurve(profileData.s.e2, profileData.s.z, '|E|² (s)', curve.s);
    } else if (pol === 'p' && profileData.p) {
        addCurve(profileData.p.e2, profileData.p.z, '|E|² (p)', curve.p);
    }
    return series;
}

export function efieldOption(profileData, pol, matColorMap, colors, curve) {
    const { bgColor, paperColor, gridColor, textColor, accentColor } = colors;
    const profileRef = pol === 'avg' ? profileData?.avg : profileData?.[pol];
    const bounds = profileRef?.layerBounds || [];
    const totalZ = bounds.length > 1 ? bounds[bounds.length - 1] : 0;
    const validLayers = profileData?.validLayers || [];
    const series = efieldSeries(profileData, pol, curve);
    const peak = Math.max(100, ...series.flatMap(item => item.data.map(point => point[1])).filter(Number.isFinite));
    const yBounds = niceAxisBounds(0, peak, { targetTicks: 10, minInterval: 10, includeZero: true });

    if (series.length) {
        series[0].markLine = {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: gridColor, width: 1, type: 'dotted' },
            data: [
                ...bounds.slice(1, -1).map(value => ({ xAxis: value })),
                { yAxis: 100, lineStyle: { color: `${accentColor}88`, type: 'dotted' } },
            ],
        };
        series[0].markArea = {
            silent: true,
            data: validLayers.slice(0, Math.max(0, bounds.length - 1)).map((layer, index) => [
                {
                    xAxis: bounds[index],
                    itemStyle: { color: matColorMap[layer?.materialId] || '#555555', opacity: 0.13 },
                },
                { xAxis: bounds[index + 1] },
            ]),
        };
    }

    return cartesianOption({
        colors: { background: bgColor, paper: paperColor, grid: gridColor, text: textColor },
        grid: plotMargin(),
        legend: legendAbove({ color: textColor }),
        fileName: 'efield',
        tooltip: axisTooltip({ valueSuffix: '%' }),
        xAxis: valueAxis({ name: 'Depth (nm)', color: textColor, gridColor, min: totalZ > 0 ? 0 : undefined, max: totalZ > 0 ? totalZ : undefined }),
        yAxis: valueAxis({
            name: '|E|² (%)', color: textColor, gridColor, min: yBounds.min,
            max: yBounds.max, interval: yBounds.interval,
        }),
        series,
    });
}
