import { LockIcon } from '../../../ui/LockIcon.js';
import { displayLayerLabel, rankSensitivityRows } from './viewModel.js';

const { createElement: h, useMemo } = React;

export function SensitivityTable({ rows, matColorMap, frontCount, c }) {
    const ranked = useMemo(() => rankSensitivityRows(rows), [rows]);
    const thBase = {
        padding: '3px 8px', fontWeight: 600, fontSize: 11,
        borderBottom: `1px solid ${c.border}`,
        position: 'sticky', top: 0, backgroundColor: c.panel,
        textAlign: 'right', whiteSpace: 'nowrap', color: c.textDim,
    };
    const tdBase = {
        padding: '2px 8px', fontSize: 11,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right',
    };

    return h('div', {
        style: {
            height: '100%', overflowY: 'auto',
            background: c.bg, borderRight: `1px solid ${c.border}`,
            minWidth: 340,
        }
    },
        h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null,
                h('tr', null,
                    h('th', { style: { ...thBase, textAlign: 'left' } }, '#'),
                    h('th', { style: { ...thBase, textAlign: 'left' } }, 'Layer'),
                    h('th', { style: { ...thBase, textAlign: 'left' } }, 'Material'),
                    h('th', { style: thBase }, 'd (nm)'),
                    h('th', { style: thBase }, 'Δd (nm)'),
                    h('th', { style: thBase }, '|ΔOMF|'),
                    h('th', { style: thBase }, 'Sens. (%)'),
                    h('th', { style: thBase }, 'Rank'),
                )
            ),
            h('tbody', null,
                ranked.map((row, index) => h('tr', {
                    key: index,
                    style: { backgroundColor: index % 2 === 0 ? 'transparent' : c.panel + '55' }
                },
                    h('td', { style: { ...tdBase, textAlign: 'left', color: c.textDim } }, index + 1),
                    h('td', { style: { ...tdBase, textAlign: 'left', color: c.text } },
                        displayLayerLabel(row, frontCount),
                        row.locked ? h('span', {
                            style: {
                                marginLeft: 5, display: 'inline-flex', verticalAlign: 'middle', color: c.accent,
                            }
                        }, h(LockIcon, { locked: true, size: 11 })) : null
                    ),
                    h('td', {
                        style: {
                            ...tdBase, textAlign: 'left', display: 'flex', gap: 4,
                            alignItems: 'center', maxWidth: 130, overflow: 'hidden',
                        }
                    },
                        h('div', { style: {
                            width: 8, height: 8, borderRadius: 2,
                            background: matColorMap[row.materialId] || '#888', flexShrink: 0,
                        }}),
                        h('span', {
                            title: row.materialId || '',
                            style: {
                                color: c.text, overflow: 'hidden', textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap', minWidth: 0,
                            }
                        }, row.materialId || '—')
                    ),
                    h('td', { style: { ...tdBase, color: c.text } }, row.thickness.toFixed(2)),
                    h('td', { style: { ...tdBase, color: c.textDim } }, row.deltaNm.toFixed(3)),
                    h('td', { style: { ...tdBase, color: c.text } }, row.deltaMFAbs.toExponential(3)),
                    h('td', { style: { ...tdBase, color: c.text, fontWeight: 600 } }, row.sensitivity.toFixed(1)),
                    h('td', {
                        style: {
                            ...tdBase,
                            color: row.rank === 1 ? c.accent : c.textDim,
                            fontWeight: row.rank === 1 ? 700 : 400,
                        }
                    }, row.rank),
                ))
            )
        )
    );
}
