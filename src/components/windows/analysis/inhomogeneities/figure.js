import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { axisTooltip, cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { legendAbove, plotMargin } from '../chrome/plot.js';

const DEFAULT_NAMES = { homogeneous: 'base', graded: 'graded' };
export const OVERLAY_CURVES = ['T', 'Ts', 'Tp', 'R', 'Rs', 'Rp', 'A'];
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

export function buildOverlayOption(baseline, perturbed, showCurves, colors, names, c) {
    const text = c.text || '#cccccc';
    const gridColor = c.border || '#3a3a3a';
    return cartesianOption({
        colors: c,
        grid: plotMargin(),
        fileName: 'interlayers',
        legend: legendAbove({ color: text }),
        tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
        xAxis: valueAxis({ name: 'λ (nm)', color: text, gridColor }),
        yAxis: valueAxis({ name: '%', color: text, gridColor, min: 0, max: 100, interval: 10 }),
        series: buildOverlaySeries(baseline, perturbed, showCurves, colors, names),
    });
}
