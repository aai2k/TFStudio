import { useWindowSession } from '../../windowSession.js';
import { designEditorSession } from './sessionState.js';
import { LAYER_THICKNESS_COLUMNS } from './layerTableLayout.js';
import { ROW_NUMBER, isCellColumn, layerCellRange, sidewaysColumn } from './layerCells.js';
import { isTextControl } from '../../../ui/grid/gridKeys.js';

const { useEffect, useMemo, useRef, useState } = React;

/*
 * The handlers below take `ctx`: the table's rows in display order, the
 * selection as last rendered, its setters, and `anchorRef`, the row a Shift
 * range grows from. It stays put for a run of Shift-clicks or Shift+Arrows, so
 * extending twice covers both steps rather than re-anchoring on the row
 * reached last.
 */

function selectOnly(ctx, id) {
    ctx.anchorRef.current = id || null;
    ctx.setCellAnchor(null);
    ctx.setSelectedIds(new Set(id ? [id] : []));
    ctx.setSelectedId(id || null);
}

// The rows from the anchor row to row `index`, focused on `index`. False when
// either is not in the table.
function extendRows(ctx, index) {
    const { displayedLayers, anchorRef } = ctx;
    const row = displayedLayers[index];
    const anchor = displayedLayers.findIndex(layer => layer.id === anchorRef.current);
    if (!row || anchor < 0) return false;
    const [start, end] = anchor < index ? [anchor, index] : [index, anchor];
    ctx.setSelectedIds(new Set(displayedLayers.slice(start, end + 1).map(layer => layer.id)));
    ctx.setSelectedId(row.id);
    return true;
}

// Shift from a cell: the rectangle grows from its corner, the focused cell
// when there is no rectangle yet, to the cell in `column` of row `index`. The
// rows it spans are not selected as rows; the focus moves to the cell reached.
function extendCells(ctx, index, column) {
    const row = ctx.displayedLayers[index];
    if (!row) return;
    const corner = ctx.cellAnchor || { id: ctx.selectedId, column: ctx.activeColumn };
    selectOnly(ctx, row.id);
    ctx.setActiveColumn(column);
    if (!corner.id) return;
    ctx.anchorRef.current = corner.id;
    ctx.setCellAnchor(corner);
}

// Whole layers chosen at once, as a paste of layers or a drag leaves them: the
// rows are selected as rows and the focus goes to the row number.
function selectRows(ctx, ids, focusId) {
    ctx.anchorRef.current = focusId;
    ctx.setCellAnchor(null);
    ctx.setActiveColumn(ROW_NUMBER);
    ctx.setSelectedIds(new Set(ids));
    ctx.setSelectedId(focusId);
}

// Up and Down: the focus moves to row `index` in the same column. With
// `extend` the rectangle of cells grows to it, or on the row number the run
// of rows.
function focusRow(ctx, index, { extend = false } = {}) {
    const row = ctx.displayedLayers[index];
    if (!row) return;
    if (extend && isCellColumn(ctx.activeColumn)) extendCells(ctx, index, ctx.activeColumn);
    else if (!extend || !extendRows(ctx, index)) selectOnly(ctx, row.id);
    requestAnimationFrame(() => ctx.reveal(ctx.containerRef.current, row.id));
}

// Left and Right move the focus along the focused row and give up any
// rectangle; with Shift they stretch the rectangle sideways instead.
function moveSideways(ctx, delta, { extend = false } = {}) {
    const index = ctx.displayedLayers.findIndex(layer => layer.id === ctx.selectedId);
    if (extend) {
        if (index >= 0 && isCellColumn(ctx.activeColumn)) {
            extendCells(ctx, index, sidewaysColumn(ctx.activeColumn, delta, true));
        }
        return;
    }
    if (index >= 0) selectOnly(ctx, ctx.selectedId);
    ctx.setActiveColumn(sidewaysColumn(ctx.activeColumn, delta));
}

// Escape gives up a rectangle for its focused cell. False with none drawn.
function collapseCells(ctx) {
    if (!ctx.cellAnchor) return false;
    selectOnly(ctx, ctx.selectedId);
    return true;
}

// Ctrl adds the row to the selected rows or takes it out, never leaving none,
// and puts the focus on the row number. From a cell there are no selected rows
// to add to, so the row starts a selection of its own.
function toggleRow(ctx, id) {
    const next = new Set(isCellColumn(ctx.activeColumn) ? [] : ctx.selectedIds);
    const removing = next.has(id) && next.size > 1;
    if (removing) next.delete(id);
    else next.add(id);
    selectRows(ctx, next, removing ? [...next].at(-1) : id);
}

// A drag over the cells ends at the release of the button, wherever it is. A
// drag that crossed cells leaves `dragEnded` set until the click the release
// makes has gone by: released on another cell of the same row, that click
// lands on the row itself, and would select the row.
function endDrag(ctx) {
    const drag = ctx.drag.current;
    ctx.drag.current = null;
    if (!drag?.moved) return;
    ctx.dragEnded.current = true;
    setTimeout(() => { ctx.dragEnded.current = false; }, 0);
}

// A press on a cell focuses it and starts a drag: each cell the pointer then
// crosses with the button held stretches the rectangle to it. A press in an
// open thickness editor is left to the editor, and one with Shift or Ctrl to
// the click it makes.
const plainPress = event => event.button === 0 && ![event.shiftKey, event.ctrlKey, event.metaKey].some(Boolean);

function pressCell(ctx, id, column, event) {
    if (!plainPress(event) || isTextControl(event.target)) return;
    selectOnly(ctx, id);
    ctx.setActiveColumn(column);
    ctx.drag.current = { moved: false };
    const end = () => endDrag(ctx);
    event.currentTarget.ownerDocument.addEventListener('pointerup', end, { once: true });
}

function dragOver(ctx, id, column, event) {
    if (!ctx.drag.current) return;
    if (!(event.buttons & 1)) { endDrag(ctx); return; }
    ctx.drag.current.moved = true;
    extendCells(ctx, ctx.displayedLayers.findIndex(layer => layer.id === id), column);
}

// A click in row `id`, on the cell in `column` or on the row number. Shift
// from a cell to a cell stretches the rectangle; any other Shift-click
// stretches the run of rows and moves the focus to the row number. Ctrl adds
// or removes the row. A plain click focuses what was clicked.
function clickRow(ctx, id, event, column = ROW_NUMBER) {
    const target = ctx.displayedLayers.findIndex(layer => layer.id === id);
    if (ctx.dragEnded.current) {
        ctx.dragEnded.current = false;
    } else if (event?.shiftKey && isCellColumn(column) && isCellColumn(ctx.activeColumn)) {
        extendCells(ctx, target, column);
    } else if (event?.shiftKey && extendRows(ctx, target)) {
        ctx.setCellAnchor(null);
        ctx.setActiveColumn(ROW_NUMBER);
    } else if (event?.ctrlKey || event?.metaKey) {
        toggleRow(ctx, id);
    } else {
        selectOnly(ctx, id);
        ctx.setActiveColumn(column);
    }
    ctx.containerRef.current?.focus();
}

// Each handler is built once and reads the selection when it is called, so the
// rows it is handed to keep their props from one render to the next. A focus
// moved from outside, by a paste of layers, a drag or a deleted row, gives up
// any rectangle of cells.
function selectionHandlers(live) {
    const ctx = () => live.current;
    return {
        setSelectedId: id => {
            ctx().setCellAnchor(null);
            ctx().setSelectedId(id);
        },
        selectOnly: id => selectOnly(ctx(), id),
        selectRows: (ids, focusId) => selectRows(ctx(), ids, focusId),
        focusDisplayIndex: (index, options) => focusRow(ctx(), index, options),
        moveColumn: (delta, options) => moveSideways(ctx(), delta, options),
        focusCell: (id, column) => {
            selectOnly(ctx(), id);
            ctx().setActiveColumn(column);
        },
        collapseCells: () => collapseCells(ctx()),
        selectAndFocus: (id, event, column) => clickRow(ctx(), id, event, column),
        pressCell: (id, column, event) => pressCell(ctx(), id, column, event),
        dragOver: (id, column, event) => dragOver(ctx(), id, column, event),
    };
}

/**
 * Which rows and cells of one side's layer table are selected.
 *
 * Rows: the selected layers and the focused one among them, kept per design
 * so opening a design again brings it back. Cells: the focused row's cell in
 * the active column, and the corner a rectangle of cells grows from, null while
 * there is no rectangle. With the active column on the row number no cell has
 * the focus and the selection is of whole layers, `rowsSelected`, the only
 * selection a row is drawn selected for (layerCells.js). A cell or a rectangle
 * of cells leaves the focused row alone selected.
 *
 * `actionIds` are the rows Delete and the thickness steps act on: the rows a
 * rectangle spans, as the merit table's row keys take the rows holding its
 * selected cells, or else the selected rows.
 *
 * `reveal(container, id)` scrolls a row into view.
 */
export function useLayerSelection({ layers, displayedLayers, reversed, design, containerRef, reveal }) {
    const [session, setSessionField] = useWindowSession(designEditorSession, design);
    const selectedId = session.selectedLayerId;
    const [selectedIds, setSelectedIds] = useState(() => new Set(selectedId ? [selectedId] : []));
    const [activeColumn, setActiveColumn] = useState(LAYER_THICKNESS_COLUMNS[0].unit);
    const [cellAnchor, setCellAnchor] = useState(null);
    const anchorRef = useRef(selectedId || null);
    const drag = useRef(null);
    const dragEnded = useRef(false);

    useEffect(() => {
        const validIds = new Set(layers.map(layer => layer.id));
        setSelectedIds(current => {
            const next = new Set([...current].filter(id => validIds.has(id)));
            if (selectedId && validIds.has(selectedId) && !next.has(selectedId)) next.add(selectedId);
            if (next.size === current.size && [...next].every(id => current.has(id))) return current;
            return next;
        });
    }, [layers, selectedId]);

    const live = useRef(null);
    live.current = {
        displayedLayers, selectedId, selectedIds, activeColumn, cellAnchor, anchorRef, drag, dragEnded, containerRef, reveal,
        setSelectedIds, setActiveColumn, setCellAnchor,
        setSelectedId: value => setSessionField('selectedLayerId', value),
    };
    const handlers = useMemo(() => selectionHandlers(live), []);

    const { range, actionIds } = useMemo(() => {
        const shown = reversed ? [...layers].reverse() : layers;
        const cells = layerCellRange(shown, cellAnchor, { id: selectedId, column: activeColumn });
        const spanned = cells && new Set(shown.slice(cells.rowStart, cells.rowEnd + 1).map(layer => layer.id));
        return { range: cells, actionIds: spanned || selectedIds };
    }, [layers, reversed, cellAnchor, selectedId, activeColumn, selectedIds]);

    return {
        selectedId, selectedIds, activeColumn, range, actionIds,
        rowsSelected: activeColumn === ROW_NUMBER, ...handlers,
    };
}
