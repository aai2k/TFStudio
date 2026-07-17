/**
 * Broadband Monitoring Wizard — Page 4: Signal Errors.
 *
 * Random noise (% of signal) and drift controls, with a live noisy-signal
 * preview built from the clean Page-3 monitor signal.
 */

import { mulberry32 } from '../../../../utils/monitoring/monitoringSim.js';
import { systemSpectrum, partialThicknesses } from '../../../../utils/monitoring/depositionSpectrum.js';
import { resolveMat, SplitPage, RowField, Radio, Chart, LayerTabs } from '../wizardShared.js';

const { createElement: h, useMemo } = React;

export function PageSignalErrors({ p, set, layers, c, B, ctx }) {
    const k = Math.min(Math.max(1, p.previewLayer || 1), layers.length);
    const nonce = p.sigNonce | 0;
    const preview = useMemo(() => {
        if (!layers.length || !ctx) return null;
        const baseThicks = layers.map(l => l.thickness || 0);
        const thk = partialThicknesses(baseThicks, k, 1);
        // Semi-infinite active coating — the in-chamber monitor signal (see Page 3).
        const clean = systemSpectrum({
            evalMode: 'front',
            frontStored: layers.map((l, i) => ({ material: resolveMat(l.material), thickness: thk[i] })),
            quantity: p.quantity, aoi: p.aoi, polarization: p.pol,
            lambdaStart: p.lamMin, lambdaEnd: p.lamMax, lambdaStep: Math.max(0.5, (p.lamMax - p.lamMin) / 200),
            incidentMat: ctx.incidentMatActive, substrateMat: ctx.subMat,
        });
        // Apply random noise (% of signal) for the preview.
        const rng = mulberry32(nonce + 7);
        const std = p.randomPct / 100;
        const noisy = clean.values.map(v => {
            // Box–Muller
            let u1 = rng(); while (u1 <= 1e-12) u1 = rng();
            const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
            return v * (1 + (std > 0 ? g * std : 0));
        });
        return { lambda: clean.lambda, values: noisy };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layers, k, p.quantity, p.aoi, p.pol, p.lamMin, p.lamMax, p.randomPct, nonce, ctx]);
    const traces = preview ? [{ x: preview.lambda, y: preview.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: '#e5484d', width: 1.3 } }] : [];

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
            h('button', { key: 'upd', onClick: () => set('sigNonce', nonce + 1),
                style: { marginTop: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, color: c.text } }, B.update),
        ],
        right: h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { flex: 1, minHeight: 0 } },
                h(Chart, { traces, xTitle: B.wavelengthAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c, yRange: p.yFixed ? [0, 100] : null })),
            h(LayerTabs, { n: layers.length, current: k, onSelect: (kk) => set('previewLayer', kk), c, label: B.layerWord })),
    });
}
