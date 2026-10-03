/**
 * A spreadsheet's fill handle over a rectangle of grid cells: which rows a
 * drag down or up fills, and the values they take, as Excel's fill handle
 * gives them (Microsoft Support, "Project values in a series": the starting
 * values of a linear series are fitted by least squares, y = mx + b).
 *
 * Each column of the rectangle is carried on by itself, from the cells in it
 * that hold numbers, at the rows they are on:
 *   one number    copied into every filled cell; with Ctrl held it counts
 *                 instead, up by 1 a row going down and down by 1 going up
 *   two or more   the least-squares straight line through (row, value) of the
 *                 numbers, carried on past them: 400, 410 goes on 420, 430,
 *                 and 1, 3, 4 goes on 5.67, 7.17, 8.67
 *   none          the column is left as it is
 * A fill runs down or up only. The columns of a table hold different
 * quantities, so a value carried on sideways would mean nothing.
 */

function rectangleAround(columns, cells) {
    let first = Infinity;
    let last = -Infinity;
    for (const cell of cells) {
        const at = columns.indexOf(cell.colKey);
        first = Math.min(first, at);
        last = Math.max(last, at);
    }
    const rowStart = cells[0].rowIdx;
    const rowEnd = cells[cells.length - 1].rowIdx;
    const colKeys = columns.slice(first, last + 1);
    const whole = (rowEnd - rowStart + 1) * colKeys.length === cells.length;
    return whole ? { rowStart, rowEnd, colKeys } : null;
}

/**
 * The rectangle a fill handle carries on, { rowStart, rowEnd, colKeys }, from
 * a selection of the grid model `grid` (gridModel.js): the range, or the
 * focused cell alone. Cells added with Ctrl count only when the selection is
 * still one whole rectangle; otherwise there is no handle and this is null.
 * Rows from `rowCount` on are not in the table and are left out.
 */
export function fillSource(grid, { range, extraCells, focus }, rowCount) {
    if (extraCells?.size) {
        const cells = grid.selectedCells({ range, extraCells, focus }).filter(cell => cell.rowIdx < rowCount);
        return cells.length ? rectangleAround(grid.columns, cells) : null;
    }
    const rect = range || (focus && { rowStart: focus.rowIdx, rowEnd: focus.rowIdx, colKeys: [focus.colKey] });
    if (!rect || rect.rowStart >= rowCount) return null;
    return { ...rect, rowEnd: Math.min(rect.rowEnd, rowCount - 1) };
}

/**
 * How far a drag from `source` to row `rowIdx` reaches past it: { up, count },
 * or null while the pointer is back inside the source's rows. Going up it
 * stops at the first row.
 */
export function fillReach(source, rowIdx) {
    if (rowIdx > source.rowEnd) return { up: false, count: rowIdx - source.rowEnd };
    const top = Math.max(0, rowIdx);
    if (top < source.rowStart) return { up: true, count: source.rowStart - top };
    return null;
}

/** The rows a reach fills, { first, last } in table order. */
export function filledRows(source, { up, count }) {
    return up
        ? { first: source.rowStart - count, last: source.rowStart - 1 }
        : { first: source.rowEnd + 1, last: source.rowEnd + count };
}

// The least-squares straight line through points [[position, value]], as a
// function of position. Two or more points at different positions.
function straightLine(points) {
    const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
    const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
    let sxx = 0;
    let sxy = 0;
    for (const [x, y] of points) {
        sxx += (x - meanX) ** 2;
        sxy += (x - meanX) * (y - meanY);
    }
    const slope = sxy / sxx;
    return x => meanY + slope * (x - meanX);
}

// The line one number is carried on along: flat, or rising 1 a row with Ctrl.
function lineThrough([x0, y0], ctrl) {
    const slope = ctrl ? 1 : 0;
    return x => y0 + slope * (x - x0);
}

/**
 * The values `count` cells past a column's selected cells, or before them when
 * `up`, nearest first. `values` are the selected cells in row order, NaN or
 * undefined where a cell holds no number. Null when none holds a number.
 */
export function seriesValues(values, count, { up = false, ctrl = false } = {}) {
    const points = [];
    values.forEach((value, at) => { if (Number.isFinite(value)) points.push([at, value]); });
    if (!points.length) return null;
    const line = points.length === 1 ? lineThrough(points[0], ctrl) : straightLine(points);
    return Array.from({ length: count }, (_, k) => line(up ? -1 - k : values.length + k));
}

/**
 * The cells a drag from `source` to `reach` writes, [{ rowIdx, colKey, value }],
 * a column at a time; a column with no number writes none. `read(rowIdx,
 * colKey)` gives a cell's number.
 */
export function continuedCells(source, reach, read, ctrl = false) {
    const cells = [];
    for (const colKey of source.colKeys) {
        const values = [];
        for (let rowIdx = source.rowStart; rowIdx <= source.rowEnd; rowIdx++) values.push(read(rowIdx, colKey));
        const series = seriesValues(values, reach.count, { up: reach.up, ctrl });
        series?.forEach((value, k) => cells.push({
            rowIdx: reach.up ? source.rowStart - 1 - k : source.rowEnd + 1 + k, colKey, value,
        }));
    }
    return cells;
}
