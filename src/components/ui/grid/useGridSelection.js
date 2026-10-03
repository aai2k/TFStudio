/**
 * Which cells of a table are selected, held the way a spreadsheet holds them:
 * one focused cell, the rectangle from an anchor cell to it, and any cells
 * added with Ctrl. A click focuses a cell, Shift stretches the rectangle to
 * it, Ctrl adds or removes it, and a drag begun on a cell grows the rectangle
 * over the cells the pointer crosses.
 *
 * Every handler is built once and reads the selection, and the options it was
 * given, through a ref at the moment it is called. A table can then hand the
 * handlers to memoised rows and a change of selection redraws only the rows it
 * touches; see the merit table's useTableSelection.js for why that matters.
 *
 *   grid     the table's model from gridModel.js
 *   options  read at call time:
 *     hasRow(rowIdx)     whether the row exists to be selected
 *     onPick(rowIdx)     a click, Shift click, Ctrl click or arrow chose a cell
 *     onRowDrag(rowIdx)  a drag begun with beginDrag('rows') entered a row
 */
import { NO_CELLS, cellKey } from './gridModel.js';

const { useState, useEffect, useMemo, useRef } = React;

// The handlers below take `ctx`: the live selection and options, the state
// setters, and the ref holding what a held button is dragging over: 'rows'
// from a row-number column, 'cells' from a cell, null when nothing is held.

const exists = (ctx, rowIdx) => ctx.live.current.options.hasRow(rowIdx);
const picked = (ctx, rowIdx) => ctx.live.current.options.onPick?.(rowIdx);

// The focus moves with nothing else selected, and nothing is reported.
function place(ctx, rowIdx, colKey) {
    const cell = { rowIdx, colKey };
    ctx.set.focusCell(cell);
    ctx.set.anchorCell(cell);
    ctx.set.extraCells(NO_CELLS);
}

// A plain click or an arrow: one cell, nothing else selected.
function focusAt(ctx, rowIdx, colKey) {
    if (!exists(ctx, rowIdx)) return;
    place(ctx, rowIdx, colKey);
    picked(ctx, rowIdx);
}

// Shift: the rectangle from the anchor grows to the cell.
function extendTo(ctx, rowIdx, colKey) {
    if (!ctx.live.current.anchorCell) focusAt(ctx, rowIdx, colKey);
    else if (exists(ctx, rowIdx)) {
        ctx.set.focusCell({ rowIdx, colKey });
        picked(ctx, rowIdx);
    }
}

// Ctrl: what is selected stays, the cell joins or leaves it, and becomes the
// focus and the anchor for the next Shift.
function toggleCell(ctx, rowIdx, colKey) {
    if (!exists(ctx, rowIdx)) return;
    const { grid, range, focusCell, extraCells } = ctx.live.current;
    const kept = new Set(extraCells);
    for (const cell of grid.selectedCells({ range, extraCells: [], focus: focusCell })) {
        kept.add(cellKey(cell.rowIdx, cell.colKey));
    }
    const key = cellKey(rowIdx, colKey);
    if (kept.has(key)) kept.delete(key); else kept.add(key);
    const cell = { rowIdx, colKey };
    ctx.set.extraCells(kept);
    ctx.set.focusCell(cell);
    ctx.set.anchorCell(cell);
    picked(ctx, rowIdx);
}

// A rectangle set as given, with no check that its rows exist and nothing
// reported: a fill that adds rows selects them in the same step that adds them,
// before the table holding them is drawn.
function placeRange(ctx, anchor, focus) {
    ctx.set.anchorCell(anchor);
    ctx.set.focusCell(focus);
    ctx.set.extraCells(NO_CELLS);
}

// A whole rectangle at once, as a click on a row or column header picks it.
function selectRange(ctx, anchor, focus) {
    if (!exists(ctx, focus.rowIdx)) return;
    placeRange(ctx, anchor, focus);
    picked(ctx, focus.rowIdx);
}

// A press on a cell: Shift stretches the rectangle to it, Ctrl adds or removes
// it, and a plain press focuses it and starts a drag that grows the rectangle
// over the cells the pointer crosses.
function pressCell(ctx, rowIdx, colKey, event) {
    if (event.button !== 0) return;
    if (event.shiftKey) { event.preventDefault(); extendTo(ctx, rowIdx, colKey); }
    else if (event.ctrlKey || event.metaKey) { event.preventDefault(); toggleCell(ctx, rowIdx, colKey); }
    else { focusAt(ctx, rowIdx, colKey); ctx.dragging.current = 'cells'; }
}

// A cell drag passes over a row that reports no column unchanged.
function dragOver(ctx, rowIdx, colKey) {
    const mode = ctx.dragging.current;
    if (mode === 'rows') ctx.live.current.options.onRowDrag?.(rowIdx);
    else if (mode === 'cells' && colKey) extendTo(ctx, rowIdx, colKey);
}

function selectionHandlers(live, set, dragging) {
    const ctx = { live, set, dragging };
    return {
        place: (rowIdx, colKey) => place(ctx, rowIdx, colKey),
        focusAt: (rowIdx, colKey) => focusAt(ctx, rowIdx, colKey),
        extendTo: (rowIdx, colKey) => extendTo(ctx, rowIdx, colKey),
        toggleCell: (rowIdx, colKey) => toggleCell(ctx, rowIdx, colKey),
        placeRange: (anchor, focus) => placeRange(ctx, anchor, focus),
        selectRange: (anchor, focus) => selectRange(ctx, anchor, focus),
        collapseRange: () => {
            set.anchorCell(live.current.focusCell);
            set.extraCells(NO_CELLS);
        },
        clearCells: () => {
            set.anchorCell(null);
            set.extraCells(NO_CELLS);
            set.focusCell(null);
        },
        beginDrag: mode => { dragging.current = mode; },
        pressCell: (rowIdx, colKey, event) => pressCell(ctx, rowIdx, colKey, event),
        dragOver: (rowIdx, colKey) => dragOver(ctx, rowIdx, colKey),
    };
}

export function useGridSelection(grid, options) {
    const [focusCell, setFocusCell] = useState(null);
    const [anchorCell, setAnchorCell] = useState(null);
    const [extraCells, setExtraCells] = useState(NO_CELLS);
    const tableRef = useRef(null);
    const dragging = useRef(null);

    // A drag ends wherever the button is released, inside the table or not,
    // and a torn-off window has a document of its own.
    useEffect(() => {
        const doc = tableRef.current?.ownerDocument || document;
        const end = () => { dragging.current = null; };
        doc.addEventListener('mouseup', end);
        return () => doc.removeEventListener('mouseup', end);
    }, []);

    const range = useMemo(() => grid.cellRange(anchorCell, focusCell), [grid, anchorCell, focusCell]);

    const live = useRef();
    live.current = { grid, options, focusCell, anchorCell, extraCells, range };
    const set = useMemo(() => ({
        focusCell: setFocusCell, anchorCell: setAnchorCell, extraCells: setExtraCells,
    }), []);
    const handlers = useMemo(() => selectionHandlers(live, set, dragging), [set]);

    return { focusCell, setFocusCell, anchorCell, extraCells, range, tableRef, ...handlers };
}
