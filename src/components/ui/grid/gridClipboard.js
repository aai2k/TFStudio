/**
 * Copying cells out of a grid and pasting text into it. The table's grid is
 * `spec`: its value columns in table order, and `holds(row, colKey)`, whether a
 * row carries a value in a column. See gridModel.js.
 */

/** Clipboard text as rows of cells: lines split on tabs. */
export function parseCellGrid(text) {
    return (text || '').replace(/\s+$/, '').split(/\r?\n/).map(line => line.split('\t'));
}

/**
 * The cells a pasted grid of text lands on, each with its text.
 *
 * Over a range the grid repeats to fill it, the way a spreadsheet fills a
 * selection: one value fills every cell, one row fills every row. From a
 * single cell the grid is laid out from that cell down and to the right, and
 * what falls off the table's edge is dropped. Cells a row does not carry are
 * skipped either way, as is empty text.
 */
export function pasteTargetsIn(spec, { grid, range, focus, rows }) {
    const targets = [];
    const put = (rowIdx, colKey, text) => {
        if (text === '' || !spec.holds(rows[rowIdx], colKey)) return;
        targets.push({ rowIdx, colKey, text });
    };
    if (range) {
        for (let rowIdx = range.rowStart; rowIdx <= range.rowEnd; rowIdx++) {
            const line = grid[(rowIdx - range.rowStart) % grid.length];
            range.colKeys.forEach((colKey, index) => put(rowIdx, colKey, line[index % line.length]));
        }
        return targets;
    }
    const start = spec.columns.indexOf(focus.colKey);
    if (start < 0) return targets;
    grid.forEach((line, rowOffset) => {
        line.forEach((text, colOffset) => {
            const colKey = spec.columns[start + colOffset];
            if (colKey) put(focus.rowIdx + rowOffset, colKey, text);
        });
    });
    return targets;
}

/**
 * A rectangle of cells as tab-separated lines, one per row, each cell written
 * by `cellText(row, colKey)`. A cell the row does not carry is left empty, so
 * the columns stay aligned for whatever reads it.
 */
export function rangeTextIn(spec, rows, range, cellText) {
    const lines = [];
    for (let rowIdx = range.rowStart; rowIdx <= range.rowEnd; rowIdx++) {
        const row = rows[rowIdx];
        lines.push(range.colKeys
            .map(colKey => (spec.holds(row, colKey) ? cellText(row, colKey) : ''))
            .join('\t'));
    }
    return lines.join('\n');
}

/**
 * Selected cells that are not one rectangle as text: the cells of a row
 * tab-separated, rows on their own lines, in the table order `cells` is in.
 */
export function cellsTextIn(spec, rows, cells, cellText) {
    const lines = new Map();
    for (const { rowIdx, colKey } of cells) {
        const row = rows[rowIdx];
        if (!spec.holds(row, colKey)) continue;
        if (!lines.has(rowIdx)) lines.set(rowIdx, []);
        lines.get(rowIdx).push(cellText(row, colKey));
    }
    return [...lines.values()].map(line => line.join('\t')).join('\n');
}
