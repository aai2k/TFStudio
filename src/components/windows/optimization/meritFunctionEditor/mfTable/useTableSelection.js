/**
 * Selection, focus and editing state for the merit-function table.
 *
 * Two selections live side by side, the way they do in a spreadsheet. Rows are
 * selected from the row-number column, by a press, a drag down it, Shift and
 * Ctrl, and row actions (delete, cut, duplicate) act on them. Cells are
 * selected by clicking, dragging, Shift and Ctrl on the cells themselves: one
 * focused cell, the rectangle from the anchor to it, and any cells added with
 * Ctrl, held by the shared grid selection (ui/grid/useGridSelection.js).
 * Clicking a cell clears the row selection, and selecting a row clears the
 * cells and the focus.
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
import { MF_GRID, navigationTarget, selectionAfterRowClick } from './selectionModel.js';
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

// A cell was chosen: the row selection goes, and the operand is reported.
function pickRow(ctx, rowIdx) {
    const op = ctx.operands[rowIdx];
    ctx.set.selIds(NO_CELLS);
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

export function useMFTableSelection(props) {
    const { operands, selectedId, onSelect, onEdit, onEditMany, onDelete, onInsertAt, onDuplicate, onAdd } = props;
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
    const set = useMemo(() => ({ selIds: setSelIds, anchor: setAnchor }), []);
    const context = useCallback(() => ({ ...live.current, lastReported, set }), [set]);
    const cells = useGridSelection(MF_GRID, {
        hasRow: rowIdx => !!live.current.operands[rowIdx],
        onPick: rowIdx => pickRow(context(), rowIdx),
        onRowDrag: (rowIdx) => {
            const op = live.current.operands[rowIdx];
            if (op) selectRow(context(), op.id, true, false);
        },
    });
    live.current = { operands, anchor, onSelect, onEdit, operandsById, cells };
    const { focusCell, setFocusCell, extraCells, range, tableRef } = cells;

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
        operands: live.current.operands, onEdit: live.current.onEdit, setEditCell,
    }, rowIdx, colKey, draft), []);

    const handleNavigate = useCallback((rowIdx, colKey, direction) =>
        navigate(context(), rowIdx, colKey, direction), [context]);

    const onKeyDown = useCallback(event => doKeyDown({
        editCell, focusCell, selectedIds: selIds, operands, setSelIds, setFocusCell,
        range, extraCells, extendTo: cells.extendTo, collapseRange: cells.collapseRange,
        onDelete, onInsertAt, onDuplicate, onAdd, onEdit, onEditMany, focusAt: cells.focusAt,
        navigate: handleNavigate, startEdit: handleStartEdit,
        commitEdit: handleCommitEdit, isMathPct,
    }, event), [
        editCell, focusCell, selIds, operands, range, extraCells, onDelete, onAdd, onInsertAt,
        onDuplicate, onEdit, onEditMany, handleStartEdit, handleNavigate, setFocusCell,
        handleCommitEdit, cells.extendTo, cells.collapseRange, cells.focusAt, isMathPct,
    ]);

    return {
        selIds, setSelIds, focusCell, setFocusCell, editCell, setEditCell, tableRef,
        range, extraCells,
        isMathPct, selectRow: handleSelectRow, focusAt: cells.focusAt,
        extendTo: cells.extendTo, toggleCell: cells.toggleCell, pressCell: cells.pressCell,
        beginDrag: cells.beginDrag, dragOver: cells.dragOver,
        startEdit: handleStartEdit, commitEdit: handleCommitEdit,
        navigate: handleNavigate, onEdit: handleEdit, onKeyDown,
    };
}
