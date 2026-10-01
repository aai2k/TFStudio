/**
 * Drawing only the rows of a long table that are in view.
 *
 * A table scrolls inside a pane of its own, and every row is one fixed height,
 * so which rows the pane shows follows from its scroll position alone. Those
 * are drawn, with one empty row above and one below standing in for the rest so
 * the scrollbar spans the whole table: a table of 60,000 rows then costs what
 * one of 50 does to draw. Nothing limits how many rows a range and step ask for,
 * so every table that lists them draws this way.
 */

import { observeResize } from './observeResize.js';

const { createElement: h, useState, useRef, useCallback, useEffect } = React;

// Rows drawn past each edge of the pane, so a quick scroll shows no gap.
const OVERSCAN = 10;
// The pane's height until it has been measured, as in a render without layout.
const UNMEASURED_HEIGHT = 600;

/** The rows [first, end) of `count`, each `rowHeight` tall, in a pane `viewHeight` tall at `scrollTop`. */
export function visibleRows(count, rowHeight, scrollTop, viewHeight) {
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
    const end = Math.min(count, Math.ceil((scrollTop + viewHeight) / rowHeight) + OVERSCAN);
    return [Math.min(first, end), end];
}

/**
 * The pane a table of `count` rows scrolls in. Give `paneRef` and `onScroll` to
 * the scrolling element and draw the body with `virtualBody`. `scrollToRow`
 * brings a row that may not be drawn yet to the middle of the pane, and
 * `scrollToEnd` shows the last.
 */
export function useVirtualRows(count, rowHeight) {
    const paneRef = useRef(null);
    const [view, setView] = useState({ top: 0, height: UNMEASURED_HEIGHT });
    const measure = useCallback(() => {
        const pane = paneRef.current;
        if (!pane) return;
        const next = { top: pane.scrollTop, height: pane.clientHeight || UNMEASURED_HEIGHT };
        setView(prev => (prev.top === next.top && prev.height === next.height ? prev : next));
    }, []);
    // An empty table may draw no pane, so the pane is looked for again once it has rows.
    const hasRows = count > 0;
    useEffect(() => {
        const observer = observeResize(paneRef.current, measure);
        measure();
        return () => observer?.disconnect();
    }, [measure, hasRows]);
    const scrollTo = useCallback((top) => {
        if (paneRef.current) paneRef.current.scrollTop = top(paneRef.current);
        measure();
    }, [measure]);
    const scrollToRow = useCallback(
        index => scrollTo(pane => Math.max(0, index * rowHeight - pane.clientHeight / 2)), [scrollTo, rowHeight]);
    const scrollToEnd = useCallback(() => scrollTo(pane => pane.scrollHeight), [scrollTo]);
    const [first, end] = visibleRows(count, rowHeight, view.top, view.height);
    return { paneRef, onScroll: measure, scrollToRow, scrollToEnd, first, end };
}

// The rows above or below the drawn ones, as one empty row of their height.
function spacerRow(key, count, rowHeight, span) {
    return count > 0 && h('tr', { key, 'aria-hidden': true },
        h('td', { colSpan: span, style: { height: count * rowHeight, padding: 0, border: 'none' } }));
}

/**
 * A table body drawing `items` from `first` to `end` with `drawRow(item, index)`
 * and one empty row of the right height for each run of rows not drawn. `span`
 * is the number of columns. The row at `keep`, if given, is drawn wherever it
 * is, so a cell being edited keeps its focus while the table is scrolled away
 * from it.
 */
export function virtualBody(items, { first, end, keep = -1 }, rowHeight, span, drawRow) {
    const drawn = [];
    if (keep >= 0 && keep < first) drawn.push(keep);
    for (let index = first; index < end; index++) drawn.push(index);
    if (keep >= end && keep < items.length) drawn.push(keep);
    const body = [];
    let next = 0;
    drawn.forEach((index, i) => {
        body.push(spacerRow(`gap${i}`, index - next, rowHeight, span), drawRow(items[index], index));
        next = index + 1;
    });
    body.push(spacerRow('below', items.length - next, rowHeight, span));
    return body;
}

/**
 * Column widths for a table drawn with `virtualBody`. Laid out to fit only the
 * rows in view, a column would widen and narrow as longer and shorter values
 * scroll past, and move every column beside it. Each column is instead held as
 * wide as the longest text it has drawn, counted in characters, so it widens
 * only when a longer value first comes into view.
 *
 * `fit(column, text)` counts a cell's text and returns it. `colgroup()` gives
 * the widths: call it after the body is drawn and put it first in the table.
 * A character is the width of a digit in the table's font, and each cell is
 * taken to be padded 8 px a side. The counts start over when the labels change.
 */
export function useSteadyColumns(labels) {
    return steadyColumns(useRef(null), labels);
}

/** `useSteadyColumns` with the counts kept in `store.current` between renders. */
export function steadyColumns(store, labels) {
    const key = labels.join('\n');
    if (store.current?.key !== key) store.current = { key, chars: labels.map(label => String(label ?? '').length) };
    const { chars } = store.current;
    const fit = (column, text) => {
        chars[column] = Math.max(chars[column], String(text).length);
        return text;
    };
    const colgroup = () => h('colgroup', null,
        chars.map((count, column) => h('col', { key: column, style: { width: `calc(${count}ch + 16px)` } })));
    return { fit, colgroup };
}
