import { LayerTable } from './LayerTable.js';
import { PreviewPlot } from './PreviewPlot.js';

const { createElement: h } = React;

export function ResultsPanel({ state, c, sf }) {
    const { compiled, refLambda, effSide, incidentMat, exitMat, substrateMat, totalNm } = state;
    return h('div', { style: { flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 320 } },
        h('div', { style: { fontSize: 11, color: c.textDim, display: 'flex', gap: 14 } },
            compiled.ok && h('span', { key: 'lc' }, sf.layersCount(compiled.layers.length)),
            compiled.ok && h('span', { key: 'th' }, sf.totalThickness(totalNm.toFixed(1))),
        ),
        h(LayerTable, { compiled, refLambda, c, sf }),
        // For the back coating the spectrum is seen from the exit medium
        // (compiled.layers are in the same traversal order).
        h(PreviewPlot, {
            compiled,
            incidentId: effSide === 'back' ? exitMat : incidentMat,
            substrateId: substrateMat, refLambda, c, height: 200,
        }),
    );
}
