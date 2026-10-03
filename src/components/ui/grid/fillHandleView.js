/**
 * How a grid draws its fill handle (useFillDrag.js): the square on the
 * selection's bottom-right corner, the outline around the cells a drag will
 * fill, and the label by the pointer with what the farthest of them will hold.
 */
const { createElement: h } = React;

const HANDLE_SIZE = 7;

// A double-click on the handle is a habit from spreadsheets, where it fills down
// to the next column's end; here it does nothing, rather than open the corner
// cell for typing.
const keepDoubleClick = event => {
    event.preventDefault();
    event.stopPropagation();
};

/** The handle, drawn in the corner cell, which must be positioned. */
export function fillHandle(c, title, onMouseDown) {
    return h('div', {
        title, onMouseDown, onDoubleClick: keepDoubleClick,
        style: {
            position: 'absolute', right: 0, bottom: 0, width: HANDLE_SIZE, height: HANDLE_SIZE,
            boxSizing: 'border-box', background: c.accent, border: `1px solid ${c.panel}`, cursor: 'crosshair',
        },
    });
}

/**
 * The style that draws a cell's part of the outline around the cells a drag
 * fills, `outline` being { first, last, colKeys }; null for a cell outside it.
 * Inset shadows draw it, so no cell changes size.
 */
export function fillOutlineStyle(c, outline, rowIdx, colKey) {
    if (!outline || rowIdx < outline.first || rowIdx > outline.last) return null;
    const at = outline.colKeys.indexOf(colKey);
    if (at < 0) return null;
    const edges = [
        rowIdx === outline.first && `inset 0 2px 0 ${c.textDim}`,
        rowIdx === outline.last && `inset 0 -2px 0 ${c.textDim}`,
        at === 0 && `inset 2px 0 0 ${c.textDim}`,
        at === outline.colKeys.length - 1 && `inset -2px 0 0 ${c.textDim}`,
    ].filter(Boolean);
    return edges.length ? { boxShadow: edges.join(', ') } : null;
}

/** The label by the pointer during a drag: `values`, the farthest filled row's texts in column order. */
export function fillLabel(c, drag, values) {
    if (!drag || !values.length) return null;
    return h('div', {
        style: {
            position: 'fixed', left: drag.x + 14, top: drag.y + 16, zIndex: 3, pointerEvents: 'none',
            display: 'flex', gap: 10, padding: '2px 6px', borderRadius: 3, fontSize: 11,
            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            background: c.panel, color: c.text, border: `1px solid ${c.border}`,
            boxShadow: '0 2px 6px rgba(0,0,0,.3)',
        },
    }, values.map((text, index) => h('span', { key: index }, text)));
}
