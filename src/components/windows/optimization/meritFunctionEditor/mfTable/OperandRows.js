import { isBlank, isDmfs, isMath } from '../../../../../utils/physics/optimizer.js';
import { OperandTypePicker } from './OperandTypePicker.js';
import {
    editingCell, listValueCell, listValuePickerCell, polPickerCell, polarizationCell,
    rowRenderers, textCell, typeCell, typePickerCell,
} from './OperandCells.js';
import { COLS, rowDisplayMeta, rowTintAlpha, typeRgba } from './operandViewModel.js';
import { ROW_HEADER, selectedColumnsForRow } from './selectionModel.js';
import { ROW_H } from './rowWindow.js';
import { isTextControl } from '../../../../ui/grid/gridKeys.js';

const { createElement: h, memo, useEffect, useRef } = React;

// The press that selects a row: from the row-number column of a data row, or
// anywhere on a header or comment row, which has no cells of its own. Shift
// extends the selection and Ctrl toggles the row; a plain press selects it and
// starts a drag that selects the rows the pointer crosses. A press in a
// control that takes typing, the comment's input, is left to the control.
function rowPress(op, selectRow, beginDrag) {
    return event => {
        if (event.button !== 0 || isTextControl(event.target)) return;
        event.preventDefault();
        const ctrl = event.ctrlKey || event.metaKey;
        selectRow(op.id, event.shiftKey, ctrl);
        if (!event.shiftKey && !ctrl) beginDrag('rows');
    };
}

function DmfsRowView({ op, rowIdx, rowSel, c, t, onEdit, selectRow, beginDrag, dragOver }) {
    return h('tr', {
        'data-row': rowIdx,
        onMouseDown: rowPress(op, selectRow, beginDrag),
        onMouseEnter: () => dragOver(rowIdx, null),
        style: {
            height: ROW_H, cursor: 'default', userSelect: 'none',
            backgroundColor: rowSel ? c.accent + '66' : c.accent + '12',
        },
    },
        h('td', {
            style: {
                width: COLS[0].w, padding: '0 4px', textAlign: 'center',
                color: c.textDim, userSelect: 'none', fontSize: 11,
            },
        }, rowIdx + 1),
        h('td', {
            style: {
                width: COLS[1].w, padding: '0 4px', textAlign: 'center', cursor: 'pointer',
                color: op.enabled ? c.accent : c.textDim, userSelect: 'none', fontSize: 11,
            },
            onClick: event => { event.stopPropagation(); onEdit(op.id, 'enabled', !op.enabled); },
        }, op.enabled ? '✓' : '○'),
        h('td', {
            colSpan: COLS.length - 2,
            // A wizard-generated header names every band, the angle range and
            // the target mode, which is wider than the columns it spans. It is
            // cut short rather than wrapped: the row is placed from its index,
            // so a second line would put every row below it out of step.
            title: op.comment || undefined,
            style: {
                padding: '2px 8px', fontStyle: 'italic', color: c.accent,
                fontSize: 11, borderLeft: `2px solid ${c.accent}50`,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            },
        }, '▶ DMFS: ' + (op.comment || t.meritFunctionEditor.defaultDmfs)),
    );
}

// Up and Down leave a comment for the row above or below, as they leave a
// cell's editor, and Escape for the table on the comment's own row, with the
// comment as typed. Every other key, Left and Right included, stays in the text.
const COMMENT_EXITS = { ArrowUp: -1, ArrowDown: 1, Escape: 0 };

function commentKeyDown(rowIdx, leaveComment) {
    return event => {
        const step = COMMENT_EXITS[event.key];
        if (step === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        leaveComment(rowIdx, step);
    };
}

// A focused cell of a comment row is outlined, as a data row's is.
function commentRowFocus(c) {
    return { outline: `1px solid ${c.accent}`, outlineOffset: -1 };
}

// The operand code as text, as on a data row: a press focuses it, and Enter, a
// double-click or a typed letter opens the picker in it with that letter in its
// search box. While the picker is open the cell takes no press of its own: a
// click in the picker's list must not move the focus off the search box.
function commentRowTypeCell(props, picking) {
    const { op, rowIdx, focusColKey, rowEdit, c, t, onEdit, pressCell, startEdit, setEditCell } = props;
    const focused = !picking && focusColKey === 'type';
    return h('td', {
        onMouseDown: picking ? undefined : event => { event.stopPropagation(); pressCell(rowIdx, 'type', event); },
        onDoubleClick: () => startEdit(rowIdx, 'type', null),
        style: {
            width: COLS[2].w, padding: picking ? '0 2px' : '0 4px', color: c.text, fontWeight: 500, userSelect: 'none',
            ...(focused ? { ...commentRowFocus(c), backgroundColor: c.accent + 'AA' } : null),
        },
    }, picking
        ? h(OperandTypePicker, {
            value: op.type,
            onChange: newType => onEdit(op.id, 'type', newType),
            autoOpen: true, initialQuery: rowEdit.initValue || '', onClose: () => setEditCell(null),
            c, t,
        })
        : op.type);
}

// The comment, which spans every column right of Type, so the focus on any of
// them is on the comment.
function commentCell(props, editing, inputRef) {
    const { op, rowIdx, focusColKey, c, t, onEdit, selectRow, setEditCell, leaveComment } = props;
    // A click into the comment selects its row but leaves keyboard focus in the
    // input, so the comment can be typed.
    const selectForTyping = () => selectRow(op.id, false, false, true);
    const focused = !editing && focusColKey != null && focusColKey !== 'type' && focusColKey !== ROW_HEADER;
    return h('td', {
        colSpan: COLS.length - 3,
        style: {
            padding: '1px 6px', borderLeft: '2px solid rgba(140,140,140,0.4)',
            ...(focused ? commentRowFocus(c) : null),
        },
    }, h('input', {
        ref: inputRef,
        value: op.comment || '',
        placeholder: t.meritFunctionEditor.commentPlaceholder,
        'data-row-menu': 'comment',
        onChange: event => onEdit(op.id, 'comment', event.target.value),
        onClick: event => { event.stopPropagation(); selectForTyping(); },
        onFocus: editing ? undefined : selectForTyping,
        onBlur: editing ? () => setEditCell(null) : undefined,
        onKeyDown: commentKeyDown(rowIdx, leaveComment),
        style: {
            width: '100%', background: 'transparent', color: c.textDim, border: 'none',
            fontSize: 11, fontStyle: 'italic', padding: '1px 2px',
            fontFamily: 'inherit', outline: 'none', userSelect: 'text',
        },
    }));
}

// A comment row: its Type and its comment. It is never scored, so it has no
// on/off mark, and the column is left empty.
function BlnkRowView(props) {
    const { op, rowIdx, rowSel, rowEdit, c, selectRow, beginDrag, dragOver } = props;
    const picking = rowEdit?.colKey === 'type';
    const editing = rowEdit?.colKey === 'comment';
    // Opened by a key typed on the row, the comment takes the focus with the
    // caret after that key, so the next key adds to it. Its row is already
    // selected then, and the focused column is kept for Up and Down to leave
    // by, so the focus arriving selects nothing. A click elsewhere closes it,
    // as leaving by the keys does.
    const inputRef = useRef(null);
    useEffect(() => {
        if (!editing) return;
        const input = inputRef.current;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }, [editing]);
    return h('tr', {
        'data-row': rowIdx,
        onMouseDown: picking ? undefined : rowPress(op, selectRow, beginDrag),
        onMouseEnter: () => dragOver(rowIdx, null),
        style: {
            height: ROW_H, cursor: 'default', userSelect: 'none',
            backgroundColor: rowSel ? c.accent + '66' : 'rgba(140,140,140,0.10)',
        },
    },
        h('td', {
            style: {
                width: COLS[0].w, padding: '0 4px', textAlign: 'center',
                color: c.textDim, userSelect: 'none', fontSize: 11,
            },
        }, rowIdx + 1),
        h('td', { style: { width: COLS[1].w, padding: '0 4px' } }),
        commentRowTypeCell(props, picking),
        commentCell(props, editing, inputRef),
    );
}

// The cells that open an editor of their own, each with what it is drawn as
// while that editor is open.
const CELL_EDITORS = new Map([
    [textCell, editingCell],
    [typeCell, typePickerCell],
    [polarizationCell, polPickerCell],
    [listValueCell, listValuePickerCell],
]);

function MFDataRowView(props) {
    const {
        op, rowIdx, rawCur, bandLevel, contribution, largestContribution,
        evaluationError, provisional, shareProvisional, rowSel, focusColKey, selectedCols, rowEdit,
        operands, integralPresets,
        isMathPct, c, t, onEdit, selectRow, focusAt, pressCell, beginDrag, dragOver,
        startEdit, commitEdit, navigate, setEditCell,
    } = props;
    const meta = rowDisplayMeta(op, rawCur, isMath(op.type) && isMathPct(op), bandLevel, t?.units);
    const rowBg = typeRgba(op.type, rowTintAlpha(c.light)) || 'transparent';
    const rowStripe = typeRgba(op.type, 0.75);

    const tdBase = (colKey, width, extra) => {
        const focused = focusColKey === colKey;
        const selected = !!selectedCols && selectedCols.includes(colKey);
        return {
            width, padding: '0 4px',
            backgroundColor: focused ? c.accent + 'AA' : selected ? c.accent + '55' : rowSel ? c.accent + '66' : rowBg,
            outline: focused ? `1px solid ${c.accent}` : 'none',
            outlineOffset: -1, cursor: 'default', userSelect: 'none',
            ...extra,
        };
    };

    // The row-number column selects rows and starts a drag over rows; a
    // header or comment row entered by that drag joins the run too.
    const rowDown = rowPress(op, selectRow, beginDrag);
    const rowEnter = () => dragOver(rowIdx, null);

    // Current and % of MF² show results and take no part in a cell selection;
    // a click on one only focuses it.
    const cellClick = colKey => focusAt(rowIdx, colKey);

    // Value cells select like spreadsheet cells; see useGridSelection.js.
    const cellDown = (colKey, event) => pressCell(rowIdx, colKey, event);
    const cellEnter = colKey => dragOver(rowIdx, colKey);

    const ctx = {
        op, rowIdx, meta, c, t, operands, integralPresets, rowStripe,
        contribution, largestContribution,
        editCell: rowEdit, evaluationError, provisional, shareProvisional, focusColKey,
        tdBase, rowDown, rowEnter, cellClick, cellDown, cellEnter, onEdit, focusAt, selectRow,
        startEdit, commitEdit, navigate, setEditCell,
    };
    const renderers = rowRenderers(op, meta);
    return h('tr', {
        'data-row': rowIdx,
        title: evaluationError || undefined,
        'aria-invalid': evaluationError ? 'true' : undefined,
        style: { height: ROW_H, opacity: op.enabled ? 1 : 0.45 },
    },
        COLS.map(col => {
            const render = renderers[col.key];
            const editor = rowEdit?.colKey === col.key && CELL_EDITORS.get(render);
            return (editor || render)(ctx, col.key, col.w);
        }));
}

/**
 * A row is drawn again only when something it shows has changed.
 *
 * A merit function runs to hundreds of rows, and a dock divider commits a size
 * once per frame while it is dragged, so the table is asked to render at 60 Hz
 * with nothing about any row different. Every value a row reads is either a
 * number, a flag, or a reference held steady between renders, so the shallow
 * comparison holds and a resize costs no row work at all.
 */
const DmfsRow = memo(DmfsRowView);
const BlnkRow = memo(BlnkRowView);
const MFDataRow = memo(MFDataRowView);

export function renderOperandRow(ctx, op, rowIdx) {
    const {
        computed, evaluationErrors, bandLevels, provisional, contributions, largestContribution,
        selIds, c, t, onEdit, selectRow,
    } = ctx;
    const rowSel = selIds.has(op.id);
    const { beginDrag, dragOver } = ctx;
    if (isDmfs(op.type)) {
        return h(DmfsRow, { key: op.id, op, rowIdx, rowSel, c, t, onEdit, selectRow, beginDrag, dragOver });
    }
    if (isBlank(op.type)) {
        return h(BlnkRow, {
            key: op.id, op, rowIdx, rowSel, c, t, onEdit, selectRow, beginDrag, dragOver,
            // Narrowed to this row, as a data row's are; see below.
            focusColKey: ctx.focusCell?.rowIdx === rowIdx ? ctx.focusCell.colKey : null,
            rowEdit: ctx.editCell?.rowIdx === rowIdx ? ctx.editCell : null,
            pressCell: ctx.pressCell, startEdit: ctx.startEdit,
            setEditCell: ctx.setEditCell, leaveComment: ctx.leaveComment,
        });
    }
    return h(MFDataRow, {
        key: op.id,
        op,
        rowIdx,
        rawCur: computed?.[rowIdx] != null ? computed[rowIdx] : null,
        bandLevel: bandLevels?.[rowIdx] ?? null,
        contribution: contributions?.[rowIdx] ?? null,
        largestContribution,
        evaluationError: evaluationErrors?.[rowIdx] || null,
        provisional: !!provisional?.[rowIdx] && !evaluationErrors?.[rowIdx],
        shareProvisional: ctx.shareProvisional && contributions?.[rowIdx] != null,
        rowSel,
        // The focused column, the selected columns and the cell being edited
        // are narrowed to this row before they are handed over. Passing the
        // table's own focus and selection state would change every row's props
        // on each arrow key, and no row but the ones involved has anything new
        // to draw.
        focusColKey: ctx.focusCell?.rowIdx === rowIdx ? ctx.focusCell.colKey : null,
        selectedCols: selectedColumnsForRow(ctx, rowIdx),
        rowEdit: ctx.editCell?.rowIdx === rowIdx ? ctx.editCell : null,
        operands: ctx.operands,
        integralPresets: ctx.integralPresets,
        isMathPct: ctx.isMathPct,
        c,
        t,
        onEdit,
        selectRow,
        focusAt: ctx.focusAt,
        pressCell: ctx.pressCell,
        beginDrag,
        dragOver,
        startEdit: ctx.startEdit,
        commitEdit: ctx.commitEdit,
        navigate: ctx.navigate,
        setEditCell: ctx.setEditCell,
    });
}
