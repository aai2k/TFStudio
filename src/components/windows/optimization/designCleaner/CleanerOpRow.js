import { designMaterialName } from '../../../../utils/materials/designMaterials.js';
import { displayLayerLabel } from '../../analysis/layerSensitivity/viewModel.js';

const { createElement: h } = React;

export function CleanerOpRow({ op, i, c, dc, units, dMin, design }) {
    // An operation's indices are the layers' places in the design it was
    // planned on, so they take that design's numbering.
    const label = layerIndex => displayLayerLabel({ side: op.side, layerIndex }, design.frontLayers?.length || 0);
    return h('tr', {
        style: { background: i % 2 === 0 ? 'transparent' : c.panel + '33' }
    },
        h('td', { style: { padding: '2px 8px', color: c.textDim, fontSize: 11 } }, i + 1),
        h('td', { style: { padding: '2px 8px', color: c.text, fontSize: 11 } },
            op.side === 'front' ? 'F' : 'B'),
        h('td', { style: { padding: '2px 8px', color: c.text, fontSize: 11 } },
            label(op.srcIdx)),
        h('td', { style: { padding: '2px 8px', fontSize: 11,
            color: op.kind === 'remove' ? '#ef5350' : '#ffd54f', fontWeight: 600 } },
            op.kind === 'remove' ? dc.opRemove : dc.opMerge),
        h('td', { style: { padding: '2px 8px', color: c.text, fontSize: 11 } }, designMaterialName(design, op.materialId)),
        h('td', {
            style: { padding: '2px 8px', color: c.text, fontSize: 11,
                textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
        }, `${op.thickness.toFixed(3)} ${units.nm}`),
        h('td', { style: { padding: '2px 8px', color: c.textDim, fontSize: 11, textAlign: 'right' } },
            op.kind === 'merge'
                ? `→ ${label(op.mergedInto)}`
                : `< ${dMin.toFixed(1)} ${units.nm}`)
    );
}
