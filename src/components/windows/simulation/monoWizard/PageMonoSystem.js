/**
 * Page 3 — Monitoring System (measured quantity, incidence, scan timing,
 * witness chip glass) with an ideal single-λ signal-vs-thickness preview for
 * the selected layer. The per-layer wavelength/strategy plan is the next page.
 */

import {
    inputStyle, RowField, LayerTabs, Chart, SplitPage,
}                               from '../wizardShared.js';
import { MaterialPicker }      from '../../../ui/MaterialPicker.js';
import { useMonoPreview }      from './useMonoPreview.js';

const { createElement: h } = React;

export function PageMonoSystem({ p, set, layers, c, B, t, ctx, design }) {
    const { k, series, referenceLines } = useMonoPreview({ p, layers, ctx, design, nonce: p.monNonce });

    return h(SplitPage, { c, leftWidth: 230,
        left: [
            h('label', { key: 'q', style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
                h('span', null, B.quantity),
                h('select', { value: p.quantity + p.pol, onChange: (e) => { const v = e.target.value; set('quantity', v[0]); set('pol', v.slice(1)); }, style: { ...inputStyle(c, 130), padding: '4px 6px' } },
                    [['Tavg', B.qTavg], ['Ts', B.qTs], ['Tp', B.qTp], ['Ravg', B.qRavg], ['Rs', B.qRs], ['Rp', B.qRp]].map(([v, l]) => h('option', { key: v, value: v }, l)))),
            h(RowField, { key: 'aoi', label: B.incidence, value: p.aoi, min: 0, max: 89, step: 1, c, onChange: (v) => set('aoi', v) }),
            h(RowField, { key: 'si', label: B.scanInterval, value: p.scanInterval, min: 0.05, max: 60, step: 0.1, c, onChange: (v) => set('scanInterval', v) }),
            h(RowField, { key: 'cs', label: B.confirmScans, value: p.confirmScans, min: 1, max: 10, step: 1, c, onChange: (v) => set('confirmScans', Math.max(1, Math.round(v))) }),
            // The witness chip's glass. Opens on the design substrate; picking
            // another material moves the monitor signal onto that glass.
            h('label', { key: 'cg', style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim }, title: B.chipGlassHint },
                h('span', null, B.chipGlass),
                h(MaterialPicker, { value: p.chipMaterial || design.substrate?.material || 'builtin:BK7', onChange: (v) => set('chipMaterial', v), c, t, compact: true })),
        ],
        right: h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { flex: 1, minHeight: 0 } },
                h(Chart, { series, xTitle: B.thicknessAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c, referenceLines, minHeight: 0 })),
            h(LayerTabs, { n: layers.length, current: k, onSelect: (kk) => set('previewLayer', kk), c, label: B.layerWord })),
    });
}
