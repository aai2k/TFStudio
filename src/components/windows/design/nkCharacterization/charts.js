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

const { createElement: h, useEffect, useRef } = React;

const INDEX_COLOR = '#4fc3f7';
const EXTINCTION_COLOR = '#ff8a65';
const MEASURED_COLOR = { T: '#2196f3', R: '#ef5350' };
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

export function buildFitOption(result, palette, labels, residual) {
    // Both views are in percentage points, so a residual reads against the same
    // scale as the curves it came from.
    const scale = 100;
    const series = [];
    for (const quantity of ['T', 'R']) {
        if (!result.measured[quantity]) continue;
        if (residual) {
            series.push(lineSeries({
                x: result.lambdas,
                y: result.calculated[quantity].map(
                    (value, point) => (value - result.measured[quantity][point]) * scale),
                name: quantity, color: MEASURED_COLOR[quantity], width: 1.6,
            }));
            continue;
        }
        series.push(lineSeries({
            x: result.lambdas, y: result.measured[quantity].map(value => value * scale),
            name: `${quantity} ${labels.measured}`, color: MEASURED_COLOR[quantity], width: 2,
        }));
        const calculated = lineSeries({
            x: result.lambdas, y: result.calculated[quantity].map(value => value * scale),
            name: `${quantity} ${labels.calculated}`, color: CALCULATED_COLOR,
            width: 1.4, dash: 'dash',
        });
        series.push(calculated);
    }
    return cartesianOption({
        colors: palette,
        grid: plotMargin(),
        fileName: residual ? 'characterization-residual' : 'characterization-fit',
        legend: legendAbove({ color: palette.text }),
        tooltip: axisTooltip({ colors: palette, valueSuffix: '%' }),
        xAxis: valueAxis({ name: 'λ (nm)', color: palette.text, gridColor: palette.grid }),
        yAxis: valueAxis({
            name: residual ? labels.residualAxis : '%',
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
