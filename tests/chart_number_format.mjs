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

console.log('Chart number formatting passed.');
