import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import {
    axisTooltip, cartesianOption, formatChartNumber, lineSeries, niceTickInterval,
    scatterSeries, valueAxis,
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

export function buildOverlayOption({ spectrum, char, weighting, minMaxMarks, colors, title, curve = FACTORY }) {
    if (!spectrum?.lambda) return { series: [] };
    const lambdaLow = spectrum.lambda[0];
    const lambdaHigh = spectrum.lambda.at(-1);
    const labelStep = niceTickInterval(lambdaHigh - lambdaLow, { targetTicks: 10, min: 50 });
    const wavelengthLabel = value => {
        const multiple = (Number(value) - lambdaLow) / labelStep;
        const endpoint = Math.abs(Number(value) - lambdaHigh) < 1e-7;
        return endpoint || Math.abs(multiple - Math.round(multiple)) < 1e-7
            ? formatChartNumber(value) : '';
    };
    const series = [lineSeries({
        x: spectrum.lambda, y: (spectrum[char] || []).map(value => value * 100),
        name: `${char}(λ)`, color: overlayCharColor(char, curve), width: 2,
    })];
    const weightValues = overlayWeightValues(spectrum.lambda, weighting);
    if (weightValues) series.push(lineSeries({
        x: spectrum.lambda, y: weightValues, name: `${weighting?.label || ''} (norm.)`,
        color: curve.limits, width: 1, dash: 'dot',
    }));
    if (minMaxMarks && Number.isFinite(minMaxMarks.lamAtMin)) {
        const marker = scatterSeries({
            data: [[minMaxMarks.lamAtMin, minMaxMarks.min * 100]],
            name: `min ${(minMaxMarks.min * 100).toFixed(2)}% @ ${minMaxMarks.lamAtMin.toFixed(0)} nm`,
            color: curve.min, symbol: 'triangle', symbolSize: 10,
        });
        marker.symbolRotate = 180;
        series.push(marker);
    }
    if (minMaxMarks && Number.isFinite(minMaxMarks.lamAtMax)) series.push(scatterSeries({
        data: [[minMaxMarks.lamAtMax, minMaxMarks.max * 100]],
        name: `max ${(minMaxMarks.max * 100).toFixed(2)}% @ ${minMaxMarks.lamAtMax.toFixed(0)} nm`,
        color: curve.max, symbol: 'triangle', symbolSize: 10,
    }));
    return cartesianOption({
        colors,
        grid: plotMargin(),
        title: title ? { text: title, left: 0, top: 2, textStyle: { color: colors.text, fontSize: 11, fontWeight: 'normal' } } : undefined,
        fileName: 'integral',
        tooltip: axisTooltip({ colors, valueSuffix: '%' }),
        legend: legendInsideLeft({ panel: colors.panel, border: colors.grid }, { color: colors.text }),
        xAxis: valueAxis({
            name: 'λ (nm)', color: colors.text, gridColor: colors.grid,
            min: lambdaLow, max: lambdaHigh, interval: 50, formatter: wavelengthLabel,
        }),
        yAxis: valueAxis({
            name: '%', color: colors.text, gridColor: colors.grid,
            min: 0, max: 100, interval: 10,
        }),
        series,
    });
}
