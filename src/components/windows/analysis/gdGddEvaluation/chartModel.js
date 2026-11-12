import { buildGdGddTargetGeometry } from './gdTargets.js';
import { ANALYSIS_DEFAULTS, environmentColor } from '../../../../constants/analysisDefaults.js';
import {
    axisTooltip, cartesianOption, chartToolbox, dimmedBandSeries, lineSeries, niceAxisBounds,
    seriesExtent, valueAxis,
} from '../../../ui/chartOptions.js';
import { targetSeries } from '../../../ui/targetSeries.js';
import { environmentLegend } from '../chrome/environmentLegend.js';
import { plotMargin } from '../chrome/plot.js';

// The curves: the one spectrum's, or under All (`sets`, each `{ env, data }`)
// one per environment in its colour from `curveColors`, named after it for the
// readout.
function curveSeries({ data, sets, meta, curveColors }) {
    if (!sets) return [lineSeries({ x: data.lambda, y: data.y, name: meta.label, color: meta.color, width: 2 })];
    return sets.filter(set => set.data).map(set => lineSeries({
        x: set.data.lambda, y: set.data.y, name: `${meta.label} (${set.env.label})`,
        color: environmentColor(curveColors, set.env.number), width: 2,
    }));
}

export function buildGDChartOption(options) {
    const {
        data, sets, meta, referenceLambda, showReference, colors, targets = [], yRange, yInterval, xLabel,
        editMode = false, editTool = 'draw', materialBands,
        curveColors = ANALYSIS_DEFAULTS.gdGddEvaluation.colors,
    } = options;
    // While a target is being drawn the pointer belongs to the editor: the
    // readout would freeze under it, and the rectangle zoom would take the
    // drag that was meant to make a target.
    const drawing = editMode && editTool === 'draw';
    const curves = curveSeries({ data, sets, meta, curveColors });
    // The reference wavelength's line is drawn on the first curve.
    const [main] = curves;
    const targetGeometry = buildGdGddTargetGeometry(targets);
    const reference = showReference && referenceLambda >= Math.min(...data.lambda)
        && referenceLambda <= Math.max(...data.lambda);
    main.markLine = {
        silent: true, symbol: 'none', label: { show: false },
        lineStyle: { color: colors.text, width: 1, type: 'dotted' },
        data: reference ? [{ xAxis: referenceLambda }] : [],
    };
    const fixedRange = Array.isArray(yRange) && yRange.every(Number.isFinite) && yRange[0] < yRange[1];
    // The span of every curve drawn, found in one pass: the curves of every
    // environment together can hold more values than a call takes as arguments.
    const extent = seriesExtent(curves, 1);
    const automatic = !fixedRange && extent
        ? niceAxisBounds(extent[0], extent[1], { targetTicks: 10 })
        : null;
    // Under All the legend above the plot names each environment in its colour.
    const key = sets ? environmentLegend(sets.map(set => set.env), curveColors, colors.text) : null;
    return cartesianOption({
        colors,
        grid: plotMargin(),
        legend: key?.legend ?? { show: false },
        tooltip: drawing
            ? { show: false }
            : axisTooltip({ colors, valueSuffix: meta.unit ? ` ${meta.unit}` : '' }),
        toolbox: chartToolbox('dispersion', { dataZoom: !drawing }),
        xAxis: valueAxis({ name: xLabel, color: colors.text, gridColor: colors.grid, wavelength: true }),
        yAxis: valueAxis({
            name: meta.label, color: colors.text, gridColor: colors.grid,
            min: fixedRange ? yRange[0] : automatic?.min,
            max: fixedRange ? yRange[1] : automatic?.max,
            interval: yInterval ?? automatic?.interval,
            scale: !fixedRange,
        }),
        series: [
            ...curves,
            ...targetSeries(targetGeometry),
            ...dimmedBandSeries(materialBands, colors),
            ...(key ? key.series : []),
        ],
    });
}
