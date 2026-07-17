/**
 * Page 4 — Signal Errors (random noise + drift; noisy single-λ preview).
 */

import { RowField, Radio, Chart, LayerTabs, SplitPage } from '../wizardShared.js';
import { monoSignalVsThickness } from './monoSignalModel.js';

const { createElement: h, useMemo } = React;

export function PageSignalErrors({ p, set, layers, c, B, ctx, design }) {
    const k = Math.min(Math.max(1, p.previewLayer || 1), layers.length);
    const common = { char: p.quantity, aoi: p.aoi, pol: p.pol };
    const monRow = p.monTable[k - 1] || { lambda: design.referenceWavelength || 550, strategy: 'turning', order: 1 };
    const preview = useMemo(() =>
        (layers.length && ctx) ? monoSignalVsThickness({ layers, k, monRow, common, ctx, noisePct: p.randomPct, nonce: p.sigNonce }) : null,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [layers, k, monRow.lambda, p.quantity, p.aoi, p.pol, p.randomPct, p.sigNonce, ctx]);
    const traces = preview ? [{ x: preview.d, y: preview.signal, type: 'scatter', mode: 'lines', line: { color: '#e5484d', width: 1.3 } }] : [];
    const shapes = preview ? [{ type: 'line', x0: preview.dTarget, x1: preview.dTarget, yref: 'paper', y0: 0, y1: 1,
        line: { color: '#2da44e', width: 1.2, dash: 'dash' } }] : [];

    return h(SplitPage, { c, leftWidth: 210,
        left: [
            h(RowField, { key: 're', label: B.randomErrors, value: p.randomPct, min: 0, max: 20, step: 0.05, c, onChange: (v) => set('randomPct', v) }),
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
                h(Chart, { traces, xTitle: B.thicknessAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c, yRange: p.yFixed ? [0, 100] : null, extra: { shapes } })),
            h(LayerTabs, { n: layers.length, current: k, onSelect: (kk) => set('previewLayer', kk), c, label: B.layerWord })),
    });
}
