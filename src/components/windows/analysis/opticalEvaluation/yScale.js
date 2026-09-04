/**
 * Display-unit conversion for the spectrum plot's vertical axis.
 *
 * T, R and A are computed as fractions of the incident flux. The plot draws
 * them as percentages, and so do the merit targets and the target editor, so
 * the plotted coordinates stay on that scale whichever unit is on screen:
 * choosing 0-1 relabels the same positions. dB and OD are logarithmic readings
 * of those same percentages, so they are drawn as a logarithmic axis over the
 * same coordinates and a target keeps the level it was given. The results table
 * and the CSV read the fractions directly and scale them once.
 *
 * The two logarithmic units follow H. A. Macleod, Thin-Film Optical Filters,
 * 5th ed.:
 *   dB   T(dB) = 10 log₁₀ T, Equation 8.6, a loss reading negative.
 *   OD   D = −log₁₀ T, Chapter 5, Neutral-Density Filters.
 * They differ only by a factor: 10 dB of loss is one unit of density.
 */

import {
    formatChartNumber, formatChartReadout, formatPercentReadout, niceAxisBounds,
} from '../../../ui/chartOptions.js';

// `csvSuffix` names the unit in an exported column, so a file read later is not
// taken for percentages. The two linear forms keep the bare names they have
// always had.
const SCALES = {
    percent: {
        id: 'percent', short: '%', suffix: '%', csvSuffix: '',
        fromPercent: value => value,
        toPercent: value => value,
        fromFraction: value => value * 100,
        rangeStep: 5, rangeDecimals: 2,
        tableDecimals: 4, csvDecimals: 6, readoutDecimals: 3,
    },
    fraction: {
        id: 'fraction', short: '0-1', suffix: '', csvSuffix: '',
        fromPercent: value => value / 100,
        toPercent: value => value * 100,
        fromFraction: value => value,
        // Two more places than the percentage form, so the same digits survive.
        rangeStep: 0.05, rangeDecimals: 4,
        tableDecimals: 6, csvDecimals: 8, readoutDecimals: 5,
    },
    dB: {
        id: 'dB', short: 'dB', suffix: ' dB', csvSuffix: '_dB', log: true,
        fromPercent: value => 10 * Math.log10(value / 100),
        toPercent: value => 100 * 10 ** (value / 10),
        fromFraction: value => 10 * Math.log10(value),
        // A decade of transmittance is 10 dB, so a step of 5 is half a decade.
        // A unit of density is ten decibels, so one place fewer than the density
        // form below reads to the same precision.
        decadesPerUnit: 0.1,
        rangeStep: 5, rangeDecimals: 2,
        tableDecimals: 3, csvDecimals: 4, readoutDecimals: 2,
    },
    OD: {
        id: 'OD', short: 'OD', suffix: '', csvSuffix: '_OD', log: true, transmittanceOnly: true,
        decadesPerUnit: 1,
        fromPercent: value => -Math.log10(value / 100),
        toPercent: value => 100 * 10 ** -value,
        fromFraction: value => -Math.log10(value),
        rangeStep: 0.5, rangeDecimals: 3,
        tableDecimals: 4, csvDecimals: 5, readoutDecimals: 3,
    },
};

export const Y_SCALE_IDS = ['percent', 'fraction', 'dB', 'OD'];

export function yScaleOf(id) { return SCALES[id] || SCALES.percent; }

/** Whether this unit reads the axis logarithmically, so zero has no position. */
export function isLogYScale(id) { return !!yScaleOf(id).log; }

/**
 * Whether a unit can read a given quantity at all.
 *
 * The decibel is a unit rather than a quantity: ten times the log of a ratio of
 * two power levels. T, R and A are each a fraction of the incident flux, so
 * each has a reading in it, all three say the same thing on the axis and say it
 * in the same direction, and they can share one. Absorptance is the curve that
 * gains most by it, a loss of ten parts per million being nothing at all on a
 * percentage axis and a legible −50 dB here.
 *
 * Optical density is a quantity of its own, D = −log₁₀ T (Macleod, Chapter 5),
 * defined from the incident irradiance against the transmitted one. The name is
 * already spoken for, so there is no density of a reflectance to quote, and a
 * density of an absorptance turns the meaning around: A of 1e-5 would read as
 * density 5, which sounds like heavy blocking and is almost no absorption at
 * all. Macleod warns against that same confusion where he defines it.
 */
export function yScaleReadsQuantity(id, quantity) {
    return !yScaleOf(id).transmittanceOnly || !!quantity?.startsWith('T');
}

// A logarithmic axis has no zero, so the bottom of the vertical range needs a
// positive floor. It sits at OD 12, that is −120 dB, and holds the range fields
// and the automatic span alike. No coating is specified to block deeper than
// that, while a thick metal layer transmits far less, and left unfloored its
// transmittance would pull the axis down by hundreds of decibels and leave the
// reflectance in a sliver at the top of the plot.
const LOG_FLOOR_PERCENT = 1e-10;

// A flat curve has no span to rule. It is given a tenth of a decade each way,
// which is one decibel or a tenth of a density unit.
const FLAT_SPAN_DECADES = 0.1;

/**
 * Tick spacing and labels for a logarithmic axis over the given percentages.
 *
 * Left alone, such an axis rules its lines at decades. That is exactly right
 * for a blocking band spanning six of them, and useless for an antireflection
 * coating living inside a twentieth of one: two lines, with every curve crushed
 * between them. The span is measured in the unit's own numbers and given a
 * readable interval there, which is handed back as the fraction of a decade
 * ECharts asks for. Labels carry as many digits as the spacing needs, so a
 * ruling in thousandths of a density reads as such, and a tick that sits off
 * the round grid, as they do once the axis is zoomed, still reads true.
 */
function logRuling(scale, percentLow, percentHigh) {
    const a = scale.fromPercent(percentLow);
    const b = scale.fromPercent(percentHigh);
    let low = Math.min(a, b);
    let high = Math.max(a, b);
    if (low === high) {
        const pad = FLAT_SPAN_DECADES / scale.decadesPerUnit;
        low -= pad;
        high += pad;
    }
    const nice = niceAxisBounds(low, high, { targetTicks: 8 });
    if (!nice) return null;
    const digits = unit => Math.max(1, Math.ceil(Math.log10(Math.abs(unit) / nice.interval)) + 2);
    return {
        ends: [scale.toPercent(nice.min), scale.toPercent(nice.max)],
        interval: nice.interval * scale.decadesPerUnit,
        formatter: value => {
            const unit = scale.fromPercent(value);
            return formatChartReadout(unit, digits(unit));
        },
    };
}

/**
 * Bounds, tick spacing and labels for a logarithmic axis, in the percentages
 * it plots.
 *
 * `held` carries the ends the operator has typed, either of which may be
 * missing. A missing end is read from `extent`, the percentages actually
 * drawn, rounded outward onto the tick grid and kept above the floor. A typed
 * end keeps its own value and takes only the ruling.
 */
function logAxisSpan(scale, held, extent) {
    const typedLow = held?.[0];
    const typedHigh = held?.[1];
    const high = typedHigh ?? extent?.[1];
    const low = typedLow ?? (extent
        ? Math.max(Math.min(extent[0], high), LOG_FLOOR_PERCENT)
        : undefined);
    if (!(low > 0) || !(high > 0)) return {};
    const ruling = logRuling(scale, low, high);
    if (!ruling) return {};
    return {
        min: typedLow ?? Math.min(...ruling.ends),
        max: typedHigh ?? Math.max(...ruling.ends),
        interval: ruling.interval,
        formatter: ruling.formatter,
    };
}

/**
 * Native ECharts value-axis fields; plotted coordinates remain percentages.
 *
 * The stored range is in percent and opens at zero, which a logarithmic axis
 * has no position for. That end then comes from the percentages actually
 * drawn, while the top keeps the value in the field.
 */
export function yScaleAxisOption(id, yRange, extent) {
    const scale = yScaleOf(id);
    const auto = !!yRange?.auto;
    const percentMin = yRange?.min ?? 0;
    const percentMax = yRange?.max ?? 100;
    const common = {
        name: scale.short,
        type: scale.log ? 'log' : 'value',
        formatter: value => formatChartNumber(scale.fromPercent(value)),
    };
    if (!scale.log) return {
        ...common,
        min: auto ? undefined : percentMin,
        max: auto ? undefined : percentMax,
        scale: auto,
    };
    const held = auto ? null : [percentMin > 0 ? percentMin : undefined, percentMax];
    // A logarithmic axis always fits itself to the values it is given.
    return { ...common, scale: true, ...logAxisSpan(scale, held, extent) };
}

/**
 * Tick spacing and labels for the part of a logarithmic axis that is in view.
 *
 * ECharts keeps the spacing it was given when the axis is zoomed, so a box
 * drawn inside one decade of a ruling chosen for six would be left with the two
 * labels at its edges. The chart reads its visible span back through the axes
 * after each zoom and rules it afresh with this.
 */
export function logAxisZoomTicks(id, percentLow, percentHigh) {
    const scale = yScaleOf(id);
    if (!scale.log || !(percentLow > 0) || !(percentHigh > 0)) return null;
    const ruling = logRuling(scale, percentLow, percentHigh);
    return ruling && { interval: ruling.interval, axisLabel: { formatter: ruling.formatter } };
}

// Where an absorptance stops being a loss and starts being arithmetic.
//
// A is formed as 1 − R − T, a difference of numbers of order one, so a
// transparent stack does not leave zero behind: it leaves the residue of that
// subtraction, a small multiple of one ulp of unity and growing slowly with the
// number of layers. On a linear axis those samples sit on the zero line and
// cannot be seen. A logarithmic one would draw them as a curve near −150 dB and
// stretch itself down to reach it, pushing the coating's real behaviour into a
// sliver at the top of the plot. The floor is set two decades above one ulp so
// a long stack is covered, and is still far below any loss a coating is
// specified to. R and T come out of the layer algebra directly rather than from
// a cancellation, so they stay accurate however small they are and carry no
// floor of their own.
const ABSORPTANCE_RESOLUTION = 100 * Number.EPSILON;

/**
 * Fraction to the coordinate the plot places it at, in percent.
 *
 * A logarithmic axis has nowhere to put zero, so a sample that reaches it is
 * dropped rather than pinned to the axis floor, which would draw a curve where
 * the coating has none. `quantity` is the curve's own letter, which decides
 * whether the value has a resolution floor beneath it.
 */
export function plotPercent(id, quantity) {
    if (!yScaleOf(id).log) return value => value * 100;
    const floor = quantity?.startsWith('A') ? ABSORPTANCE_RESOLUTION : 0;
    return value => (value > floor ? value * 100 : null);
}

// A logarithmic reading of zero is infinite, and of a negative round-off value
// it is nothing at all. Shown as what they are rather than as a number.
function formatLogSafe(value, decimals) {
    if (Number.isFinite(value)) return value.toFixed(decimals);
    if (value === Infinity) return '∞';
    return value === -Infinity ? '−∞' : '';
}

/** One results-table cell, from the computed fraction behind it. */
export function formatYCell(id, value) {
    const scale = yScaleOf(id);
    return formatLogSafe(scale.fromFraction(value), scale.tableDecimals);
}

/** One exported cell. A reading with no finite value is left empty. */
export function formatYExport(id, value) {
    const scale = yScaleOf(id);
    const shown = scale.fromFraction(value);
    return Number.isFinite(shown) ? shown.toFixed(scale.csvDecimals) : '';
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
 * Smallest percent separation the two range fields can still show as a gap.
 *
 * A linear axis holds them a percentage point apart. On a logarithmic one the
 * separation is a ratio rather than a difference, so it is taken as one unit in
 * the last place the fields print, converted back to percent at the level in
 * question: any closer and both ends read the same number.
 */
function minimumSpan(scale, percent) {
    if (!scale.log) return 1;
    const step = 10 ** -scale.rangeDecimals;
    const level = scale.fromPercent(percent);
    const span = Math.max(scale.toPercent(level - step), scale.toPercent(level + step)) - percent;
    // A range carried over from a linear axis can sit at or below zero, which
    // this unit cannot measure a separation at. The other end is then held only
    // to where it is, which the axis reads from the data anyway.
    return Number.isFinite(span) ? span : 0;
}

/**
 * The vertical-range fields in the chosen unit. The bounds are entered and
 * shown converted; what the window stores stays in percent, as the axis is.
 *
 * Density runs the other way to every other unit, so the field limits are
 * sorted rather than taken in the order the bounds are given. The clamps take
 * a value in the chosen unit and return the percent to store, keeping the two
 * ends from crossing and the bottom of a logarithmic axis positive.
 */
export function yRangeControl(id, percentMin, percentMax, bounds) {
    const scale = yScaleOf(id);
    const floor = scale.log ? Math.max(bounds.min, LOG_FLOOR_PERCENT) : bounds.min;
    const show = value => Number(scale.fromPercent(value).toFixed(scale.rangeDecimals));
    // Rounding clears the dust the conversion leaves behind. A fixed number of
    // decimals cannot do that across the decades a logarithmic axis spans, so
    // significant figures are counted there instead.
    const store = value => Number(scale.log ? value.toPrecision(12) : value.toFixed(6));
    const ends = [show(floor), show(bounds.max)];
    // A range carried over from a linear axis can start at or below zero, which
    // a logarithmic unit has no reading for. The field shows its own limit
    // until a value is entered, rather than nothing at all.
    const field = (percent, limit) => (Number.isFinite(show(percent)) ? show(percent) : limit);
    return {
        start: field(percentMin, ends[0]),
        end: field(percentMax, ends[1]),
        min: Math.min(...ends),
        max: Math.max(...ends),
        step: scale.rangeStep,
        clampMin: value => Math.min(
            Math.max(store(scale.toPercent(value)), floor),
            percentMax - minimumSpan(scale, percentMax)),
        clampMax: value => Math.max(
            store(scale.toPercent(value)),
            percentMin + minimumSpan(scale, percentMin)),
    };
}
