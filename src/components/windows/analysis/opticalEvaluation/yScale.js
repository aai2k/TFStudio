/**
 * Display-unit conversion for the spectrum plot's vertical axis.
 *
 * T, R and A are computed as fractions of the incident flux. The plot draws
 * them as percentages, and so do the merit targets and the target editor, so
 * the plotted coordinates stay on that scale whichever unit is on screen:
 * choosing 0-1 relabels the same positions. The results table and the CSV read
 * the fractions directly and scale them once.
 */

import { formatChartNumber, formatPercentReadout } from '../../../ui/chartOptions.js';

const SCALES = {
    percent: {
        id: 'percent', short: '%', suffix: '%',
        fromPercent: value => value,
        toPercent: value => value,
        fromFraction: value => value * 100,
        rangeStep: 5, rangeDecimals: 2,
        tableDecimals: 4, csvDecimals: 6, readoutDecimals: 3,
    },
    fraction: {
        id: 'fraction', short: '0-1', suffix: '',
        fromPercent: value => value / 100,
        toPercent: value => value * 100,
        fromFraction: value => value,
        // Two more places than the percentage form, so the same digits survive.
        rangeStep: 0.05, rangeDecimals: 4,
        tableDecimals: 6, csvDecimals: 8, readoutDecimals: 5,
    },
};

export const Y_SCALE_IDS = ['percent', 'fraction'];

export function yScaleOf(id) { return SCALES[id] || SCALES.percent; }

/** Native ECharts value-axis fields; plotted coordinates remain percentages. */
export function yScaleAxisOption(id) {
    const scale = yScaleOf(id);
    return {
        name: scale.short,
        formatter: value => formatChartNumber(scale.fromPercent(value)),
    };
}

/** One results-table cell, from the computed fraction behind it. */
export function formatYCell(id, value) {
    const scale = yScaleOf(id);
    return scale.fromFraction(value).toFixed(scale.tableDecimals);
}

/** Hover and crosshair readout fields for the plotted percentages. */
export function yScaleTooltip(id) {
    const scale = yScaleOf(id);
    return {
        valueSuffix: scale.suffix,
        formatValue: value => formatPercentReadout(scale.fromPercent(value), scale.readoutDecimals),
    };
}

/**
 * The vertical-range fields in the chosen unit. The bounds are entered and
 * shown converted; what the window stores stays in percent, as the axis is.
 */
export function yRangeControl(id, percentMin, percentMax, bounds) {
    const scale = yScaleOf(id);
    const show = value => Number(scale.fromPercent(value).toFixed(scale.rangeDecimals));
    return {
        start: show(percentMin),
        end: show(percentMax),
        min: show(bounds.min),
        max: show(bounds.max),
        step: scale.rangeStep,
        toPercent: value => Number(scale.toPercent(value).toFixed(6)),
    };
}
