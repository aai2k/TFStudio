import { isBlank, isDmfs, isMath } from '../../../../../utils/physics/optimizer.js';
import { CellSelect, typeOptionEls } from './CellControls.js';
import { editingCell, rowRenderers, textCell } from './OperandCells.js';
import { COLS, deltaColor, rowDisplayMeta, typeRgba } from './operandViewModel.js';

const { createElement: h } = React;

export function DmfsRow({ op, rowIdx, rowSel, c, onEdit, selectRow }) {
    return h('tr', {
        onClick: event => selectRow(op.id, event.shiftKey, event.ctrlKey || event.metaKey),
        style: { cursor: 'default', backgroundColor: rowSel ? c.accent + '66' : c.accent + '12' },
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
            style: {
                padding: '2px 8px', fontStyle: 'italic', color: c.accent,
                fontSize: 11, borderLeft: `2px solid ${c.accent}50`,
            },
        }, '▶ DMFS — ' + (op.comment || 'Default merit function')),
    );
}

export function BlnkRow({ op, rowIdx, rowSel, c, t, onEdit, selectRow }) {
    return h('tr', {
        onClick: event => selectRow(op.id, event.shiftKey, event.ctrlKey || event.metaKey),
        style: { cursor: 'default', backgroundColor: rowSel ? c.accent + '66' : 'rgba(140,140,140,0.10)' },
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
        }, h(CellSelect, {
            value: op.type,
            onChange: event => onEdit(op.id, 'type', event.target.value),
            title: t?.meritFunctionEditor?.operandTypes?.[op.type]?.label || op.type,
            color: c.textDim,
        }, typeOptionEls(t, c))),
        h('td', {
            colSpan: COLS.length - 3,
            style: { padding: '1px 6px', borderLeft: '2px solid rgba(140,140,140,0.4)' },
        }, h('input', {
            value: op.comment || '',
            placeholder: '# comment…',
            onChange: event => onEdit(op.id, 'comment', event.target.value),
            onClick: event => event.stopPropagation(),
            style: {
                width: '100%', background: 'transparent', color: c.textDim, border: 'none',
                fontSize: 11, fontStyle: 'italic', padding: '1px 2px',
                fontFamily: 'inherit', outline: 'none',
            },
        })),
    );
}

export function MFDataRow(props) {
    const {
        op, rowIdx, rawCur, rowSel, focusCell, editCell, operands, integralPresets,
        isMathPct, c, t, onEdit, selectRow, focusAt, startEdit, commitEdit,
        navigate, setEditCell, setFocusCell,
    } = props;
    const meta = rowDisplayMeta(op, rawCur, isMath(op.type) && isMathPct(op));
    const dColor = deltaColor(op, meta.rawDelta, meta, c);
    const rowBg = typeRgba(op.type, 0.12) || 'transparent';
    const rowStripe = typeRgba(op.type, 0.75);

    const tdBase = (colKey, width, extra) => {
        const focused = focusCell?.rowIdx === rowIdx && focusCell?.colKey === colKey;
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
        op, rowIdx, meta, c, t, operands, integralPresets, dColor, rowStripe, editCell,
        tdBase, cellClick, onEdit, focusAt, selectRow, startEdit, commitEdit, navigate, setEditCell,
    };
    const renderers = rowRenderers(op, meta);
    return h('tr', { style: { opacity: op.enabled ? 1 : 0.45 } },
        COLS.map(col => {
            let render = renderers[col.key];
            if (render === textCell && editCell?.rowIdx === rowIdx && editCell?.colKey === col.key) {
                render = editingCell;
            }
            return render(ctx, col.key, col.w);
        }));
}

export function renderOperandRow(ctx, op, rowIdx) {
    const { computed, selIds, c, t, onEdit, selectRow } = ctx;
    const rowSel = selIds.has(op.id);
    if (isDmfs(op.type)) return h(DmfsRow, { key: op.id, op, rowIdx, rowSel, c, onEdit, selectRow });
    if (isBlank(op.type)) return h(BlnkRow, { key: op.id, op, rowIdx, rowSel, c, t, onEdit, selectRow });
    return h(MFDataRow, {
        key: op.id,
        op,
        rowIdx,
        rawCur: computed?.[rowIdx] != null ? computed[rowIdx] : null,
        rowSel,
        focusCell: ctx.focusCell,
        editCell: ctx.editCell,
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
