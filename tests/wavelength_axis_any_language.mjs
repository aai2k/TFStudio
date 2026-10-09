/**
 * A wavelength axis spans the range computed, on 50 nm ticks, in every language.
 *
 * The window drawing a plot knows whether its x axis is wavelength in nm; the
 * axis title does not, because it is translated. "Длина волны (нм)" and
 * "波长 (nm)" are wavelength axes as much as "Wavelength (nm)" is, and a depth
 * axis whose title quotes "λ₀ = 550 nm" is not one.
 *
 * Run: node tests/wavelength_axis_any_language.mjs
 */
import assert from 'node:assert/strict';
import { getLocale } from '../src/constants/locales/index.js';
import { cartesianOption, valueAxis } from '../src/components/ui/chartOptions.js';
import { buildGDChartOption } from '../src/components/windows/analysis/gdGddEvaluation/chartModel.js';
import { buildSpectrumOption } from '../src/components/windows/analysis/systematicDeviations/spectrumFigure.js';

const LOCALES = ['en', 'ru', 'zh', 'it'];
const colors = { text: '#cccccc', grid: '#3a3a3a', background: '#1e1e1e', paper: '#252526' };
const c = { text: '#cccccc', border: '#3a3a3a', bg: '#1e1e1e', panel: '#252526' };
const grid = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

// GD/GDD of a chirped mirror computed over 720-930 nm.
{
    const lambda = grid(720, 930);
    for (const code of LOCALES) {
        const axis = buildGDChartOption({
            data: { lambda, y: lambda.map(value => value - 800) },
            meta: { label: 'GDD', unit: 'fs²', color: '#4fc3f7' },
            colors, xLabel: getLocale(code).spectralAxis.nm,
        }).xAxis;
        assert.deepEqual([axis.min, axis.max], [720, 930],
            `${code}: the GD/GDD axis spans the computed 720-930 nm, got ${axis.min}-${axis.max}`);
        assert.deepEqual([axis.minInterval, axis.maxInterval], [50, 50],
            `${code}: the GD/GDD axis keeps its 50 nm ticks`);
        assert.equal(axis.wavelength, undefined, `${code}: the wavelength mark is not passed on to ECharts`);
    }
}

// Systematic Deviations over 470-660 nm, titled the short way, λ (nm).
{
    const lambda = grid(470, 660);
    const spectrum = { lambda, T: lambda.map(() => 0.9), R: lambda.map(() => 0.1) };
    for (const code of LOCALES) {
        const axis = buildSpectrumOption(spectrum, spectrum, {
            channel: 'T', showBaseline: true, colors: { T: '#4fc3f7', R: '#ef5350' }, c,
            lambdaAxis: getLocale(code).spectralAxis.lambdaShort,
        }).xAxis;
        assert.deepEqual([axis.min, axis.max], [470, 660],
            `${code}: the spectrum axis spans the computed 470-660 nm, got ${axis.min}-${axis.max}`);
    }
}

// An E-field depth axis read in optical thickness quotes λ₀ in its title. It is
// a depth, so it is not given the wavelength range or the 50 nm ticks.
{
    const depth = grid(0, 1200);
    const axis = cartesianOption({
        xAxis: valueAxis({ name: getLocale('en').eField.xAxisOptical('OT', 550), min: 0, max: 1200 }),
        yAxis: valueAxis({ name: '%' }),
        series: [{ type: 'line', data: depth.map(value => [value, 1]) }],
    }).xAxis;
    assert.deepEqual([axis.interval, axis.minInterval, axis.maxInterval], [undefined, undefined, undefined],
        'a depth axis is not ticked as a wavelength axis');
}

console.log('wavelength_axis_any_language passed.');
