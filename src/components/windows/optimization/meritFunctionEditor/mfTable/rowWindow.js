/**
 * Which rows of the merit-function table are built.
 *
 * A merit function runs to thousands of operands, and a row is eleven cells and
 * an operand-type picker. Building them all puts tens of thousands of cells in
 * the page, and the browser then lays every one of them out again each time the
 * pane changes width: dragging a dock divider re-lays-out the whole table sixty
 * times a second, however little React itself is doing. Only the rows over the
 * scroller are built, with a run of empty space above and below standing in for
 * the rest, so the cost of a resize stops following the operand count.
 *
 * Every row is given this height rather than being left to its font metrics,
 * because a row is placed here from its index alone.
 */
export const ROW_H = 22;

// Rows built past each edge of the scroller, so a scroll of a line or two
// reveals rows that are already there.
const OVERSCAN = 6;

// Height assumed for a scroller that has not been measured yet: a tall pane, so
// the rows are there whatever the dock is doing when the table first renders.
const UNMEASURED_H = 900;

/**
 * @param {number} count           operands in the table
 * @param {number} scrollTop       scroller position, px
 * @param {number} viewportHeight  visible height of the scroller, px
 * @returns {{from: number, to: number, padTop: number, padBottom: number}}
 *   `from`..`to` inclusive are the rows to build; the pads are the height of
 *   the spacer rows standing in for the rest. An empty table returns `to` below
 *   `from`, which builds nothing.
 */
export function rowWindow(count, scrollTop, viewportHeight, rowHeight = ROW_H) {
    if (!(count > 0)) return { from: 0, to: -1, padTop: 0, padBottom: 0 };
    // A pane's worth of rows stands in until the scroller has been measured, so
    // a first render without a layout pass behind it still produces a table
    // rather than a handful of rows.
    const height = viewportHeight > 0 ? viewportHeight : UNMEASURED_H;
    const top = Math.max(0, scrollTop);
    const from = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
    const to = Math.min(count - 1, Math.ceil((top + height) / rowHeight) + OVERSCAN);
    return {
        from,
        to,
        padTop: from * rowHeight,
        padBottom: (count - 1 - to) * rowHeight,
    };
}

/**
 * Where the scroller has to move for row `rowIdx` to be wholly in view, or null
 * when it already is. `headerHeight` is the sticky header, which covers the top
 * of the scroller and would otherwise hide the row the keyboard just reached.
 */
export function scrollToRow(rowIdx, scrollTop, viewportHeight, headerHeight, rowHeight = ROW_H) {
    // The header is part of the scrolled content and sits above the first row,
    // so a row starts that much further down than its index alone would put it.
    const top = headerHeight + rowIdx * rowHeight;
    if (top - headerHeight < scrollTop) return Math.max(0, top - headerHeight);
    if (top + rowHeight > scrollTop + viewportHeight) {
        return top + rowHeight - viewportHeight;
    }
    return null;
}
