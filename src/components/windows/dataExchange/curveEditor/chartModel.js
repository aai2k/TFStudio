/**
 * The curve editor's plot: every value column as typed, the design's own curve
 * behind each, and the points the target editor overlay lets the user drag.
 *
 * Columns in one unit share the left axis. A second unit, or Δ beside Ψ, gets
 * the right axis, the way the Ellipsometry plot gives Δ an axis of its own: on
 * one 0-360° axis Ψ would be squeezed into its bottom quarter.
 */
import {
    axisTooltip, cartesianOption, lineSeries, scatterSeries, valueAxis,
} from '../../../ui/chartOptions.js';
import { legendAbove, plotMargin } from '../../analysis/chrome/plot.js';
import { columnSeries, tidy, valueKey } from './curveTable.js';
import { valueColumnName } from './editorLabels.js';
import { valueProblem } from './units.js';

const QUANTITY_COLOR = {
    T: '#2196f3', R: '#ef5350', A: '#66bb6a', PSI: '#4fc3f7', DEL: '#ff8a65', W: '#ab47bc', I: '#4fc3f7', PHI: '#ffb74d',
};
const SPARE_COLORS = ['#ffb300', '#26a69a', '#ec407a', '#8d6e63', '#7e57c2'];

/** A colour per value column: its quantity's, and a spare one for a second column of that quantity. */
export function columnColors(columns) {
    const seen = new Set();
    let spare = 0;
    return columns.map(column => {
        if (!seen.has(column.quantity)) {
            seen.add(column.quantity);
            return QUANTITY_COLOR[column.quantity] || SPARE_COLORS[0];
        }
        return SPARE_COLORS[spare++ % SPARE_COLORS.length];
    });
}

const scaleKey = column => (column.quantity === 'DEL' ? 'DEL' : column.unit);

/** The value axis of each column: 0 for the first column's scale, 1 for any other. */
export function columnAxes(columns) {
    const first = columns[0] ? scaleKey(columns[0]) : null;
    return columns.map(column => (scaleKey(column) === first ? 0 : 1));
}

// A column's points in ascending wavelength, so its line is drawn in order. A
// table that already is, as a scan or a resampled grid is, is not sorted again.
function sortedPoints(table, index) {
    const series = columnSeries(table, index);
    const points = series.x.map((x, at) => [x, series.y[at], series.rows[at]]);
    const ascending = points.every((point, at) => at === 0 || points[at - 1][0] <= point[0]);
    return ascending ? points : points.sort((a, b) => a[0] - b[0]);
}

function axisName(columns, axes, axis, labels) {
    const names = [...new Set(columns.filter((_, index) => axes[index] === axis).map(labels.quantity))];
    const unit = columns.find((_, index) => axes[index] === axis)?.unit;
    const unitLabel = labels.unit(unit);
    return unitLabel ? `${names.join(', ')} (${unitLabel})` : names.join(', ');
}

function columnLabel(column, index, labels) {
    return valueColumnName(column, index, labels.quantity(column));
}

function columnSeriesList(table, index, view) {
    const { colors, axes, backdrops, labels, dragOn, errorColor } = view;
    const column = table.columns[index];
    const points = sortedPoints(table, index);
    const label = columnLabel(column, index, labels);
    const series = [];
    const backdrop = backdrops?.[index];
    if (backdrop) {
        series.push(lineSeries({
            x: backdrop.x, y: backdrop.y, name: `${label} (${labels.design})`,
            color: colors[index], width: 1.2, dash: 'dashed', yAxisIndex: axes[index], z: 1, silent: true,
        }));
    }
    series.push(lineSeries({
        data: points.map(point => [point[0], point[1]]), name: label, color: colors[index], width: 1.6,
        symbol: dragOn ? 'none' : 'emptyCircle', symbolSize: 5, yAxisIndex: axes[index], z: 3,
    }));
    const outside = points.filter(point => valueProblem(column.quantity, column.unit, point[1]));
    if (outside.length) {
        series.push(scatterSeries({
            data: outside.map(point => [point[0], point[1]]), color: errorColor, symbolSize: 9,
            yAxisIndex: axes[index], z: 5, silent: true,
        }));
    }
    return series;
}

/**
 * The plot's ECharts option.
 *   view.colors      chart colours, as cartesianOption takes them
 *   view.backdrops   designBackdrop.js, one per column or null
 *   view.labels      { quantity(column), unit(unit), design, xAxis }
 *   view.dragOn      points are dragged on the overlay, so the line draws none
 */
export function curveChartOption(table, view) {
    const axes = columnAxes(table.columns);
    const columnColorsList = columnColors(table.columns);
    const context = { ...view, axes, colors: columnColorsList };
    const series = table.columns.flatMap((_, index) => columnSeriesList(table, index, context));
    const twoAxes = axes.includes(1);
    const yAxis = [0, 1].slice(0, twoAxes ? 2 : 1).map(axis => ({
        ...valueAxis({
            name: axisName(table.columns, axes, axis, view.labels), color: view.colors.text,
            gridColor: view.colors.grid, position: axis ? 'right' : 'left', scale: true, nameGap: 40,
        }),
        splitLine: { show: axis === 0, lineStyle: { color: view.colors.grid, width: 1 } },
    }));
    return cartesianOption({
        colors: view.colors,
        grid: plotMargin({ rightAxis: twoAxes }),
        fileName: 'curve',
        legend: legendAbove({ color: view.colors.text }),
        tooltip: axisTooltip({ colors: view.colors, series }),
        xAxis: valueAxis({ name: view.labels.xAxis, color: view.colors.text, gridColor: view.colors.grid }),
        yAxis,
        series,
    });
}

/** The points the overlay offers to drag: every complete row of every column. */
export function pointGeometry(table) {
    const axes = columnAxes(table.columns);
    const colors = columnColors(table.columns);
    return table.columns.flatMap((_, index) => {
        const series = columnSeries(table, index);
        return series.rows.map((rowIdx, at) => ({
            opId: `${rowIdx}:${valueKey(index)}`, shape: 'point',
            x0: series.x[at], y0: series.y[at], color: colors[index], yAxisIndex: axes[index],
        }));
    });
}

/** The cell a dragged point stands for, from its id. */
export function draggedCell(opId) {
    const [row, colKey] = String(opId).split(':');
    return { rowIdx: Number(row), colKey };
}

/**
 * A dragged value rounded to a thousandth of the span its column covers, about
 * the pixel a pointer places it on in a plot a few hundred pixels tall, so the
 * cell does not fill with digits the drag never chose.
 */
export function roundDragged(value, values) {
    const finite = values.filter(Number.isFinite);
    const span = finite.length ? Math.max(...finite) - Math.min(...finite) : 0;
    const scale = span > 0 ? span : Math.max(Math.abs(value), 1);
    const step = 10 ** (Math.floor(Math.log10(scale)) - 3);
    return tidy(Math.round(value / step) * step);
}
