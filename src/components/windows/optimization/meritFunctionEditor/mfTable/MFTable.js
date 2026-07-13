import { mathTargetInPercent } from '../../../../../utils/physics/optimizer.js';
import { useIntegralPresets } from '../../../../../utils/physics/integralValues.js';
import { TblBtn } from './CellControls.js';
import { commitEdit, startEdit } from './editModel.js';
import { renderOperandRow } from './OperandRows.js';
import {
    COLS, TABLE_W, dynamicHeaderLabels,
} from './operandViewModel.js';
import { navigationTarget, selectionAfterRowClick } from './selectionModel.js';
import { doKeyDown } from './tableKeyboard.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

function pickHeaderOp(operands, focusCell, primarySelection) {
    if (focusCell && operands[focusCell.rowIdx]) return operands[focusCell.rowIdx];
    if (primarySelection) {
        const selected = operands.find(op => op.id === primarySelection);
        if (selected) return selected;
    }
    return operands[0] || null;
}

function computeInsertIndex(operands, selectedIds, focusCell) {
    let maxIndex = -1;
    operands.forEach((op, index) => {
        if (selectedIds.has(op.id) && index > maxIndex) maxIndex = index;
    });
    if (maxIndex < 0 && focusCell) maxIndex = focusCell.rowIdx;
    return maxIndex < 0 ? operands.length : maxIndex + 1;
}

function selectRow(ctx, id, shift, ctrl) {
    const { operands, anchor, onSelect, lastReported, tableRef, setSelIds, setAnchor } = ctx;
    setSelIds(previous => {
        const next = selectionAfterRowClick({ operands, previous, anchor, id, shift, ctrl });
        setAnchor(next.anchor);
        return next.selectedIds;
    });
    lastReported.current = id;
    onSelect(id);
    tableRef.current?.focus();
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

function useMFTableSelection(props) {
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

    const operandsById = useRef(new Map());
    operandsById.current = new Map(operands.map(op => [op.id, op]));
    const isMathPct = useCallback(op => mathTargetInPercent(op, operandsById.current), [operands]);

    const handleSelectRow = useCallback((id, shift, ctrl) => selectRow({
        operands, anchor, onSelect, lastReported, tableRef, setSelIds, setAnchor,
    }, id, shift, ctrl), [anchor, operands, onSelect]);

    const handleFocusAt = useCallback((rowIdx, colKey) => focusAt({
        operands, onSelect, lastReported, tableRef, setFocusCell, setSelIds, setAnchor,
    }, rowIdx, colKey), [operands, onSelect]);

    const handleStartEdit = useCallback((rowIdx, colKey, initChar) => startEdit({
        operands, onEdit, isMathPct, setFocusCell, setEditCell,
    }, rowIdx, colKey, initChar), [operands, onEdit, isMathPct]);

    const handleCommitEdit = useCallback((rowIdx, colKey, draft) => commitEdit({
        operands, onEdit, setEditCell,
    }, rowIdx, colKey, draft), [operands, onEdit]);

    const handleNavigate = useCallback((rowIdx, colKey, direction) => navigate({
        operands, focusAt: handleFocusAt, setFocusCell,
    }, rowIdx, colKey, direction), [operands, handleFocusAt]);

    const onKeyDown = useCallback(event => doKeyDown({
        editCell, focusCell, selectedIds: selIds, operands, setSelIds, setFocusCell,
        onDelete, onInsertAt, onDuplicate, onAdd, focusAt: handleFocusAt,
        navigate: handleNavigate, startEdit: handleStartEdit,
    }, event), [
        editCell, focusCell, selIds, operands, onDelete, onAdd, onInsertAt,
        onDuplicate, handleStartEdit, handleFocusAt, handleNavigate,
    ]);

    return {
        selIds, focusCell, setFocusCell, editCell, setEditCell, tableRef,
        isMathPct, selectRow: handleSelectRow, focusAt: handleFocusAt,
        startEdit: handleStartEdit, commitEdit: handleCommitEdit,
        navigate: handleNavigate, onKeyDown,
    };
}

function headerCell(col, dynamicLabels, style) {
    const label = col.key === 'lambdaStart' ? dynamicLabels.lambdaStart
        : col.key === 'lambdaEnd' ? dynamicLabels.lambdaEnd
        : col.label;
    return h('th', { key: col.key, style: { ...style, width: col.w } }, label);
}

export function MFTable(props) {
    const {
        operands, computed, selectedId, noOperandsMsg, onSelect, onEdit, onAdd, onInsertAt,
        onDuplicate, onDelete, onClear, onMoveUp, onMoveDown, showToolbar = true, c, t,
    } = props;
    const integralPresets = useIntegralPresets();
    const {
        selIds, focusCell, setFocusCell, editCell, setEditCell, tableRef,
        isMathPct, selectRow: handleSelectRow, focusAt: handleFocusAt,
        startEdit: handleStartEdit, commitEdit: handleCommitEdit,
        navigate: handleNavigate, onKeyDown,
    } = useMFTableSelection({
        operands, selectedId, onSelect, onEdit, onDelete, onInsertAt, onDuplicate, onAdd,
    });

    const thStyle = {
        padding: '2px 4px', textAlign: 'left', fontSize: 10,
        color: c.textDim, fontWeight: 600, letterSpacing: '0.03em',
        borderBottom: `1px solid ${c.border}`, userSelect: 'none',
        whiteSpace: 'nowrap', position: 'sticky', top: 0, background: c.panel, zIndex: 1,
    };
    const primarySel = selIds.size === 1 ? [...selIds][0] : null;
    const hasSelection = selIds.size > 0;
    const dynamicLabels = dynamicHeaderLabels(pickHeaderOp(operands, focusCell, primarySel));
    const rowContext = {
        computed, selIds, focusCell, editCell, operands, integralPresets, isMathPct, c, t,
        onEdit, selectRow: handleSelectRow, focusAt: handleFocusAt, startEdit: handleStartEdit,
        commitEdit: handleCommitEdit, navigate: handleNavigate, setEditCell, setFocusCell,
    };

    return h('div', {
        ref: tableRef,
        tabIndex: 0,
        onKeyDown,
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            overflow: 'hidden', outline: 'none',
        },
    },
        h('div', { style: { flex: 1, overflow: 'auto', minHeight: 0 } },
            h('table', {
                style: {
                    borderCollapse: 'collapse', tableLayout: 'fixed', width: TABLE_W,
                    fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                },
            },
                h('colgroup', null, COLS.map(col => h('col', { key: col.key, style: { width: col.w } }))),
                h('thead', null,
                    h('tr', null, COLS.map(col => headerCell(col, dynamicLabels, thStyle))),
                ),
                h('tbody', null,
                    operands.length === 0
                        ? h('tr', null, h('td', {
                            colSpan: COLS.length,
                            style: { padding: 16, textAlign: 'center', color: c.textDim, fontSize: 12 },
                        }, noOperandsMsg || 'No operands.'))
                        : operands.map((op, index) => renderOperandRow(rowContext, op, index)),
                ),
            ),
        ),
        showToolbar && h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px',
                borderTop: `1px solid ${c.border}`, background: c.panel, flexShrink: 0,
            },
        },
            h(TblBtn, {
                label: 'Add',
                onClick: () => onAdd(null, computeInsertIndex(operands, selIds, focusCell)),
                c,
            }),
            h(TblBtn, {
                label: 'Delete', onClick: () => onDelete([...selIds]), disabled: !hasSelection, c,
            }),
            h(TblBtn, { label: '↑', onClick: onMoveUp, disabled: !primarySel, c }),
            h(TblBtn, { label: '↓', onClick: onMoveDown, disabled: !primarySel, c }),
            onClear && h(TblBtn, {
                label: t?.meritFunctionEditor?.clearTable || 'Clear',
                onClick: () => onClear(), disabled: operands.length === 0, c,
                title: t?.meritFunctionEditor?.clearTableTip || 'Remove all operands from the table',
            }),
            selIds.size > 1 && h('span', {
                style: { fontSize: 10, color: c.textDim, marginLeft: 4 },
            }, `${selIds.size} selected`),
            h('span', {
                style: { fontSize: 10, color: c.textDim, marginLeft: 'auto' },
            }, 'Click=select  Shift/Ctrl+Click=multi  Del=delete  Ctrl+C/V=copy/paste  Enter/Tab=edit/nav'),
        ),
    );
}
