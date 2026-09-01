/**
 * The Plot Engine in 2D: one line per curve, each over its own x axis.
 */

import { xAxisLabel } from '../../../../../utils/physics/plotQuantities.js';
import { drawChart, useChartTeardown } from '../../../../ui/plotSurface.js';
import { axisTooltip, cartesianOption, lineSeries, valueAxis } from '../../../../ui/chartOptions.js';
import { legendAbove, plotMargin } from '../../chrome/plot.js';

const { createElement: h, useEffect, useRef } = React;

export function buildCurveSeries(curves, results) {
    return curves
        .filter(curve => curve.visible && results[curve.id])
        .map(curve => lineSeries({
            x: results[curve.id].x,
            y: results[curve.id].y.map(value => value * 100),
            name: curve.label || curve.id,
            color: curve.color,
            width: curve.width || 2,
            dash: curve.dash,
        }));
}

function dominantXAxis(curves) {
    return curves.find(curve => curve.visible)?.xAxis || 'wavelength';
}

function buildCurveOption(curves, results, c) {
    const text = c.text || '#cccccc';
    const grid = c.border || '#3a3a3a';
    return cartesianOption({
        colors: c,
        grid: plotMargin(),
        fileName: 'curves',
        legend: legendAbove({ color: text }),
        tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
        xAxis: valueAxis({ name: xAxisLabel(dominantXAxis(curves)), color: text, gridColor: grid }),
        yAxis: valueAxis({ name: '%', color: text, gridColor: grid, min: 0, max: 100, interval: 10 }),
        series: buildCurveSeries(curves, results),
    });
}

export function MultiCurveChart({ curves, results, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    useEffect(() => { drawChart(divRef.current, chartRef, buildCurveOption(curves, results, c)); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
