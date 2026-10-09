/**
 * ECharts options for the two views of the Pulse Analysis window.
 *
 * Time: the Fourier-limited pulse, the chirped input when it differs from it,
 * and the output, all on one intensity scale with the Fourier-limited peak at
 * 1. The output sits at its absolute delay or, with the delay removed, over the
 * input so the shapes compare directly.
 *
 * Spectrum: the input and output spectral intensities against wavelength, with
 * the response's GDD over all bounces on a second axis, and beside it the GDD
 * that would undo the input's own chirp. Where those two lie on each other
 * across the spectrum, the pulse comes out compressed. The GDD axis takes the
 * range the GD/GDD window would give the same curves, so the spikes at
 * reflection minima, where almost no light is left, do not flatten the rest.
 */

import {
    axisTooltip, cartesianOption, dimmedBandSeries, lineSeries, valueAxis,
} from '../../../ui/chartOptions.js';
import { chartTools, legendAbove, plotMargin } from '../chrome/plot.js';
import { autoYRange } from '../gdGddEvaluation/viewModel.js';

function timeOption({ view, timeAxis, labels, colors, curveColors }) {
    const shift = timeAxis === 'removed' ? view.metrics.delayFs : 0;
    const series = [
        lineSeries({ x: view.time.flp.x, y: view.time.flp.y, name: labels.flp, color: curveColors.flp, width: 2 }),
        ...(view.chirped
            ? [lineSeries({
                x: view.time.input.x, y: view.time.input.y, name: labels.input,
                color: curveColors.input, width: 1.5, dash: 'dashed',
            })]
            : []),
        lineSeries({
            x: view.time.output.x.map(time => time - shift), y: view.time.output.y,
            name: labels.output, color: curveColors.output, width: 2,
        }),
    ];
    return cartesianOption({
        colors,
        grid: plotMargin(),
        legend: legendAbove({ color: colors.text }),
        tooltip: axisTooltip({ colors }),
        toolbox: chartTools('pulse'),
        xAxis: valueAxis({ name: labels.timeAxis, color: colors.text, gridColor: colors.grid, scale: true }),
        yAxis: valueAxis({ name: labels.intensityAxis, color: colors.text, gridColor: colors.grid, min: 0 }),
        series,
    });
}

/**
 * Range of the GDD axis for the curves the spectrum view draws, with how many
 * of their samples fall outside it; null when there is nothing to range.
 */
export function gddAxisRange(view) {
    const { spectrum } = view;
    const values = [...spectrum.coatingGddFs2.y, ...(view.chirped ? spectrum.compensatingGddFs2.y : [])];
    return autoYRange({ y: values });
}

function spectrumOption({ view, labels, colors, curveColors, materialBands }) {
    const { spectrum } = view;
    const series = [
        lineSeries({ ...spectrum.input, name: labels.inputSpectrum, color: curveColors.flp, width: 2 }),
        lineSeries({ ...spectrum.output, name: labels.outputSpectrum, color: curveColors.output, width: 2 }),
        lineSeries({
            ...spectrum.coatingGddFs2, name: labels.coatingGdd,
            color: curveColors.gdd, width: 1.5, yAxisIndex: 1,
        }),
        ...(view.chirped
            ? [lineSeries({
                ...spectrum.compensatingGddFs2, name: labels.compensatingGdd,
                color: curveColors.input, width: 1.5, dash: 'dashed', yAxisIndex: 1,
            })]
            : []),
        ...dimmedBandSeries(materialBands, colors),
    ];
    const gdd = gddAxisRange(view);
    return cartesianOption({
        colors,
        grid: plotMargin({ rightAxis: true }),
        legend: legendAbove({ color: colors.text }),
        tooltip: axisTooltip({ colors }),
        toolbox: chartTools('pulse-spectrum'),
        xAxis: valueAxis({ name: labels.wavelengthAxis, color: colors.text, gridColor: colors.grid, scale: true, wavelength: true }),
        yAxis: [
            valueAxis({ name: labels.spectralAxis, color: colors.text, gridColor: colors.grid, min: 0 }),
            valueAxis({
                name: labels.gddAxis, color: colors.text, gridColor: colors.grid,
                position: 'right', splitLine: false, scale: true,
                ...(gdd ? { min: gdd.range[0], max: gdd.range[1], interval: gdd.interval } : {}),
            }),
        ],
        series,
    });
}

/**
 * @param {object} options
 *   view          the worker's result (pulseModel.js)
 *   mode          'time' | 'spectrum'
 *   timeAxis      'removed' | 'absolute'
 *   labels        axis and series names
 *   colors        theme colours
 *   curveColors   the window's configured curve colours
 *   materialBands shaded wavelength bands outside a material's data
 */
export function buildPulseChartOption(options) {
    return options.mode === 'spectrum' ? spectrumOption(options) : timeOption(options);
}
