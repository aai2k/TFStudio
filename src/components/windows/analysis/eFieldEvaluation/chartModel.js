import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import {
    axisTooltip, cartesianOption, formatChartNumber, lineSeries, niceAxisBounds, valueAxis,
} from '../../../ui/chartOptions.js';
import { legendAbove, plotMargin } from '../chrome/plot.js';
import { depthScale, xAxisTitle } from './xScale.js';
import {
    incidentAmplitudeVpm, incidentLevel, yAxisTitle, yScaleTooltip,
} from './yScale.js';
import { plottedCurves } from './profileViewModel.js';

/**
 * Native ECharts line series for the selected polarization. `tr` is `t.eField`.
 * `display` carries what the two axes read and which component of the field
 * they read; all three come from the window's settings menu.
 */
export function efieldSeries(profileData, pol, curve = ANALYSIS_DEFAULTS.eFieldEvaluation.colors, tr, display) {
    const curves = plottedCurves(profileData, pol, tr, display);
    const dash = { avg: undefined, s: 'dot', p: 'dash' };
    return curves.map(item => lineSeries({
        x: item.z, y: item.y, name: item.label, color: curve[item.key], width: 2,
        dash: curves.length > 1 ? dash[item.key] : undefined,
    }));
}

export function efieldOption(profileData, pol, matColorMap, colors, { curve, tr, display }) {
    const { bgColor, paperColor, gridColor, textColor, accentColor } = colors;
    // The boundary lines and material bands share the curves' axis, so they are
    // measured in the chosen depth unit like every other coordinate here.
    const depth = depthScale(profileData, display.xUnit);
    const bounds = depth.bounds;
    const totalZ = depth.total;
    const validLayers = profileData?.validLayers || [];
    const series = efieldSeries(profileData, pol, curve, tr, display);
    const { quantity, component } = display;
    const incident = incidentAmplitudeVpm(profileData?.incidentIndex);
    // The incident beam's own level. It floors the axis so a weak field is not
    // magnified to fill the plot, and sets the tick spacing: a tenth of it,
    // which rules the percentage axis in tens.
    const reference = incidentLevel(quantity, incident);
    const peak = Math.max(reference, ...series.flatMap(item => item.data.map(point => point[1])).filter(Number.isFinite));
    const yBounds = niceAxisBounds(0, peak, {
        targetTicks: 10, minInterval: reference / 10, includeZero: true,
    });

    if (series.length) {
        series[0].markLine = {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: gridColor, width: 1, type: 'dotted' },
            data: [
                ...bounds.slice(1, -1).map(value => ({ xAxis: value })),
                { yAxis: reference, lineStyle: { color: `${accentColor}88`, type: 'dotted' } },
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
        // `series` is what installs the formatter, so the readout carries the
        // unit; with three quantities on offer a bare number is ambiguous.
        tooltip: axisTooltip({ ...yScaleTooltip(quantity), series }),
        xAxis: valueAxis({
            name: xAxisTitle(depth, profileData?.refLambda, tr), color: textColor, gridColor,
            min: totalZ > 0 ? 0 : undefined, max: totalZ > 0 ? totalZ : undefined,
        }),
        yAxis: valueAxis({
            name: yAxisTitle(quantity, component), color: textColor, gridColor, min: yBounds.min,
            max: yBounds.max, interval: yBounds.interval, formatter: formatChartNumber,
        }),
        series,
    });
}
