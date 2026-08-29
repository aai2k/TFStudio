/**
 * The two plots a characterization is read from.
 *
 * The constants plot carries both the fitted model and the wavelength-by-
 * wavelength extraction it was fitted to. Showing only the model would hide
 * where the extraction was ill-conditioned, and showing only the points would
 * hide that the model smooths them; the pair is what tells you whether the
 * model belongs to the film.
 *
 * The fit plot is the check Macleod asks for directly: "It is always worthwhile
 * to attempt to recalculate the measurements using the model and extracted
 * parameters to see where deficiencies might lie."
 */

import {
    axisTooltip, cartesianOption, lineSeries, scatterSeries, valueAxis,
} from '../../../ui/chartOptions.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { legendAbove, plotMargin } from '../../analysis/chrome/plot.js';
import { evaluateDispersionFit } from '../../../../utils/materials/dispersionFits.js';
import { channelDifference } from '../../../../utils/materials/characterization/sampleSpectrum.js';

const { createElement: h, useEffect, useRef } = React;

const INDEX_COLOR = '#4fc3f7';
const EXTINCTION_COLOR = '#ff8a65';
const MEASURED_COLOR = {
    T: '#2196f3', R: '#ef5350', PSI: '#4fc3f7', DEL: '#ff8a65',
};
const CALCULATED_COLOR = '#ffd54f';

const MODEL_POINTS = 300;

export function paletteFrom(c) {
    return {
        background: c.bg || '#1e1e1e', paper: c.panel || '#252526',
        grid: c.border || '#3a3a3a', text: c.text || '#cccccc',
    };
}

function modelCurve(fit) {
    const [low, high] = fit.rangeNm;
    const lambda = [];
    const index = [];
    const extinction = [];
    for (let point = 0; point <= MODEL_POINTS; point++) {
        const value = low + ((high - low) * point) / MODEL_POINTS;
        const [n, k] = evaluateDispersionFit(fit, value);
        lambda.push(value);
        index.push(n);
        extinction.push(Math.max(0, k));
    }
    return { lambda, index, extinction };
}

/** Only the wavelengths the pointwise solve actually resolved. */
function resolvedPoints(pointwise, key) {
    const points = [];
    for (let index = 0; index < pointwise.lambdas.length; index++) {
        if (!pointwise.resolved[index]) continue;
        points.push([pointwise.lambdas[index], pointwise[key][index]]);
    }
    return points;
}

export function buildConstantsOption(result, palette, labels, showPointwise) {
    const model = modelCurve(result.fit);
    // A second axis appears only when there is an absorption worth one. The
    // wavelength-by-wavelength solve leaves a scatter of k around zero on a
    // transparent film; below what the measurement could resolve, that is the
    // instrument and not the film, and giving it an axis makes it look like data.
    const absorbing = model.extinction.some(
        value => value > result.diagnostics.resolvableExtinction)
        || result.pointwise.k.some((value, index) => result.pointwise.resolved[index]
            && value > result.diagnostics.resolvableExtinction);
    const series = [
        lineSeries({
            x: model.lambda, y: model.index, name: 'n',
            color: INDEX_COLOR, width: 2, yAxisIndex: 0,
        }),
        absorbing && lineSeries({
            x: model.lambda, y: model.extinction, name: 'k',
            color: EXTINCTION_COLOR, width: 2, yAxisIndex: 1,
        }),
        showPointwise && scatterSeries({
            data: resolvedPoints(result.pointwise, 'n'), name: labels.pointwiseIndex,
            color: INDEX_COLOR, symbolSize: 4, yAxisIndex: 0,
        }),
        showPointwise && absorbing && result.pointwise.solvedExtinction && scatterSeries({
            data: resolvedPoints(result.pointwise, 'k'), name: labels.pointwiseExtinction,
            color: EXTINCTION_COLOR, symbolSize: 4, yAxisIndex: 1,
        }),
    ].filter(Boolean);

    return cartesianOption({
        colors: palette,
        grid: plotMargin({ rightAxis: absorbing }),
        fileName: 'film-constants',
        legend: legendAbove({ color: palette.text }),
        tooltip: axisTooltip({ colors: palette }),
        xAxis: valueAxis({ name: 'λ (nm)', color: palette.text, gridColor: palette.grid }),
        yAxis: [
            valueAxis({
                name: 'n', color: INDEX_COLOR, gridColor: palette.grid,
                position: 'left', scale: true,
            }),
            {
                ...valueAxis({
                    name: 'k', color: EXTINCTION_COLOR, gridColor: palette.grid,
                    position: 'right', splitLine: false, min: 0, scale: true,
                }),
                show: absorbing,
            },
        ],
        series,
    });
}

// The ellipsometric pair is written with its own symbols everywhere else in the
// window, so the legend uses them too rather than the internal channel names.
const CURVE_LABEL = { T: 'T', R: 'R', PSI: 'Ψ', DEL: 'Δ' };

export function buildFitOption(result, palette, labels, residual) {
    const ellipsometry = Array.isArray(result.measured.PSI) || Array.isArray(result.measured.DEL);
    const series = [];
    for (const quantity of ['T', 'R', 'PSI', 'DEL']) {
        if (!result.measured[quantity]) continue;
        const label = CURVE_LABEL[quantity];
        const scale = quantity === 'T' || quantity === 'R' ? 100 : 1;
        const yAxisIndex = !residual && quantity === 'DEL' ? 1 : 0;
        if (residual) {
            series.push(lineSeries({
                x: result.lambdas,
                y: result.calculated[quantity].map(
                    (value, point) => channelDifference(
                        quantity, value, result.measured[quantity][point]) * scale),
                name: label, color: MEASURED_COLOR[quantity], width: 1.6,
            }));
            continue;
        }
        series.push(lineSeries({
            x: result.lambdas, y: result.measured[quantity].map(value => value * scale),
            name: `${label} ${labels.measured}`, color: MEASURED_COLOR[quantity],
            width: 2, yAxisIndex,
        }));
        const calculated = lineSeries({
            x: result.lambdas, y: result.calculated[quantity].map(value => value * scale),
            name: `${label} ${labels.calculated}`, color: CALCULATED_COLOR,
            width: 1.4, dash: 'dash', yAxisIndex,
        });
        series.push(calculated);
    }
    return cartesianOption({
        colors: palette,
        grid: plotMargin(),
        fileName: residual ? 'characterization-residual' : 'characterization-fit',
        legend: legendAbove({ color: palette.text }),
        tooltip: axisTooltip({ colors: palette, valueSuffix: ellipsometry ? '°' : '%' }),
        xAxis: valueAxis({ name: 'λ (nm)', color: palette.text, gridColor: palette.grid }),
        yAxis: ellipsometry && !residual ? [
            valueAxis({
                name: 'Ψ (°)', color: MEASURED_COLOR.PSI, gridColor: palette.grid,
                min: 0, max: 90, interval: 10,
            }),
            valueAxis({
                name: 'Δ (°)', color: MEASURED_COLOR.DEL, gridColor: palette.grid,
                min: 0, max: 360, position: 'right', splitLine: false,
            }),
        ] : valueAxis({
            name: residual
                ? (ellipsometry ? labels.residualAxisDegrees : labels.residualAxis)
                : '%',
            color: palette.text, gridColor: palette.grid,
            ...(residual ? { scale: true } : { min: 0, max: 100, interval: 10 }),
        }),
        series,
    });
}

export function CharacterizationChart({ result, view, showPointwise, labels, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    useEffect(() => {
        const palette = paletteFrom(c);
        drawChart(divRef.current, chartRef, view === 'constants'
            ? buildConstantsOption(result, palette, labels, showPointwise)
            : buildFitOption(result, palette, labels, view === 'residual'));
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
