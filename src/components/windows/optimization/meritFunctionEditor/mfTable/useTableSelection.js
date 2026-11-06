/**
 * Selection, focus and editing state for the merit-function table.
 *
 * Two selections live side by side, the way they do in a spreadsheet. Rows are
 * selected from the row-number column, by a press, a drag down it, Shift and
 * Ctrl, and row actions (delete, cut, duplicate) act on them; with no row
 * selected, they take the rows holding the selected cells. Cells are
 * selected by clicking, dragging, Shift and Ctrl on the cells themselves: one
 * focused cell, the rectangle from the anchor to it, and any cells added with
 * Ctrl, held by the shared grid selection (ui/grid/useGridSelection.js).
 * Clicking a cell clears the row selection, and selecting a row clears the
 * cells and the focus. A header or comment row has no value cells, so an arrow
 * onto one selects it as a row.
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
import { NO_CELLS } from '../../../../ui/grid/gridModel.js';
import { useGridSelection } from '../../../../ui/grid/useGridSelection.js';
import { commitEdit, startEdit } from './editModel.js';
import {
    MF_GRID, ROW_HEADER, isHeaderOrComment, navigationTarget, selectionAfterRowClick,
} from './selectionModel.js';
import { doKeyDown } from './tableKeyboard.js';

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// `keepFocus` leaves keyboard focus where it is, for a click into a control
// that takes typing, such as a comment row's input.
function selectRow(ctx, id, shift, ctrl, keepFocus = false) {
    const { operands, anchor, onSelect, lastReported, cells, set } = ctx;
    set.selIds(previous => {
        const next = selectionAfterRowClick({ operands, previous, anchor, id, shift, ctrl });
        set.anchor(next.anchor);
        return next.selectedIds;
    });
    cells.clearCells();
    lastReported.current = id;
    onSelect(id);
    if (!keepFocus) cells.tableRef.current?.focus();
}

// The focus on a row number selects that whole row, and with Shift the rows
// from the anchor row to it, as a press and a Shift press down the row numbers
// do.
function selectFromRowHeader(ctx, op, alone) {
    const { operands, anchor, set } = ctx;
    set.selIds(previous => {
        const next = selectionAfterRowClick({ operands, previous, anchor, id: op.id, shift: !alone, ctrl: false });
        set.anchor(next.anchor);
        return next.selectedIds;
    });
}

// A cell was chosen: the row selection goes, and the operand is reported. The
// focus landing alone on a header or comment row, which has no value cells,
// selects that row too, as a click on it does, so it is drawn selected and the
// row keys act on it. The focus stays, so the next arrow keeps to its column.
function pickRow(ctx, rowIdx, alone, colKey) {
    const op = ctx.operands[rowIdx];
    if (colKey === ROW_HEADER) {
        selectFromRowHeader(ctx, op, alone);
    } else {
        const asRow = alone && isHeaderOrComment(op);
        ctx.set.selIds(asRow ? new Set([op.id]) : NO_CELLS);
        if (asRow) ctx.set.anchor(op.id);
    }
    ctx.lastReported.current = op.id;
    ctx.onSelect(op.id);
    ctx.cells.tableRef.current?.focus();
}

function navigate(ctx, fromRowIdx, fromColKey, direction) {
    const target = navigationTarget(ctx.operands, fromRowIdx, fromColKey, direction);
    if (!target) return;
    if (target.focus) ctx.cells.focusAt(target.rowIdx, target.colKey);
    else ctx.cells.place(target.rowIdx, target.colKey);
}

// Up, Down and Escape in a comment's input close it and give the keys back to
// the table: the focus goes `step` rows up or down, or stays on the comment's
// own row for Escape. It keeps the column the keys came in by; after a click
// into the comment there is none, and it takes Type, as the keys do from any
// row selected with a click.
function leaveComment(ctx, rowIdx, step) {
    const target = Math.min(Math.max(rowIdx + step, 0), ctx.operands.length - 1);
    ctx.set.editCell(null);
    ctx.cells.focusAt(target, ctx.cells.focusCell?.colKey ?? 'type');
}

export function useMFTableSelection(props) {
    const {
        operands, integralPresets, selectedId, onSelect, onEdit, onEditMany, onDelete, onInsertAt, onDuplicate, onAdd,
    } = props;
    const [selIds, setSelIds] = useState(() => selectedId ? new Set([selectedId]) : new Set());
    const [anchor, setAnchor] = useState(selectedId || null);
    const [editCell, setEditCell] = useState(null);
    const lastReported = useRef(selectedId);

    useEffect(() => {
        if (selectedId == null || selectedId === lastReported.current) return;
        lastReported.current = selectedId;
        setSelIds(new Set([selectedId]));
        setAnchor(selectedId);
    }, [selectedId]);

    // A math operand reads its reference by id, so the lookup is rebuilt only
    // when the operand list is, not on every render of a thousand-row table.
    const operandsById = useMemo(
        () => new Map(operands.map(op => [op.id, op])), [operands]);

    // The one thing the handlers below read; see the note at the top of the file.
    const live = useRef();
    const set = useMemo(() => ({ selIds: setSelIds, anchor: setAnchor, editCell: setEditCell }), []);
    const context = useCallback(() => ({ ...live.current, lastReported, set }), [set]);
    const cells = useGridSelection(MF_GRID, {
        hasRow: rowIdx => !!live.current.operands[rowIdx],
        onPick: (rowIdx, alone, colKey) => pickRow(context(), rowIdx, alone, colKey),
        onRowDrag: (rowIdx) => {
            const op = live.current.operands[rowIdx];
            if (op) selectRow(context(), op.id, true, false);
        },
    });
    live.current = { operands, integralPresets, anchor, onSelect, onEdit, operandsById, cells };
    const { focusCell, setFocusCell, extraCells, range, tableRef } = cells;

    // Delete and Cut take the focused cell's row with them. The focus then goes
    // to the cell in the same column of the row that takes the first removed
    // row's place, the last row when there is none below, so the keys keep
    // working without a click. It is placed once the shorter list has arrived,
    // since placing it reports its row to the window.
    const refocus = useRef(null);
    const focusAfterRemoval = useCallback((rowIdx, colKey) => { refocus.current = { rowIdx, colKey }; }, []);
    useEffect(() => {
        const target = refocus.current;
        refocus.current = null;
        if (target && operands.length > 0) cells.focusAt(Math.min(target.rowIdx, operands.length - 1), target.colKey);
    }, [operands, cells.focusAt]);

    const isMathPct = useCallback(op => mathTargetInPercent(op, live.current.operandsById), []);

    // The window's own edit callback is rebuilt whenever the operand list is,
    // since it closes over that list. Every row is handed one, so passing it
    // through would change every row's props on each committed edit; reaching
    // it through the ref is what keeps the rows memoised.
    const handleEdit = useCallback(
        (id, key, value) => live.current.onEdit(id, key, value), []);

    const handleSelectRow = useCallback((id, shift, ctrl, keepFocus) =>
        selectRow(context(), id, shift, ctrl, keepFocus), [context]);

    const handleStartEdit = useCallback((rowIdx, colKey, initChar) => startEdit({
        operands: live.current.operands, onEdit: live.current.onEdit, isMathPct,
        setFocusCell, setEditCell,
    }, rowIdx, colKey, initChar), [isMathPct, setFocusCell]);

    const handleCommitEdit = useCallback((rowIdx, colKey, draft) => commitEdit({
        operands: live.current.operands, integralPresets: live.current.integralPresets,
        onEdit: live.current.onEdit, setEditCell,
    }, rowIdx, colKey, draft), []);

    const handleNavigate = useCallback((rowIdx, colKey, direction) =>
        navigate(context(), rowIdx, colKey, direction), [context]);

    const handleLeaveComment = useCallback((rowIdx, step) =>
        leaveComment(context(), rowIdx, step), [context]);

    const onKeyDown = useCallback(event => doKeyDown({
        editCell, setEditCell, focusCell, selectedIds: selIds, operands, integralPresets, setSelIds,
        range, extraCells, extendTo: cells.extendTo, collapseRange: cells.collapseRange,
        clearCells: cells.clearCells, focusAfterRemoval,
        onDelete, onInsertAt, onDuplicate, onAdd, onEdit, onEditMany, focusAt: cells.focusAt,
        navigate: handleNavigate, startEdit: handleStartEdit,
        commitEdit: handleCommitEdit, isMathPct,
    }, event), [
        editCell, focusCell, selIds, operands, integralPresets, range, extraCells, onDelete, onAdd, onInsertAt,
        onDuplicate, onEdit, onEditMany, handleStartEdit, handleNavigate,
        handleCommitEdit, cells.extendTo, cells.collapseRange, cells.clearCells, cells.focusAt, isMathPct,
        focusAfterRemoval,
    ]);

    return {
        selIds, setSelIds, focusCell, setFocusCell, editCell, setEditCell, tableRef,
        range, extraCells, clearCells: cells.clearCells, focusAfterRemoval,
        isMathPct, selectRow: handleSelectRow, focusAt: cells.focusAt,
        extendTo: cells.extendTo, toggleCell: cells.toggleCell, pressCell: cells.pressCell,
        beginDrag: cells.beginDrag, dragOver: cells.dragOver,
        startEdit: handleStartEdit, commitEdit: handleCommitEdit,
        navigate: handleNavigate, leaveComment: handleLeaveComment, onEdit: handleEdit, onKeyDown,
    };
}
