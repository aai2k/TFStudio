import { QRow } from './QRow.js';

const { createElement: h } = React;

export function QTable({ qualifiers, results, c, ts, updateQualifier, removeQualifier, integralPresets, measuredCurves, selectedId, onSelect }) {
    return h('div', { style: { padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 } },
        qualifiers.map((q, i) => h(QRow, {
            key: q.id, q, r: results[i], c, ts, updateQualifier, removeQualifier, integralPresets, measuredCurves,
            isSelected: q.id === selectedId,
            onSelect,
        }))
    );
}
