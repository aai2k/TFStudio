/**
 * The Plot Engine in 2D: one line per curve, the curve's x against its y as it
 * reads them along its sweep.
 *
 * Quantities in one unit share a y axis: the first on the left, any other on
 * the right, each one after the second further out. T, R and A are drawn in
 * percent on a 0 to 100 axis. The x axis is titled after the first visible
 * curve's x.
 */

import {
    SWEEP, isFraction, normalizeCurve, parseAxisVar, phaseMember, quantityFamily,
} from '../../../../../utils/physics/plotQuantities.js';
import { drawChart, useChartTeardown } from '../../../../ui/plotSurface.js';
import {
    axisTooltip, cartesianOption, itemTooltip, lineSeries, valueAxis,
} from '../../../../ui/chartOptions.js';
import { legendAbove, plotMargin } from '../../chrome/plot.js';
import {
    axisTitle, quantitySymbol, quantityUnit, sweepSymbol, sweepTitle, sweepUnit,
} from '../quantityLabels.js';

const { createElement: h, useEffect, useRef } = React;

// How far out each right-hand axis after the first is drawn, px: the room one
// axis takes with its labels and title, as plotMargin leaves for one.
const AXIS_SPACING = 58;

// The axis a quantity is drawn on. Quantities in one unit share an axis, except
// that a phase does not share with Ψ and Δ: an unwrapped phase runs to
// thousands of degrees and would flatten an ellipsometric angle against it.
function dimension(axis, sweep) {
    if (axis.quantity === SWEEP) return `sweep:${parseAxisVar(sweep).kind}`;
    return phaseMember(axis.quantity)?.member || quantityFamily(axis.quantity);
}

const scaled = (values, axis) => (isFraction(axis.quantity) ? Array.from(values, value => value * 100) : values);

// Δ runs over [0°, 360°), so where it wraps two neighbouring samples lie almost
// a full turn apart, and a line between them would cross the whole plot. Any
// step in Δ of more than half a turn is taken as a wrap.
const WRAP_STEP_DEG = 180;

/**
 * A curve's points with a gap wherever an axis reading Δ wraps: a point with
 * no value on that axis, halfway between its neighbours on the other, so a
 * reading along the other axis still finds its points in order.
 */
export function brokenAtWraps(x, y, curve) {
    const wraps = [curve.x, curve.y].map(axis => axis.quantity === 'delta');
    if (!wraps.includes(true)) return { x, y };
    const axes = [x, y];
    const wrapsAt = i => axes.some((values, axis) =>
        wraps[axis] && Math.abs(values[i] - values[i - 1]) > WRAP_STEP_DEG);
    const gapOn = (axis, i) => (wraps[axis] ? null : (axes[axis][i - 1] + axes[axis][i]) / 2);
    const out = { x: [], y: [] };
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
        if (i > 0 && wrapsAt(i)) {
            out.x.push(gapOn(0, i));
            out.y.push(gapOn(1, i));
        }
        out.x.push(x[i]);
        out.y.push(y[i]);
    }
    return out;
}

function axisParts(axis, sweep, design, t) {
    return axis.quantity === SWEEP
        ? { symbol: sweepSymbol(sweep, design, t), unit: sweepUnit(sweep, t) }
        : { symbol: quantitySymbol(axis.quantity, t), unit: quantityUnit(axis.quantity, t) };
}

const visibleCurves = curves => curves.map(normalizeCurve).filter(curve => curve.visible);

/** One line per visible curve that has a result, on the y axis of its unit. */
export function buildCurveSeries(curves, results) {
    const drawn = visibleCurves(curves);
    const axes = [...new Set(drawn.map(curve => dimension(curve.y, curve.sweep)))];
    return drawn
        .filter(curve => results[curve.id])
        .map(curve => lineSeries({
            ...brokenAtWraps(scaled(results[curve.id].x, curve.x), scaled(results[curve.id].y, curve.y), curve),
            name: curve.label || curve.id,
            color: curve.color,
            width: curve.width || 2,
            dash: curve.dash,
            yAxisIndex: axes.indexOf(dimension(curve.y, curve.sweep)),
        }));
}

// The y axes in the order the curves first use them, each with the symbols
// drawn against it.
function yGroups(curves, design, t) {
    const groups = new Map();
    for (const curve of curves) {
        const id = dimension(curve.y, curve.sweep);
        const { symbol, unit } = axisParts(curve.y, curve.sweep, design, t);
        if (!groups.has(id)) groups.set(id, { unit, symbols: [], percent: isFraction(curve.y.quantity) });
        const group = groups.get(id);
        if (!group.symbols.includes(symbol)) group.symbols.push(symbol);
    }
    return [...groups.values()];
}

const PERCENT_RANGE = { min: 0, max: 100, interval: 10 };

function yAxisFor(group, index, color, gridColor) {
    const axis = valueAxis({
        name: axisTitle(group.symbols, group.unit), color, gridColor,
        position: index === 0 ? 'left' : 'right',
        splitLine: index === 0,
        ...(group.percent ? PERCENT_RANGE : { scale: true }),
    });
    return index > 1 ? { ...axis, offset: AXIS_SPACING * (index - 1) } : axis;
}

function xAxisFor(curve, design, t, color, gridColor) {
    if (!curve || curve.x.quantity === SWEEP) {
        const token = curve?.sweep || 'wavelength';
        return valueAxis({
            name: sweepTitle(token, design, t), color, gridColor,
            wavelength: parseAxisVar(token).kind === 'lambda',
        });
    }
    const { symbol, unit } = axisParts(curve.x, curve.sweep, design, t);
    return valueAxis({
        name: axisTitle([symbol], unit), color, gridColor,
        ...(isFraction(curve.x.quantity) ? PERCENT_RANGE : {}),
    });
}

/**
 * The chart option. The tooltip reads every curve at the pointer while each
 * curve runs along its own sweep; a curve with a quantity on x can double back
 * on itself, as a Ψ-Δ trajectory does, and is read point by point instead.
 */
export function buildCurveOption(curves, results, c, t, design) {
    const text = c.text || '#cccccc';
    const gridColor = c.border || '#3a3a3a';
    const drawn = visibleCurves(curves);
    const groups = yGroups(drawn, design, t);
    const series = buildCurveSeries(curves, results);
    const alongSweep = drawn.every(curve => curve.x.quantity === SWEEP);
    const percent = groups.length > 0 && groups.every(group => group.percent);
    const grid = plotMargin({ rightAxis: groups.length > 1 });
    return cartesianOption({
        colors: c,
        grid: groups.length > 2 ? { ...grid, right: AXIS_SPACING * (groups.length - 1) } : grid,
        fileName: 'curves',
        legend: legendAbove({ color: text }),
        tooltip: alongSweep
            ? axisTooltip({ colors: c, series, valueSuffix: percent ? '%' : '' })
            : itemTooltip(c),
        xAxis: xAxisFor(drawn[0], design, t, text, gridColor),
        yAxis: groups.length
            ? groups.map((group, index) => yAxisFor(group, index, text, gridColor))
            : valueAxis({ name: '%', color: text, gridColor, ...PERCENT_RANGE }),
        series,
    });
}

export function MultiCurveChart({ curves, results, design, c, t }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    useEffect(() => { drawChart(divRef.current, chartRef, buildCurveOption(curves, results, c, t, design)); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
