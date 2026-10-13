import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { weightingText } from '../../../../utils/physics/integralValues/builtinWeightings.js';
import {
    axisTooltip, cartesianOption, lineSeries, scatterSeries, valueAxis,
} from '../../../ui/chartOptions.js';
import { legendInsideLeft, plotMargin } from '../chrome/plot.js';

const FACTORY = ANALYSIS_DEFAULTS.integralValues.colors;
const overlayCharColor = (char, curve) => curve[char] || curve.A;

function overlayWeightValues(lambda, weighting) {
    const sampler = weighting && weighting.kind !== 'photopic' ? weighting.sampler : null;
    if (!sampler) return null;
    const raw = lambda.map(value => value >= weighting.lamMin && value <= weighting.lamMax ? sampler(value) : 0);
    const maximum = Math.max(...raw, 1e-30);
    return raw.map(value => 100 * value / maximum);
}

/** `labels` is t.integralValues, which names the weighting curve and the min and max marks. */
export function buildOverlayOption({ spectrum, char, weighting, minMaxMarks, colors, title, lambdaAxis, labels, curve = FACTORY }) {
    if (!spectrum?.lambda) return { series: [] };
    const lambdaLow = spectrum.lambda[0];
    const lambdaHigh = spectrum.lambda.at(-1);
    const series = [lineSeries({
        x: spectrum.lambda, y: (spectrum[char] || []).map(value => value * 100),
        name: `${char}(λ)`, color: overlayCharColor(char, curve), width: 2,
    })];
    const weightValues = overlayWeightValues(spectrum.lambda, weighting);
    if (weightValues) series.push(lineSeries({
        x: spectrum.lambda, y: weightValues,
        name: labels.weightingCurve(weightingText(weighting, labels.weightings).label || ''),
        color: curve.limits, width: 1, dash: 'dot',
    }));
    if (minMaxMarks && Number.isFinite(minMaxMarks.lamAtMin)) {
        const marker = scatterSeries({
            data: [[minMaxMarks.lamAtMin, minMaxMarks.min * 100]],
            name: `${labels.col_min} ${(minMaxMarks.min * 100).toFixed(2)}% @ ${minMaxMarks.lamAtMin.toFixed(0)} nm`,
            color: curve.min, symbol: 'triangle', symbolSize: 10,
        });
        marker.symbolRotate = 180;
        series.push(marker);
    }
    if (minMaxMarks && Number.isFinite(minMaxMarks.lamAtMax)) series.push(scatterSeries({
        data: [[minMaxMarks.lamAtMax, minMaxMarks.max * 100]],
        name: `${labels.col_max} ${(minMaxMarks.max * 100).toFixed(2)}% @ ${minMaxMarks.lamAtMax.toFixed(0)} nm`,
        color: curve.max, symbol: 'triangle', symbolSize: 10,
    }));
    return cartesianOption({
        colors,
        grid: plotMargin(),
        title: title ? { text: title, left: 0, top: 2, textStyle: { color: colors.text, fontSize: 11, fontWeight: 'normal' } } : undefined,
        fileName: 'integral',
        tooltip: axisTooltip({ colors, valueSuffix: '%' }),
        legend: legendInsideLeft({ panel: colors.panel, border: colors.grid }, { color: colors.text }),
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
