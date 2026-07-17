import { CleanerOpRow } from './CleanerOpRow.js';

const { createElement: h } = React;

export function CleanerOpsTable({ c, dc, ops, dMin }) {
    return h('div', {
        style: {
            flex: 1, minHeight: 0, overflowY: 'auto',
            borderRight: `1px solid ${c.border}`,
        }
    },
        h('div', {
            style: {
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                color: c.textDim, background: c.panel + '55',
                borderBottom: `1px solid ${c.border}`, position: 'sticky', top: 0,
            }
        }, dc.pendingOps + ` (${ops.length})`),
        ops.length === 0
            ? h('div', {
                style: { padding: 16, color: c.textDim, fontStyle: 'italic', textAlign: 'center' }
            }, dc.noOps)
            : h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                h('thead', null,
                    h('tr', null,
                        ['#', dc.colSide, dc.colLayer, dc.colKind, dc.colMaterial, dc.colThickness, dc.colDetail]
                            .map((label, i) => h('th', {
                                key: i,
                                style: {
                                    padding: '3px 8px', fontWeight: 600, fontSize: 10,
                                    borderBottom: `1px solid ${c.border}`,
                                    background: c.panel + '55',
                                    textAlign: i >= 5 ? 'right' : 'left',
                                    color: c.textDim, whiteSpace: 'nowrap',
                                    position: 'sticky', top: 22,
                                }
                            }, label))
                    )
                ),
                h('tbody', null, ops.map((op, i) => h(CleanerOpRow, { key: i, op, i, c, dc, dMin })))
            )
    );
}
