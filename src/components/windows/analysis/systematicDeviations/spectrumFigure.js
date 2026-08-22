import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { axisTooltip, cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { legendAbove, plotMargin } from '../chrome/plot.js';

const percent = values => values.map(value => value * 100);

export function buildSpectrumSeries(baseline, deviated, channel, showBaseline,
                                    colors = ANALYSIS_DEFAULTS.systematicDeviations.colors) {
    if (!deviated) return [];
    const series = [];
    const channels = channel === 'all' ? ['T', 'R', 'A'] : [channel];
    for (const key of channels) {
        if (showBaseline && baseline) {
            const reference = lineSeries({
                x: baseline.lambda, y: percent(baseline[key]), name: `${key} baseline`,
                color: colors[key], dash: 'dot', width: 1.4, silent: true,
            });
            reference.lineStyle.opacity = 0.6;
            series.push(reference);
        }
        series.push(lineSeries({
            x: deviated.lambda, y: percent(deviated[key]), name: `${key} deviated`,
            color: colors[key], width: 2,
        }));
    }
    return series;
}

export function buildSpectrumOption(baseline, deviated, channel, showBaseline, colors, c) {
    const text = c.text || '#cccccc';
    const gridColor = c.border || '#3a3a3a';
    return cartesianOption({
        colors: c,
        grid: plotMargin(),
        fileName: 'deviations',
        legend: legendAbove({ color: text }),
        tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
        xAxis: valueAxis({ name: 'λ (nm)', color: text, gridColor }),
        yAxis: valueAxis({ name: '%', color: text, gridColor, min: 0, max: 100, interval: 10 }),
        series: buildSpectrumSeries(baseline, deviated, channel, showBaseline, colors),
    });
}
