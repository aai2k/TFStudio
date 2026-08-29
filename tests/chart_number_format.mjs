import assert from 'node:assert/strict';
import {
    axisTooltip, formatChartNumber, formatChartReadout, formatPercentReadout, itemTooltip,
} from '../src/components/ui/chartOptions.js';

// Axis ticks stay compact, but non-zero logarithmic decades must stay distinct.
assert.equal(formatChartNumber(0), '0');
assert.equal(formatChartNumber(1e-6), '1e-6');
assert.equal(formatChartNumber(2.5e-5), '2.5e-5');

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
            xAxis: valueAxis({ name: 'Wavelength (nm)' }),
            yAxis: valueAxis({ name: 'y' }),
            series: [{ type: 'line', data }],
        }).xAxis;
    };
    const ticks = (low, high) => (high - low) / axisFor(low, high).interval;

    assert.equal(axisFor(400, 700).interval, 50, 'a visible spectrum keeps its 50 nm ticks');
    assert.equal(axisFor(319.84, 850.03).interval, 50, 'so does a full ellipsometer sweep');
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

console.log('Chart number formatting passed.');
