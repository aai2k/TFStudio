/**
 * Selection, focus and editing state for the merit-function table.
 *
 * Two selections live side by side, the way they do in a spreadsheet. Rows are
 * selected from the row-number column, by a press, a drag down it, Shift and
 * Ctrl, and row actions (delete, cut, duplicate) act on them. Cells are
 * selected by clicking, dragging, Shift and Ctrl on the cells themselves: one
 * focused cell, the rectangle from the anchor to it, and any cells added with
 * Ctrl. Clicking a cell clears the row selection, and selecting a row clears
 * the cells and the focus.
 *
 * The handlers a row is given never change identity. A merit function runs to
 * thousands of rows and the table is re-rendered whenever anything above it is:
 * a dock divider commits a size once per frame while it is dragged. Rows are
 * memoised so those renders cost nothing, but a memo only holds while the props
 * hold, and a handler rebuilt from state or from a caller's fresh arrow would
 * change every row's props and quietly undo it.
 *
 * So everything the handlers read that changes between renders is reached
 * through a ref, and the handlers themselves are built once. Reading at call
 * time is also the more correct of the two: a handler can never act on a
 * selection or an operand list that has moved on since it was built.
 *
 * `onKeyDown` is deliberately left out of that treatment. It belongs to the
 * table's own container rather than to any row, so rebuilding it costs one
 * element, and its dependencies say plainly what a key press reads.
 */
import { mathTargetInPercent } from '../../../../../utils/physics/optimizer.js';
import { commitEdit, startEdit } from './editModel.js';
import {
    cellKey, cellRange, navigationTarget, selectedCells, selectionAfterRowClick,
} from './selectionModel.js';
import { doKeyDown } from './tableKeyboard.js';

const { useState, useEffect, useMemo, useRef, useCallback } = React;

const NO_CELLS = new Set();

// `keepFocus` leaves keyboard focus where it is, for a click into a control
// that takes typing, such as a comment row's input.
function selectRow(ctx, id, shift, ctrl, keepFocus = false) {
    const { operands, anchor, onSelect, lastReported, tableRef, set } = ctx;
    set.selIds(previous => {
        const next = selectionAfterRowClick({ operands, previous, anchor, id, shift, ctrl });
        set.anchor(next.anchor);
        return next.selectedIds;
    });
    set.anchorCell(null);
    set.extraCells(NO_CELLS);
    set.focusCell(null);
    lastReported.current = id;
    onSelect(id);
    if (!keepFocus) tableRef.current?.focus();
}

function report(ctx, op) {
    ctx.lastReported.current = op.id;
    ctx.onSelect(op.id);
    ctx.tableRef.current?.focus();
}

// A plain click or an arrow: one cell, nothing else selected.
function focusAt(ctx, rowIdx, colKey) {
    const op = ctx.operands[rowIdx];
    if (!op) return;
    const cell = { rowIdx, colKey };
    ctx.set.focusCell(cell);
    ctx.set.anchorCell(cell);
    ctx.set.extraCells(NO_CELLS);
    ctx.set.selIds(NO_CELLS);
    report(ctx, op);
}

// Shift: the rectangle from the anchor grows to the cell.
function extendTo(ctx, rowIdx, colKey) {
    const op = ctx.operands[rowIdx];
    if (!op) return;
    if (!ctx.anchorCell) { focusAt(ctx, rowIdx, colKey); return; }
    ctx.set.focusCell({ rowIdx, colKey });
    ctx.set.selIds(NO_CELLS);
    report(ctx, op);
}

// Ctrl: what is selected stays, the cell joins or leaves it, and becomes the
// focus and the anchor for the next Shift.
function toggleCell(ctx, rowIdx, colKey) {
    const op = ctx.operands[rowIdx];
    if (!op) return;
    const kept = new Set(ctx.extraCells);
    for (const cell of selectedCells({ range: ctx.range, extraCells: [], focus: ctx.focusCell })) {
        kept.add(cellKey(cell.rowIdx, cell.colKey));
    }
    const key = cellKey(rowIdx, colKey);
    kept.has(key) ? kept.delete(key) : kept.add(key);
    const cell = { rowIdx, colKey };
    ctx.set.extraCells(kept);
    ctx.set.focusCell(cell);
    ctx.set.anchorCell(cell);
    ctx.set.selIds(NO_CELLS);
    report(ctx, op);
}

function collapseRange(ctx) {
    ctx.set.anchorCell(ctx.focusCell);
    ctx.set.extraCells(NO_CELLS);
}

function navigate(ctx, fromRowIdx, fromColKey, direction) {
    const target = navigationTarget(ctx.operands, fromRowIdx, fromColKey, direction);
    if (!target) return;
    if (target.focus) ctx.focusAt(target.rowIdx, target.colKey);
    else {
        const cell = { rowIdx: target.rowIdx, colKey: target.colKey };
        ctx.set.focusCell(cell);
        ctx.set.anchorCell(cell);
        ctx.set.extraCells(NO_CELLS);
    }
}

export function useMFTableSelection(props) {
    const { operands, selectedId, onSelect, onEdit, onEditMany, onDelete, onInsertAt, onDuplicate, onAdd } = props;
    const [selIds, setSelIds] = useState(() => selectedId ? new Set([selectedId]) : new Set());
    const [anchor, setAnchor] = useState(selectedId || null);
    const [focusCell, setFocusCell] = useState(null);
    const [anchorCell, setAnchorCell] = useState(null);
    const [extraCells, setExtraCells] = useState(NO_CELLS);
    const [editCell, setEditCell] = useState(null);
    const tableRef = useRef(null);
    const lastReported = useRef(selectedId);
    // What a held button is dragging over: 'rows' from the row-number column,
    // 'cells' from a cell, null when nothing is held.
    const dragging = useRef(null);

    useEffect(() => {
        if (selectedId == null || selectedId === lastReported.current) return;
        lastReported.current = selectedId;
        setSelIds(new Set([selectedId]));
        setAnchor(selectedId);
    }, [selectedId]);

    // A drag ends wherever the button is released, inside the table or not,
    // and a torn-off window has a document of its own.
    useEffect(() => {
        const doc = tableRef.current?.ownerDocument || document;
        const end = () => { dragging.current = null; };
        doc.addEventListener('mouseup', end);
        return () => doc.removeEventListener('mouseup', end);
    }, []);

    const range = useMemo(() => cellRange(anchorCell, focusCell), [anchorCell, focusCell]);

    // A math operand reads its reference by id, so the lookup is rebuilt only
    // when the operand list is, not on every render of a thousand-row table.
    const operandsById = useMemo(
        () => new Map(operands.map(op => [op.id, op])), [operands]);

    // The one thing the handlers below read; see the note at the top of the file.
    const live = useRef();
    live.current = { operands, anchor, onSelect, onEdit, operandsById, focusCell, anchorCell, extraCells, range };
    const set = useMemo(() => ({
        selIds: setSelIds, anchor: setAnchor, focusCell: setFocusCell,
        anchorCell: setAnchorCell, extraCells: setExtraCells,
    }), []);
    const context = useCallback(() => ({ ...live.current, lastReported, tableRef, set }), [set]);

    const isMathPct = useCallback(op => mathTargetInPercent(op, live.current.operandsById), []);

    // The window's own edit callback is rebuilt whenever the operand list is,
    // since it closes over that list. Every row is handed one, so passing it
    // through would change every row's props on each committed edit; reaching
    // it through the ref is what keeps the rows memoised.
    const handleEdit = useCallback(
        (id, key, value) => live.current.onEdit(id, key, value), []);

    const handleSelectRow = useCallback((id, shift, ctrl, keepFocus) =>
        selectRow(context(), id, shift, ctrl, keepFocus), [context]);
    const handleFocusAt = useCallback((rowIdx, colKey) => focusAt(context(), rowIdx, colKey), [context]);
    const handleExtendTo = useCallback((rowIdx, colKey) => extendTo(context(), rowIdx, colKey), [context]);
    const handleToggleCell = useCallback((rowIdx, colKey) => toggleCell(context(), rowIdx, colKey), [context]);
    const handleCollapseRange = useCallback(() => collapseRange(context()), [context]);
    const beginDrag = useCallback(mode => { dragging.current = mode; }, []);
    // A drag begun in the row-number column selects the run of rows from the
    // one pressed to the one under the pointer, whatever cell that is over; one
    // begun on a cell grows the rectangle. A header or comment row has no cells
    // and reports no column, so a cell drag passes over it unchanged.
    const dragOver = useCallback((rowIdx, colKey) => {
        const mode = dragging.current;
        if (mode === 'rows') {
            const op = live.current.operands[rowIdx];
            if (op) selectRow(context(), op.id, true, false);
        } else if (mode === 'cells' && colKey) {
            extendTo(context(), rowIdx, colKey);
        }
    }, [context]);

    const handleStartEdit = useCallback((rowIdx, colKey, initChar) => startEdit({
        operands: live.current.operands, onEdit: live.current.onEdit, isMathPct,
        setFocusCell, setEditCell,
    }, rowIdx, colKey, initChar), [isMathPct]);

    const handleCommitEdit = useCallback((rowIdx, colKey, draft) => commitEdit({
        operands: live.current.operands, onEdit: live.current.onEdit, setEditCell,
    }, rowIdx, colKey, draft), []);

    const handleNavigate = useCallback((rowIdx, colKey, direction) => navigate({
        ...context(), focusAt: handleFocusAt,
    }, rowIdx, colKey, direction), [context, handleFocusAt]);

    const onKeyDown = useCallback(event => doKeyDown({
        editCell, focusCell, selectedIds: selIds, operands, setSelIds, setFocusCell,
        range, extraCells, extendTo: handleExtendTo, collapseRange: handleCollapseRange,
        onDelete, onInsertAt, onDuplicate, onAdd, onEdit, onEditMany, focusAt: handleFocusAt,
        navigate: handleNavigate, startEdit: handleStartEdit,
        commitEdit: handleCommitEdit, isMathPct,
    }, event), [
        editCell, focusCell, selIds, operands, range, extraCells, onDelete, onAdd, onInsertAt,
        onDuplicate, onEdit, onEditMany, handleStartEdit, handleFocusAt, handleNavigate,
        handleCommitEdit, handleExtendTo, handleCollapseRange, isMathPct,
    ]);

    return {
        selIds, setSelIds, focusCell, setFocusCell, editCell, setEditCell, tableRef,
        range, extraCells,
        isMathPct, selectRow: handleSelectRow, focusAt: handleFocusAt,
        extendTo: handleExtendTo, toggleCell: handleToggleCell, beginDrag, dragOver,
        startEdit: handleStartEdit, commitEdit: handleCommitEdit,
        navigate: handleNavigate, onEdit: handleEdit, onKeyDown,
    };
}
