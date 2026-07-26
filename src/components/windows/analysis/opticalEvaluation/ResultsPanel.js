import { DataTable } from './DataTable.js';

const { createElement: h } = React;

export function ResultsPanel({ data, showCurves, showTable, setShowTable, c, oe }) {
    const rowCount = data?.lambda?.length || 0;
    return h('section', {
        style: { flexShrink: 0, borderTop: `1px solid ${c.border}`, backgroundColor: c.bg }
    },
        h('button', {
            onClick: () => setShowTable(current => !current),
            'aria-expanded': showTable,
            style: {
                width: '100%', height: 30, display: 'flex', alignItems: 'center', gap: 6,
                padding: '0 12px', border: 'none', backgroundColor: c.field,
                color: c.text, cursor: 'pointer', outline: 'none', textAlign: 'left',
                fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 11
            }
        },
            h('svg', { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none' },
                h('path', {
                    d: showTable ? 'M2 3.5l3 3 3-3' : 'M3.5 2l3 3-3 3',
                    stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round'
                })),
            h('span', { style: { fontWeight: 400 } }, oe.results),
            h('span', { style: { color: c.textDim } }, '·'),
            h('span', { style: { color: c.textDim } }, oe.rowCount(rowCount))
        ),
        showTable && data && h(DataTable, { data, showCurves, c, oe })
    );
}
