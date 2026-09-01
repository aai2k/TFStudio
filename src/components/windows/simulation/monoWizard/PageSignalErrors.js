/**
 * Page 5 — Signal Errors (random noise + drift; noisy single-λ preview).
 */

import { RowField, Radio, Chart, LayerTabs, SplitPage } from '../wizardShared.js';
import { useMonoPreview } from './useMonoPreview.js';

const { createElement: h } = React;

export function PageSignalErrors({ p, set, layers, c, B, ctx, design }) {
    const { k, series, referenceLines } = useMonoPreview({
        p, layers, ctx, design,
        noisePct: p.randomPct, absPct: p.absNoisePct, nonce: p.sigNonce, color: '#e5484d', width: 1.3,
    });

    return h(SplitPage, { c, leftWidth: 210,
        left: [
            h(RowField, { key: 're', label: B.randomErrors, value: p.randomPct, min: 0, max: 20, step: 0.05, c, onChange: (v) => set('randomPct', v) }),
            h(RowField, { key: 'an', label: B.absNoise, value: p.absNoisePct, min: 0, max: 10, step: 0.05, c, onChange: (v) => set('absNoisePct', v) }),
            h('div', { key: 'fl', style: { fontSize: 12, fontWeight: 600, color: c.text, marginTop: 2 } }, B.fluctuations),
            h(RowField, { key: 'dr', label: B.drift, value: p.drift, min: 0, max: 50, step: 0.05, c, onChange: (v) => set('drift', v) }),
            h(RowField, { key: 'mt', label: B.meanTime, value: p.driftMeanTime, min: 0, max: 1000, step: 0.5, c, onChange: (v) => set('driftMeanTime', v) }),
            h(RowField, { key: 'drms', label: B.rmsTime, value: p.driftRms, min: 0, max: 1000, step: 0.5, c, onChange: (v) => set('driftRms', v) }),
            h('div', { key: 'yl', style: { fontSize: 12, fontWeight: 600, color: c.text, marginTop: 4 } }, B.yAxisScale),
            h(Radio, { key: 'ya', checked: !p.yFixed, onChange: () => set('yFixed', false), label: B.auto, c }),
            h(Radio, { key: 'yf', checked: p.yFixed, onChange: () => set('yFixed', true), label: B.fixed, c }),
            h('button', { key: 'upd', onClick: () => set('sigNonce', (p.sigNonce | 0) + 1),
                style: { marginTop: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, color: c.text } }, B.update),
        ],
        right: h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { flex: 1, minHeight: 0 } },
                h(Chart, { series, xTitle: B.thicknessAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c, yRange: p.yFixed ? [0, 100] : null, referenceLines })),
            h(LayerTabs, { n: layers.length, current: k, onSelect: (kk) => set('previewLayer', kk), c, label: B.layerWord })),
    });
}
