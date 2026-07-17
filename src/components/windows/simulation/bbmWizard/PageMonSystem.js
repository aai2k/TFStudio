/**
 * Broadband Monitoring Wizard — Page 3: Monitoring System.
 *
 * Quantity (T/R + polarization), AOI, scan interval, and monitoring band —
 * with a live ideal per-layer monitoring-signal preview (layer tabs).
 */

import { systemSpectrum, partialThicknesses } from '../../../../utils/monitoring/depositionSpectrum.js';
import { resolveMat, inputStyle, RowField, LayerTabs, Chart, SplitPage } from '../wizardShared.js';

const { createElement: h, useMemo } = React;

export function PageMonSystem({ p, set, layers, c, B, ctx }) {
    const k = Math.min(Math.max(1, p.previewLayer || 1), layers.length);
    const nonce = p.monNonce | 0;
    const preview = useMemo(() => {
        if (!layers.length || !ctx) return null;
        const baseThicks = layers.map(l => l.thickness || 0);
        const thk = partialThicknesses(baseThicks, k, 1);
        // In-chamber monitor signal: the growing active coating on a SEMI-INFINITE
        // substrate (no back surface) — this is what the spectrophotometer sees,
        // independent of the front/back/total evaluation mode.
        return systemSpectrum({
            evalMode: 'front',
            frontStored: layers.map((l, i) => ({ material: resolveMat(l.material), thickness: thk[i] })),
            quantity: p.quantity, aoi: p.aoi, polarization: p.pol,
            lambdaStart: p.lamMin, lambdaEnd: p.lamMax, lambdaStep: Math.max(0.5, (p.lamMax - p.lamMin) / 200),
            incidentMat: ctx.incidentMatActive, substrateMat: ctx.subMat,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layers, k, p.quantity, p.aoi, p.pol, p.lamMin, p.lamMax, nonce, ctx]);
    const traces = preview ? [{ x: preview.lambda, y: preview.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: '#1f6feb', width: 1.6 } }] : [];

    return h(SplitPage, { c, leftWidth: 210,
        left: [
            h('select', { key: 'q', value: p.quantity + p.pol, onChange: (e) => { const v = e.target.value; set('quantity', v[0]); set('pol', v.slice(1)); }, style: { ...inputStyle(c, '100%'), padding: '4px 6px' } },
                [['Tavg', B.qTavg], ['Ts', B.qTs], ['Tp', B.qTp], ['Ravg', B.qRavg], ['Rs', B.qRs], ['Rp', B.qRp]].map(([v, l]) => h('option', { key: v, value: v }, l))),
            h(RowField, { key: 'aoi', label: B.incidence, value: p.aoi, min: 0, max: 89, step: 1, c, onChange: (v) => set('aoi', v) }),
            h(RowField, { key: 'si', label: B.scanInterval, value: p.scanInterval, min: 0.05, max: 60, step: 0.1, c, onChange: (v) => set('scanInterval', v) }),
            h('div', { key: 'bl', style: { fontSize: 12, fontWeight: 600, color: c.text, marginTop: 2 } }, B.band),
            h(RowField, { key: 'lo', label: B.lamMin, value: p.lamMin, min: 100, max: 20000, step: 10, c, onChange: (v) => set('lamMin', v) }),
            h(RowField, { key: 'hi', label: B.lamMax, value: p.lamMax, min: 100, max: 20000, step: 10, c, onChange: (v) => set('lamMax', v) }),
            h(RowField, { key: 'pts', label: B.points, value: p.points, min: 3, max: 4000, step: 1, c, onChange: (v) => set('points', Math.round(v)) }),
            h('button', { key: 'upd', onClick: () => set('monNonce', nonce + 1),
                style: { marginTop: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, color: c.text } }, B.update),
        ],
        right: h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { flex: 1, minHeight: 0 } },
                h(Chart, { traces, xTitle: B.wavelengthAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c })),
            h(LayerTabs, { n: layers.length, current: k, onSelect: (kk) => set('previewLayer', kk), c, label: B.layerWord })),
    });
}
