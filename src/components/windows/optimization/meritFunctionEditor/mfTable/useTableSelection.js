/**
 * Selection, focus and editing state for the merit-function table.
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
import { navigationTarget, selectionAfterRowClick } from './selectionModel.js';
import { doKeyDown } from './tableKeyboard.js';

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// `keepFocus` leaves keyboard focus where it is, for a click into a control
// that takes typing, such as a comment row's input.
function selectRow(ctx, id, shift, ctrl, keepFocus = false) {
    const { operands, anchor, onSelect, lastReported, tableRef, setSelIds, setAnchor } = ctx;
    setSelIds(previous => {
        const next = selectionAfterRowClick({ operands, previous, anchor, id, shift, ctrl });
        setAnchor(next.anchor);
        return next.selectedIds;
    });
    lastReported.current = id;
    onSelect(id);
    if (!keepFocus) tableRef.current?.focus();
}

function focusAt(ctx, rowIdx, colKey) {
    const { operands, onSelect, lastReported, tableRef, setFocusCell, setSelIds, setAnchor } = ctx;
    const op = operands[rowIdx];
    if (!op) return;
    setFocusCell({ rowIdx, colKey });
    setSelIds(new Set([op.id]));
    setAnchor(op.id);
    lastReported.current = op.id;
    onSelect(op.id);
    tableRef.current?.focus();
}

function navigate(ctx, fromRowIdx, fromColKey, direction) {
    const target = navigationTarget(ctx.operands, fromRowIdx, fromColKey, direction);
    if (!target) return;
    if (target.focus) ctx.focusAt(target.rowIdx, target.colKey);
    else ctx.setFocusCell({ rowIdx: target.rowIdx, colKey: target.colKey });
}

export function useMFTableSelection(props) {
    const { operands, selectedId, onSelect, onEdit, onDelete, onInsertAt, onDuplicate, onAdd } = props;
    const [selIds, setSelIds] = useState(() => selectedId ? new Set([selectedId]) : new Set());
    const [anchor, setAnchor] = useState(selectedId || null);
    const [focusCell, setFocusCell] = useState(null);
    const [editCell, setEditCell] = useState(null);
    const tableRef = useRef(null);
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
    live.current = { operands, anchor, onSelect, onEdit, operandsById };

    const isMathPct = useCallback(op => mathTargetInPercent(op, live.current.operandsById), []);

    const handleSelectRow = useCallback((id, shift, ctrl, keepFocus) => selectRow({
        operands: live.current.operands, anchor: live.current.anchor,
        onSelect: live.current.onSelect, lastReported, tableRef, setSelIds, setAnchor,
    }, id, shift, ctrl, keepFocus), []);

    const handleFocusAt = useCallback((rowIdx, colKey) => focusAt({
        operands: live.current.operands, onSelect: live.current.onSelect,
        lastReported, tableRef, setFocusCell, setSelIds, setAnchor,
    }, rowIdx, colKey), []);

    const handleStartEdit = useCallback((rowIdx, colKey, initChar) => startEdit({
        operands: live.current.operands, onEdit: live.current.onEdit, isMathPct,
        setFocusCell, setEditCell,
    }, rowIdx, colKey, initChar), [isMathPct]);

    const handleCommitEdit = useCallback((rowIdx, colKey, draft) => commitEdit({
        operands: live.current.operands, onEdit: live.current.onEdit, setEditCell,
    }, rowIdx, colKey, draft), []);

    const handleNavigate = useCallback((rowIdx, colKey, direction) => navigate({
        operands: live.current.operands, focusAt: handleFocusAt, setFocusCell,
    }, rowIdx, colKey, direction), [handleFocusAt]);

    const onKeyDown = useCallback(event => doKeyDown({
        editCell, focusCell, selectedIds: selIds, operands, setSelIds, setFocusCell,
        onDelete, onInsertAt, onDuplicate, onAdd, focusAt: handleFocusAt,
        navigate: handleNavigate, startEdit: handleStartEdit,
        commitEdit: handleCommitEdit, isMathPct,
    }, event), [
        editCell, focusCell, selIds, operands, onDelete, onAdd, onInsertAt,
        onDuplicate, handleStartEdit, handleFocusAt, handleNavigate, handleCommitEdit, isMathPct,
    ]);

    return {
        selIds, focusCell, setFocusCell, editCell, setEditCell, tableRef,
        isMathPct, selectRow: handleSelectRow, focusAt: handleFocusAt,
        startEdit: handleStartEdit, commitEdit: handleCommitEdit,
        navigate: handleNavigate, onKeyDown,
    };
}
