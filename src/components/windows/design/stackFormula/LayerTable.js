import { resolveMat } from './model.js';
import { materialLabel } from '../../../../utils/materials/catalogManager.js';

const { createElement: h } = React;

function layerRow(l, i, refLambda, c) {
    const n = resolveMat(l.material).getNK(refLambda)[0];
    const qwot = n > 0 ? (4 * n * l.thickness) / refLambda : 0;
    return h('tr', { key: i },
        h('td', { style: { padding: '2px 8px', color: c.textDim } }, i + 1),
        h('td', { style: { padding: '2px 8px' } }, materialLabel(l.material)),
        h('td', { style: { padding: '2px 8px', textAlign: 'right', color: c.textDim } }, qwot.toFixed(3)),
        h('td', { style: { padding: '2px 8px', textAlign: 'right' } }, l.thickness.toFixed(2)),
    );
}

export function LayerTable({ compiled, refLambda, c, sf }) {
    return h('div', { style: { maxHeight: 150, overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11.5, color: c.text } },
            h('thead', {},
                h('tr', { style: { backgroundColor: c.hover, position: 'sticky', top: 0 } },
                    ['#', sf.colMaterial, 'QWOT', sf.colThickness].map((col, i) =>
                        h('th', { key: i, style: { textAlign: i >= 2 ? 'right' : 'left',
                            padding: '4px 8px', borderBottom: `1px solid ${c.border}`, fontWeight: 600 } }, col)))
            ),
            h('tbody', {},
                compiled.ok ? compiled.layers.map((l, i) => layerRow(l, i, refLambda, c))
                    : h('tr', {}, h('td', { colSpan: 4, style: { padding: '10px', color: c.textDim,
                            textAlign: 'center', fontStyle: 'italic' } }, sf.invalidFormula))
            )
        )
    );
}
