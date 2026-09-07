import { isBlank, isDmfs, isMath } from '../../../../../utils/physics/optimizer.js';
import { OperandTypePicker } from './OperandTypePicker.js';
import { editingCell, rowRenderers, textCell } from './OperandCells.js';
import { COLS, rowDisplayMeta, rowTintAlpha, typeRgba } from './operandViewModel.js';
import { ROW_H } from './rowWindow.js';

const { createElement: h, memo } = React;

function DmfsRowView({ op, rowIdx, rowSel, c, onEdit, selectRow }) {
    return h('tr', {
        'data-row': rowIdx,
        onClick: event => selectRow(op.id, event.shiftKey, event.ctrlKey || event.metaKey),
        style: {
            height: ROW_H, cursor: 'default',
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
        }, '▶ DMFS — ' + (op.comment || 'Default merit function')),
    );
}

function BlnkRowView({ op, rowIdx, rowSel, c, t, onEdit, selectRow, setFocusCell }) {
    // A click into the comment selects its row but leaves keyboard focus in the
    // input, so the comment can be typed; the focused cell is cleared so row
    // shortcuts act on this row.
    const selectForTyping = () => { selectRow(op.id, false, false, true); setFocusCell?.(null); };
    return h('tr', {
        'data-row': rowIdx,
        onClick: event => selectRow(op.id, event.shiftKey, event.ctrlKey || event.metaKey),
        style: {
            height: ROW_H, cursor: 'default',
            backgroundColor: rowSel ? c.accent + '66' : 'rgba(140,140,140,0.10)',
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
            style: { width: COLS[2].w, padding: '0 2px' },
            onClick: event => event.stopPropagation(),
        }, h(OperandTypePicker, {
            value: op.type,
            onChange: newType => onEdit(op.id, 'type', newType),
            c, t,
        })),
        h('td', {
            colSpan: COLS.length - 3,
            style: { padding: '1px 6px', borderLeft: '2px solid rgba(140,140,140,0.4)' },
        }, h('input', {
            value: op.comment || '',
            placeholder: '# comment…',
            'data-row-menu': 'comment',
            onChange: event => onEdit(op.id, 'comment', event.target.value),
            onClick: event => { event.stopPropagation(); selectForTyping(); },
            onFocus: selectForTyping,
            style: {
                width: '100%', background: 'transparent', color: c.textDim, border: 'none',
                fontSize: 11, fontStyle: 'italic', padding: '1px 2px',
                fontFamily: 'inherit', outline: 'none',
            },
        })),
    );
}

function MFDataRowView(props) {
    const {
        op, rowIdx, rawCur, bandLevel, contribution, largestContribution,
        evaluationError, rowSel, focusColKey, rowEdit,
        operands, integralPresets,
        isMathPct, c, t, onEdit, selectRow, focusAt, startEdit, commitEdit,
        navigate, setEditCell, setFocusCell,
    } = props;
    const meta = rowDisplayMeta(op, rawCur, isMath(op.type) && isMathPct(op), bandLevel);
    const rowBg = typeRgba(op.type, rowTintAlpha(c.light)) || 'transparent';
    const rowStripe = typeRgba(op.type, 0.75);

    const tdBase = (colKey, width, extra) => {
        const focused = focusColKey === colKey;
        return {
            width, padding: '0 4px',
            backgroundColor: focused ? c.accent + 'AA' : rowSel ? c.accent + '66' : rowBg,
            outline: focused ? `1px solid ${c.accent}` : 'none',
            outlineOffset: -1, cursor: 'default', userSelect: 'none',
            ...extra,
        };
    };

    const cellClick = (colKey, event) => {
        if (colKey === 'num') {
            event.preventDefault();
            selectRow(op.id, event.shiftKey, event.ctrlKey || event.metaKey);
            setFocusCell(null);
        } else if (event.shiftKey || event.ctrlKey || event.metaKey) {
            event.preventDefault();
            selectRow(op.id, event.shiftKey, event.ctrlKey || event.metaKey);
        } else {
            focusAt(rowIdx, colKey);
        }
    };

    const ctx = {
        op, rowIdx, meta, c, t, operands, integralPresets, rowStripe,
        contribution, largestContribution,
        editCell: rowEdit, evaluationError,
        tdBase, cellClick, onEdit, focusAt, selectRow, startEdit, commitEdit, navigate, setEditCell,
    };
    const renderers = rowRenderers(op, meta);
    return h('tr', {
        'data-row': rowIdx,
        title: evaluationError || undefined,
        'aria-invalid': evaluationError ? 'true' : undefined,
        style: { height: ROW_H, opacity: op.enabled ? 1 : 0.45 },
    },
        COLS.map(col => {
            let render = renderers[col.key];
            if (render === textCell && rowEdit?.colKey === col.key) {
                render = editingCell;
            }
            return render(ctx, col.key, col.w);
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
        computed, evaluationErrors, bandLevels, contributions, largestContribution,
        selIds, c, t, onEdit, selectRow,
    } = ctx;
    const rowSel = selIds.has(op.id);
    if (isDmfs(op.type)) return h(DmfsRow, { key: op.id, op, rowIdx, rowSel, c, onEdit, selectRow });
    if (isBlank(op.type)) {
        return h(BlnkRow, { key: op.id, op, rowIdx, rowSel, c, t, onEdit, selectRow, setFocusCell: ctx.setFocusCell });
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
        rowSel,
        // The focused column and the cell being edited are narrowed to this
        // row before they are handed over. Passing the table's own focus and
        // edit state would change every row's props on each arrow key, and no
        // row but the two involved has anything new to draw.
        focusColKey: ctx.focusCell?.rowIdx === rowIdx ? ctx.focusCell.colKey : null,
        rowEdit: ctx.editCell?.rowIdx === rowIdx ? ctx.editCell : null,
        operands: ctx.operands,
        integralPresets: ctx.integralPresets,
        isMathPct: ctx.isMathPct,
        c,
        t,
        onEdit,
        selectRow,
        focusAt: ctx.focusAt,
        startEdit: ctx.startEdit,
        commitEdit: ctx.commitEdit,
        navigate: ctx.navigate,
        setEditCell: ctx.setEditCell,
        setFocusCell: ctx.setFocusCell,
    });
}
