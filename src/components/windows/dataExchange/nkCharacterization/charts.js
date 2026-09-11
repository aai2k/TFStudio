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
        xAxis: valueAxis({ name: labels.lambdaAxis, color: palette.text, gridColor: palette.grid }),
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

// T and R are held as fractions and drawn as percent. Ψ and Δ are already in
// degrees and are drawn as they come.
const CURVE_SCALE = { T: 100, R: 100, PSI: 1, DEL: 1 };

// Drawing order, so a plot reads the same whichever channels a measurement has.
const FIT_CHANNELS = ['T', 'R', 'PSI', 'DEL'];

/** One channel measured, against the model's recalculation of it. */
function comparisonSeries({ result, quantity, labels }) {
    const label = CURVE_LABEL[quantity];
    const scale = CURVE_SCALE[quantity];
    // Δ runs to 360° where Ψ stops at 90°, so Δ is read against the right axis.
    const yAxisIndex = quantity === 'DEL' ? 1 : 0;
    return [
        lineSeries({
            x: result.lambdas, y: result.measured[quantity].map(value => value * scale),
            name: `${label} ${labels.measured}`, color: MEASURED_COLOR[quantity],
            width: 2, yAxisIndex,
        }),
        lineSeries({
            x: result.lambdas, y: result.calculated[quantity].map(value => value * scale),
            name: `${label} ${labels.calculated}`, color: CALCULATED_COLOR,
            width: 1.4, dash: 'dash', yAxisIndex,
        }),
    ];
}

/** One channel as calculated minus measured, in that channel's own unit. */
function residualSeries({ result, quantity }) {
    const scale = CURVE_SCALE[quantity];
    return [lineSeries({
        x: result.lambdas,
        y: result.calculated[quantity].map(
            (value, point) => channelDifference(
                quantity, value, result.measured[quantity][point]) * scale),
        name: CURVE_LABEL[quantity], color: MEASURED_COLOR[quantity], width: 1.6,
    })];
}

function fitSeries({ result, labels, residual }) {
    const build = residual ? residualSeries : comparisonSeries;
    const series = [];
    for (const quantity of FIT_CHANNELS) {
        if (!result.measured[quantity]) continue;
        series.push(...build({ result, quantity, labels }));
    }
    return series;
}

// The y axes each kind of measurement is read against. Ψ and Δ have separate
// fixed ranges in degrees and take an axis each; T and R share one percent axis
// over the full 0 to 100. A residual is a difference in the same unit as the
// channel it came from, and is scaled to whatever it turns out to be.
const FIT_AXIS = {
    ellipsometry: {
        fit: ({ palette }) => [
            valueAxis({
                name: 'Ψ (°)', color: MEASURED_COLOR.PSI, gridColor: palette.grid,
                min: 0, max: 90, interval: 10,
            }),
            valueAxis({
                name: 'Δ (°)', color: MEASURED_COLOR.DEL, gridColor: palette.grid,
                min: 0, max: 360, position: 'right', splitLine: false,
            }),
        ],
        residual: ({ palette, labels }) => valueAxis({
            name: labels.residualAxisDegrees,
            color: palette.text, gridColor: palette.grid, scale: true,
        }),
    },
    photometry: {
        fit: ({ palette }) => valueAxis({
            name: '%', color: palette.text, gridColor: palette.grid,
            min: 0, max: 100, interval: 10,
        }),
        residual: ({ palette, labels }) => valueAxis({
            name: labels.residualAxis,
            color: palette.text, gridColor: palette.grid, scale: true,
        }),
    },
};

export function buildFitOption(result, palette, labels, residual) {
    const ellipsometry = Array.isArray(result.measured.PSI) || Array.isArray(result.measured.DEL);
    const axes = FIT_AXIS[ellipsometry ? 'ellipsometry' : 'photometry'];
    return cartesianOption({
        colors: palette,
        grid: plotMargin(),
        fileName: residual ? 'characterization-residual' : 'characterization-fit',
        legend: legendAbove({ color: palette.text }),
        tooltip: axisTooltip({ colors: palette, valueSuffix: ellipsometry ? '°' : '%' }),
        xAxis: valueAxis({ name: labels.lambdaAxis, color: palette.text, gridColor: palette.grid }),
        yAxis: (residual ? axes.residual : axes.fit)({ palette, labels }),
        series: fitSeries({ result, labels, residual }),
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
