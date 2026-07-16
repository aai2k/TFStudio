import { MaterialPicker } from '../../../ui/MaterialPicker.js';

const { createElement: h } = React;

function symbolName({ row, nameColor, unassigned, c, sf, onEdit }) {
    return row.fixed
        ? h('div', { style: { width: 54, flexShrink: 0,
            fontFamily: 'ui-monospace, Consolas, monospace',
            fontSize: 14, fontWeight: 600, color: nameColor } }, row.sym)
        : h('input', {
            type: 'text', value: row.sym, placeholder: sf.symPlaceholder,
            onChange: onEdit,
            style: { width: 54, flexShrink: 0, boxSizing: 'border-box',
                fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13,
                fontWeight: 600, padding: '4px 5px', textAlign: 'center',
                backgroundColor: c.bg, color: nameColor,
                border: `1px solid ${unassigned ? (c.warning || '#ef5350') : c.border}`,
                borderRadius: 3, outline: 'none' } });
}

export function SymbolRow({ row, idx, unassigned, c, t, sf, setRowMat, setRowSym, removeRow }) {
    const nameColor = unassigned ? (c.warning || '#ef5350') : c.text;
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        symbolName({ row, nameColor, unassigned, c, sf, onEdit: (e) => setRowSym(idx, e.target.value.trim()) }),
        h('div', { style: { flex: 1, minWidth: 0 } },
            h(MaterialPicker, { value: row.matId || '', onChange: (v) => setRowMat(idx, v), c, t })),
        row.fixed
            ? h('div', { style: { width: 22, flexShrink: 0 } })
            : h('button', {
                onClick: () => removeRow(idx), title: sf.removeSymbol,
                style: { width: 22, height: 22, flexShrink: 0, cursor: 'pointer',
                    background: 'transparent', color: c.textDim,
                    border: 'none', fontSize: 15, lineHeight: 1, outline: 'none' } }, '×'),
    );
}
