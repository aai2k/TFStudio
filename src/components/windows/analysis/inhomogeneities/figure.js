import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { axisTooltip, cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { legendAbove, plotMargin } from '../chrome/plot.js';

const DEFAULT_NAMES = { homogeneous: 'base', graded: 'graded' };

// Same shape as Optical Evaluation's: one pill per quantity, one button per
// polarization inside it. Every polarization is already in the computed
// spectrum, so switching one on costs nothing.
export const CURVE_GROUPS = [
    { q: 'T', members: [{ pol: 'avg', key: 'T' }, { pol: 's', key: 'Ts' }, { pol: 'p', key: 'Tp' }] },
    { q: 'R', members: [{ pol: 'avg', key: 'R' }, { pol: 's', key: 'Rs' }, { pol: 'p', key: 'Rp' }] },
    { q: 'A', members: [{ pol: 'avg', key: 'A' }, { pol: 's', key: 'As' }, { pol: 'p', key: 'Ap' }] },
];

// The curves in plot and table order, read off the switches so a switch never
// exists without a curve to draw.
export const OVERLAY_CURVES = CURVE_GROUPS.flatMap(group => group.members.map(member => member.key));
export function enabledOverlayCurves(showCurves) { return OVERLAY_CURVES.filter(key => showCurves?.[key]); }

export function buildOverlaySeries(baseline, perturbed, showCurves,
                                   colors = ANALYSIS_DEFAULTS.inhomogeneities.colors,
                                   names = DEFAULT_NAMES) {
    if (!perturbed) return [];
    const series = [];
    const pct = values => values.map(value => value * 100);
    for (const key of enabledOverlayCurves(showCurves)) {
        if (!perturbed[key]) continue;
        if (baseline?.[key]) {
            const reference = lineSeries({
                x: baseline.lambda, y: pct(baseline[key]), name: `${key} ${names.homogeneous}`,
                color: colors[key], dash: 'dot', width: 1.4, silent: true,
            });
            reference.lineStyle.opacity = 0.55;
            series.push(reference);
        }
        series.push(lineSeries({
            x: perturbed.lambda, y: pct(perturbed[key]), name: `${key} ${names.graded}`,
            color: colors[key], width: 2,
        }));
    }
    return series;
}

export function buildOverlayOption({ baseline, perturbed, showCurves, colors, names, c, lambdaAxis }) {
    const text = c.text || '#cccccc';
    const gridColor = c.border || '#3a3a3a';
    return cartesianOption({
        colors: c,
        grid: plotMargin(),
        fileName: 'interlayers',
        legend: legendAbove({ color: text }),
        tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
        xAxis: valueAxis({ name: lambdaAxis, color: text, gridColor }),
        yAxis: valueAxis({ name: '%', color: text, gridColor, min: 0, max: 100, interval: 10 }),
        series: buildOverlaySeries(baseline, perturbed, showCurves, colors, names),
    });
}
