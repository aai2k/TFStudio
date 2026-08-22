import { buildGdGddTargetGeometry } from './gdTargets.js';
import {
    axisTooltip, cartesianOption, lineSeries, niceAxisBounds, valueAxis,
} from '../../../ui/chartOptions.js';
import { targetSeries } from '../../../ui/targetSeries.js';
import { plotMargin } from '../chrome/plot.js';

export function buildGDChartOption(options) {
    const {
        data, meta, referenceLambda, showReference, colors, targets = [], yRange, yInterval,
    } = options;
    const main = lineSeries({ x: data.lambda, y: data.y, name: meta.label, color: meta.color, width: 2 });
    const targetGeometry = buildGdGddTargetGeometry(targets);
    const reference = showReference && referenceLambda >= Math.min(...data.lambda)
        && referenceLambda <= Math.max(...data.lambda);
    main.markLine = {
        silent: true, symbol: 'none', label: { show: false },
        lineStyle: { color: colors.text, width: 1, type: 'dotted' },
        data: reference ? [{ xAxis: referenceLambda }] : [],
    };
    const fixedRange = Array.isArray(yRange) && yRange.every(Number.isFinite) && yRange[0] < yRange[1];
    const finiteValues = data.y.filter(Number.isFinite);
    const automatic = !fixedRange && finiteValues.length
        ? niceAxisBounds(Math.min(...finiteValues), Math.max(...finiteValues), { targetTicks: 10 })
        : null;
    return cartesianOption({
        colors,
        grid: plotMargin(),
        fileName: 'dispersion',
        legend: { show: false },
        tooltip: axisTooltip({ colors, valueSuffix: meta.unit ? ` ${meta.unit}` : '' }),
        xAxis: valueAxis({ name: 'Wavelength (nm)', color: colors.text, gridColor: colors.grid }),
        yAxis: valueAxis({
            name: meta.label, color: colors.text, gridColor: colors.grid,
            min: fixedRange ? yRange[0] : automatic?.min,
            max: fixedRange ? yRange[1] : automatic?.max,
            interval: yInterval ?? automatic?.interval,
            scale: !fixedRange,
        }),
        series: [main, ...targetSeries(targetGeometry)],
    });
}
