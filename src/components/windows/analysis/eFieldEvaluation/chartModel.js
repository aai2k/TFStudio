import { ANALYSIS_DEFAULTS, environmentColor } from '../../../../constants/analysisDefaults.js';
import {
    axisTooltip, cartesianOption, formatChartNumber, lineSeries, niceAxisBounds, seriesExtent, valueAxis,
} from '../../../ui/chartOptions.js';
import { environmentLegend } from '../chrome/environmentLegend.js';
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

// The curves of one environment shown, `{ env, profile }`. Under All, `env`
// being `{ number, label }`, every polarization is drawn in its colour,
// keeping its dash, and named after it.
function environmentCurves({ env, profile }, pol, curve, tr, display) {
    if (!env) return efieldSeries(profile, pol, curve, tr, display);
    const color = environmentColor(curve, env.number);
    return efieldSeries(profile, pol, { avg: color, s: color, p: color }, tr, display)
        .map(series => ({ ...series, name: `${series.name} (${env.label})` }));
}

// A dotted line at an incident beam's level, in `color` half seen through.
const levelLine = (level, color) => ({ yAxis: level, lineStyle: { color: `${color}88`, type: 'dotted' } });

/**
 * The plot of one profile. Under All, `sets` holds each environment's
 * `{ env, profile }`, the first being `profileData`: every environment's
 * curves are drawn, each environment's incident level in its colour, and the
 * layer bands and boundaries are the first environment's, since thickness
 * factors move them in the others.
 */
export function efieldOption(profileData, pol, matColorMap, colors, {
    curve = ANALYSIS_DEFAULTS.eFieldEvaluation.colors, tr, display, sets = null,
}) {
    const { bgColor, paperColor, gridColor, textColor, accentColor } = colors;
    const shown = sets || [{ env: null, profile: profileData }];
    // The boundary lines and material bands share the curves' axis, so they are
    // measured in the chosen depth unit like every other coordinate here.
    const depth = depthScale(profileData, display.xUnit);
    const bounds = depth.bounds;
    // Films grown thicker in another environment run the axis on past the first's stack.
    const totalZ = Math.max(...shown.map(set => depthScale(set.profile, display.xUnit).total));
    const validLayers = profileData?.validLayers || [];
    const groups = shown.map(set => environmentCurves(set, pol, curve, tr, display));
    const series = groups.flat();
    const { quantity, component } = display;
    // Each incident beam's own level, which the incident medium sets. The first
    // floors the axis so a weak field is not magnified to fill the plot, and
    // sets the tick spacing: a tenth of it, which rules the percentage axis in
    // tens.
    const levels = shown.map(set => incidentLevel(quantity, incidentAmplitudeVpm(set.profile?.incidentIndex)));
    const reference = levels[0];
    // The highest value drawn, found in one pass: the curves of every
    // environment together hold more samples than a call takes as arguments.
    const peak = Math.max(...levels, seriesExtent(series, 1)?.[1] ?? -Infinity);
    const yBounds = niceAxisBounds(0, peak, {
        targetTicks: 10, minInterval: reference / 10, includeZero: true,
    });
    const levelColor = k => (shown[k].env ? environmentColor(curve, shown[k].env.number) : accentColor);

    groups.forEach((group, k) => {
        if (k > 0 && group.length) {
            group[0].markLine = { silent: true, symbol: 'none', label: { show: false }, data: [levelLine(levels[k], levelColor(k))] };
        }
    });
    if (series.length) {
        series[0].markLine = {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: gridColor, width: 1, type: 'dotted' },
            data: [
                ...bounds.slice(1, -1).map(value => ({ xAxis: value })),
                levelLine(reference, levelColor(0)),
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

    const key = sets ? environmentLegend(sets.map(set => set.env), curve, textColor) : null;
    if (key) series.push(...key.series);
    return cartesianOption({
        colors: { background: bgColor, paper: paperColor, grid: gridColor, text: textColor },
        grid: plotMargin(),
        legend: key ? key.legend : legendAbove({ color: textColor }),
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
