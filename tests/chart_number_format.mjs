import assert from 'node:assert/strict';
import {
    axisTooltip, formatChartNumber, formatChartReadout, formatPercentReadout, itemTooltip,
} from '../src/components/ui/chartOptions.js';

// Axis ticks stay compact, but non-zero logarithmic decades must stay distinct.
assert.equal(formatChartNumber(0), '0');
assert.equal(formatChartNumber(1e-6), '1e-6');
assert.equal(formatChartNumber(2.5e-5), '2.5e-5');

// Neighbouring ticks of a narrow axis read apart: a glass's n over the visible,
// 0.005 apart, and air's, 5e-6 apart, which read 1.51, 1.51 and 1, 1. A tick
// carrying floating-point noise prints as the round number it is, and a long
// value, such as an axis end a zoom left between ticks, is still rounded.
{
    const ticks = (from, step, count) => Array.from({ length: count }, (_, i) => from + i * step);
    const glass = ticks(1.505, 0.005, 8).map(formatChartNumber);
    assert.deepEqual(glass, ['1.505', '1.51', '1.515', '1.52', '1.525', '1.53', '1.535', '1.54']);
    const air = ticks(1.000255, 0.000005, 8).map(formatChartNumber);
    assert.equal(new Set(air).size, air.length, `air's ticks read apart: ${air.join(' ')}`);
    assert.equal(formatChartNumber(0.1 + 0.2), '0.3');
    assert.equal(formatChartNumber(412.3456789012), '412.3');
    assert.equal(formatChartNumber(0.0123456789), '0.0123');
}

// Scientific readouts preserve meaningful values without long floating tails.
assert.equal(formatChartReadout(99.998), '99.998');
assert.equal(formatChartReadout(1.005), '1.005');
assert.equal(formatChartReadout(45.123456), '45.123');
assert.equal(formatChartReadout(2.5e-6), '2.5e-6');
assert.equal(formatChartReadout(123456), '1.2346e5');
assert.equal(formatPercentReadout(99.928), '99.928');
assert.equal(formatPercentReadout(0.071803), '0.072');
assert.equal(formatPercentReadout(100), '100.000');
assert.equal(formatPercentReadout(0.0004), '0.000');
assert.equal(axisTooltip({ valueSuffix: '%' }).valueFormatter(99.998), '99.998%');
assert.equal(axisTooltip({ valueSuffix: '%', formatValue: formatPercentReadout })
    .valueFormatter(0.071803), '0.072%');
assert.equal(axisTooltip().axisPointer.label.formatter({ value: 2.5e-6, axisDimension: 'y' }), '2.5e-6');
assert.equal(itemTooltip().valueFormatter(1.005), '1.005');

// ── A wavelength axis keeps ticks whatever it spans ──────────────────────────
//
// The axis is pinned to round 50 nm ticks, which is right for an optical
// spectrum and describes nothing outside one. Ten thousand ticks and no ticks
// look the same on screen: ECharts draws neither the labels nor the split
// lines, so the axis loses its grid. Both ends are reached by real data, one by
// re-reading a wavelength column as micrometres or photon energy, the other by
// an infrared spectrum.
{
    const { cartesianOption, valueAxis } = await import('../src/components/ui/chartOptions.js');
    const axisFor = (low, high) => {
        const points = 200;
        const data = Array.from({ length: points }, (_, index) => (
            [low + ((high - low) * index) / (points - 1), 1]));
        return cartesianOption({
            xAxis: valueAxis({ name: 'Wavelength (nm)', wavelength: true }),
            yAxis: valueAxis({ name: 'y' }),
            series: [{ type: 'line', data }],
        }).xAxis;
    };
    // The step is pinned as the least and the greatest interval at once.
    const step = (low, high) => {
        const axis = axisFor(low, high);
        assert.equal(axis.minInterval, axis.maxInterval, 'the wavelength step is pinned from both sides');
        return axis.minInterval;
    };
    const ticks = (low, high) => (high - low) / step(low, high);

    assert.equal(step(400, 700), 50, 'a visible spectrum keeps its 50 nm ticks');
    assert.equal(step(319.84, 850.03), 50, 'so does a full ellipsometer sweep');
    assert.deepEqual([axisFor(399, 800).min, axisFor(399, 800).max], [399, 800],
        'the axis spans the range computed, not the tick below its start');
    const declared = cartesianOption({
        xAxis: valueAxis({ name: 'Wavelength (nm)', min: 380, max: 780, wavelength: true }),
        yAxis: valueAxis({ name: 'y' }),
        series: [{ type: 'line', data: [[400, 1], [700, 1]] }],
    }).xAxis;
    assert.deepEqual([declared.min, declared.max], [380, 780], 'an axis with its own bounds keeps them');
    for (const [low, high, what] of [
        [319840, 850030, 'a wavelength column read as micrometres'],
        [1.459, 3.876, 'the same column read as photon energy'],
        [2000, 25000, 'an infrared spectrum'],
    ]) {
        const count = ticks(low, high);
        assert.ok(count >= 2 && count <= 40,
            `${what} must land on a readable number of ticks, got ${count.toFixed(1)}`);
    }
}

// The Integral Values overlay follows the same rule: 50 nm over a visible band,
// a wider step over a span where 50 nm would draw a hatch of gridlines, and
// ticks on round wavelengths when the band starts on an odd one. A fixed
// interval would be counted from the band's start, 382, 432, 482.
{
    const { buildOverlayOption } = await import(
        '../src/components/windows/analysis/integralValues/overlayFigure.js');
    const colors = { text: '#cccccc', grid: '#3a3a3a', panel: '#252526' };
    const overlayAxis = (low, high) => {
        const points = 101;
        const lambda = Array.from({ length: points }, (_, index) => (
            low + ((high - low) * index) / (points - 1)));
        const spectrum = { lambda, T: lambda.map(() => 0.5) };
        return buildOverlayOption({ spectrum, char: 'T', colors }).xAxis;
    };
    const overlayInterval = (low, high) => {
        const axis = overlayAxis(low, high);
        assert.equal(axis.interval, undefined, 'no interval counted from the band start');
        assert.equal(axis.minInterval, axis.maxInterval, 'the step is pinned from both sides');
        return axis.minInterval;
    };

    assert.equal(overlayInterval(400, 700), 50, 'a visible integration span keeps 50 nm ticks');
    assert.equal(overlayInterval(382, 782), 50, 'so does one that starts on an odd wavelength');
    assert.deepEqual([overlayAxis(382, 782).min, overlayAxis(382, 782).max], [382, 782], 'and the axis spans the band');
    const wide = overlayInterval(300, 5000);
    const count = (5000 - 300) / wide;
    assert.ok(count >= 2 && count <= 40,
        `a broadband integration span must stay readable, got ${count.toFixed(1)} ticks`);
}

console.log('Chart number formatting passed.');
