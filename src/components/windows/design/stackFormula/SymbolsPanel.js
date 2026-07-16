import { SymbolRow } from './SymbolRow.js';

const { createElement: h } = React;

// Symbols (always shown — assign H/L/M and add your own).
export function SymbolsPanel({ state, c, t, sf }) {
    const { symRows, usedSyms, setRowMat, setRowSym, addRow, removeRow } = state;
    return h('div', { style: { marginTop: 4 } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 } },
            h('div', { style: { fontSize: 11, fontWeight: 600, color: c.text } }, sf.symbolsHeader),
            h('button', {
                onClick: addRow,
                title: sf.addSymbolTip,
                style: { fontSize: 11, padding: '2px 8px', cursor: 'pointer',
                         backgroundColor: c.bg, color: c.text,
                         border: `1px solid ${c.border}`, borderRadius: 3 }
            }, sf.addSymbol),
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
            symRows.map((row, idx) => {
                const used = row.sym && usedSyms.has(row.sym);
                const unassigned = used && !row.matId;
                return h(SymbolRow, {
                    key: idx, row, idx, unassigned, c, t, sf,
                    setRowMat, setRowSym, removeRow,
                });
            })
        ),
        h('div', { style: { fontSize: 10.5, color: c.textDim, marginTop: 5, opacity: 0.85 } },
            sf.symbolsHint),
    );
}
