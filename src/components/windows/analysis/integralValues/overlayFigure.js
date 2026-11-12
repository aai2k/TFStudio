import { ANALYSIS_DEFAULTS, environmentColor } from '../../../../constants/analysisDefaults.js';
import { weightingText } from '../../../../utils/physics/integralValues/builtinWeightings.js';
import {
    axisTooltip, cartesianOption, lineSeries, scatterSeries, valueAxis,
} from '../../../ui/chartOptions.js';
import { legendAbove, legendUnderTitle, plotMargin } from '../chrome/plot.js';

const FACTORY = ANALYSIS_DEFAULTS.integralValues.colors;
const overlayCharColor = (char, curve) => curve[char] || curve.A;
// The Min mark, a triangle point down. A turned 'triangle' would point up in
// the legend, which ECharts draws without the series' rotation; this shape is
// drawn the same way in both. It is 24 by 8, the legend icon's box, so its
// legend entry matches the Max entry's triangle; on the plot it takes the
// mark's size like any symbol.
const POINT_DOWN = 'path://M0,0L24,0L12,8Z';

function overlayWeightValues(lambda, weighting) {
    const sampler = weighting && weighting.kind !== 'photopic' ? weighting.sampler : null;
    if (!sampler) return null;
    const raw = lambda.map(value => value >= weighting.lamMin && value <= weighting.lamMax ? sampler(value) : 0);
    const maximum = Math.max(...raw, 1e-30);
    return raw.map(value => 100 * value / maximum);
}

// The curve of the integral's channel: the one environment's, named after the
// channel, or under All one per environment, named after it and drawn in its
// colour.
function channelSeries(spectrum, sets, char, curve) {
    if (!sets) {
        return [lineSeries({
            x: spectrum.lambda, y: (spectrum[char] || []).map(value => value * 100),
            name: `${char}(λ)`, color: overlayCharColor(char, curve), width: 2,
        })];
    }
    return sets.map(({ env, spectrum: one }) => lineSeries({
        x: one.lambda, y: (one[char] || []).map(value => value * 100),
        name: env.label, color: environmentColor(curve, env.number), width: 2,
    }));
}

/**
 * `labels` is t.integralValues, which names the weighting curve and the min and
 * max marks; `units` is t.units, which writes the marks' wavelength unit.
 * `sets`, under All, holds each environment's spectrum, `{ env, spectrum }`.
 */
export function buildOverlayOption({ spectrum, sets = null, char, weighting, minMaxMarks, colors, title, lambdaAxis, labels, units, curve = FACTORY }) {
    if (!spectrum?.lambda) return { series: [] };
    const lambdaLow = spectrum.lambda[0];
    const lambdaHigh = spectrum.lambda.at(-1);
    const series = channelSeries(spectrum, sets, char, curve);
    const weightValues = overlayWeightValues(spectrum.lambda, weighting);
    if (weightValues) series.push(lineSeries({
        x: spectrum.lambda, y: weightValues,
        name: labels.weightingCurve(weightingText(weighting, labels.weightings).label || ''),
        color: curve.limits, width: 1, dash: 'dot',
    }));
    if (minMaxMarks && Number.isFinite(minMaxMarks.lamAtMin)) series.push(scatterSeries({
        data: [[minMaxMarks.lamAtMin, minMaxMarks.min * 100]],
        name: `${labels.col_min} ${(minMaxMarks.min * 100).toFixed(2)}% @ ${minMaxMarks.lamAtMin.toFixed(0)} ${units.nm}`,
        color: curve.min, symbol: POINT_DOWN, symbolSize: 10,
    }));
    if (minMaxMarks && Number.isFinite(minMaxMarks.lamAtMax)) series.push(scatterSeries({
        data: [[minMaxMarks.lamAtMax, minMaxMarks.max * 100]],
        name: `${labels.col_max} ${(minMaxMarks.max * 100).toFixed(2)}% @ ${minMaxMarks.lamAtMax.toFixed(0)} ${units.nm}`,
        color: curve.max, symbol: 'triangle', symbolSize: 10,
    }));
    return cartesianOption({
        colors,
        grid: plotMargin({ titleRow: Boolean(title) }),
        title: title ? { text: title, left: 0, top: 2, textStyle: { color: colors.text, fontSize: 11, fontWeight: 'normal' } } : undefined,
        fileName: 'integral',
        tooltip: axisTooltip({ colors, valueSuffix: '%' }),
        legend: title ? legendUnderTitle({ color: colors.text }) : legendAbove({ color: colors.text }),
        // A wavelength axis with no interval of its own is ticked on round
        // wavelengths by the shared rule, however odd the band's start.
        xAxis: valueAxis({
            name: lambdaAxis, color: colors.text, gridColor: colors.grid,
            min: lambdaLow, max: lambdaHigh, wavelength: true,
        }),
        yAxis: valueAxis({
            name: '%', color: colors.text, gridColor: colors.grid,
            min: 0, max: 100, interval: 10,
        }),
        series,
    });
}
