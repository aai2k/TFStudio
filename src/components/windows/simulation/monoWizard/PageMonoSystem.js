/**
 * Page 3 — Monitoring System (per-layer λ + strategy).
 *
 * Measured quantity + AOI + scan interval, a PER-LAYER table of monitoring
 * wavelength + termination strategy (turning point / level / by time), and an
 * ideal single-λ signal-vs-thickness preview for the selected layer.
 */

import { pickSensitiveLambda } from '../../../../utils/monitoring/monoSim.js';
import {
    resolveMat, matName, cullName, inputStyle, NumField, cellNum, LayerTabs, Chart,
}                               from '../wizardShared.js';
import { monoSignalVsThickness } from './monoSignalModel.js';

const { createElement: h, useMemo } = React;

export function PageMonoSystem({ p, set, layers, c, B, ctx, design }) {
    const k = Math.min(Math.max(1, p.previewLayer || 1), layers.length);
    const common = { char: p.quantity, aoi: p.aoi, pol: p.pol };
    const monRow = p.monTable[k - 1] || { lambda: design.referenceWavelength || 550, strategy: 'turning', order: 1 };

    const preview = useMemo(() =>
        (layers.length && ctx) ? monoSignalVsThickness({ layers, k, monRow, common, ctx, noisePct: 0, nonce: p.monNonce }) : null,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [layers, k, monRow.lambda, p.quantity, p.aoi, p.pol, p.monNonce, ctx]);

    const traces = preview ? [{ x: preview.d, y: preview.signal, type: 'scatter', mode: 'lines', line: { color: '#1f6feb', width: 1.6 } }] : [];
    const shapes = preview ? [{ type: 'line', x0: preview.dTarget, x1: preview.dTarget, yref: 'paper', y0: 0, y1: 1,
        line: { color: '#2da44e', width: 1.2, dash: 'dash' } }] : [];

    const setMon = (i, key, v) => { const arr = p.monTable.map(x => ({ ...x })); arr[i] = { ...arr[i], [key]: v }; set('monTable', arr); };
    const autoAll = () => {
        const ref = design.referenceWavelength || 550;
        const arr = layers.map((l, i) => {
            const lam = pickSensitiveLambda(design, resolveMat, i, ref * 0.7, ref * 1.3, p.aoi, p.pol, p.quantity);
            return { ...(p.monTable[i] || {}), lambda: lam };
        });
        set('monTable', arr); set('monNonce', (p.monNonce | 0) + 1);
    };

    const th = { textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${c.border}`, fontWeight: 600, color: c.textDim, fontSize: 11.5, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: c.panel };
    const td = { padding: '3px 8px', borderBottom: `1px solid ${c.border}55`, fontSize: 12, color: c.text };
    const stratOpts = [['turning', B.stratTurning], ['level', B.stratLevel], ['time', B.stratTime]];

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 } },
        // Controls row
        h('div', { style: { display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap', flexShrink: 0 } },
            h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
                h('span', null, B.quantity),
                h('select', { value: p.quantity + p.pol, onChange: (e) => { const v = e.target.value; set('quantity', v[0]); set('pol', v.slice(1)); }, style: { ...inputStyle(c, 110), padding: '4px 6px' } },
                    [['Tavg', B.qTavg], ['Ts', B.qTs], ['Tp', B.qTp], ['Ravg', B.qRavg], ['Rs', B.qRs], ['Rp', B.qRp]].map(([v, l]) => h('option', { key: v, value: v }, l)))),
            h(NumField, { label: B.incidence, value: p.aoi, min: 0, max: 89, step: 1, c, width: 80, onChange: (v) => set('aoi', v) }),
            h(NumField, { label: B.scanInterval, value: p.scanInterval, min: 0.05, max: 60, step: 0.1, c, width: 90, onChange: (v) => set('scanInterval', v) }),
            h(NumField, { label: B.confirmScans, value: p.confirmScans, min: 1, max: 10, step: 1, c, width: 70, onChange: (v) => set('confirmScans', Math.max(1, Math.round(v))) }),
            h('button', { onClick: autoAll, title: B.autoLambdaHint,
                style: { padding: '7px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, color: c.text } }, B.autoLambda)),
        // Preview chart
        h('div', { style: { height: 200, flexShrink: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { flex: 1, minHeight: 0 } },
                h(Chart, { traces, xTitle: B.thicknessAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c, extra: { shapes }, minHeight: 0 })),
            h(LayerTabs, { n: layers.length, current: k, onSelect: (kk) => set('previewLayer', kk), c, label: B.layerWord })),
        // Per-layer monitor table
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { fontSize: 12.5, fontWeight: 600, color: c.text, marginBottom: 6 } }, B.monAlgoTitle),
            h('div', { style: { border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'auto', flex: 1 } },
                h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                    h('thead', null, h('tr', null, [B.colNum, B.colMaterial, B.colLambda, B.colStrategy, B.colOrder].map((x, i) => h('th', { key: i, style: th }, x)))),
                    h('tbody', null, layers.map((l, i) => {
                        const m = p.monTable[i] || { lambda: design.referenceWavelength || 550, strategy: 'turning', order: 1 };
                        const active = i === k - 1;
                        return h('tr', { key: i, onClick: () => set('previewLayer', i + 1),
                            style: { cursor: 'pointer', background: active ? c.accent + '18' : 'transparent' } },
                            h('td', { style: td }, i + 1),
                            h('td', { style: { ...td, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: matName(l.material) }, cullName(matName(l.material), 18)),
                            h('td', { style: td }, cellNum({ value: m.lambda ?? 550, step: 1, min: 100, max: 20000, c, width: 78, onChange: (v) => setMon(i, 'lambda', v) })),
                            h('td', { style: td },
                                h('select', { value: m.strategy || 'turning', onChange: (e) => setMon(i, 'strategy', e.target.value), style: { ...inputStyle(c, 120), padding: '3px 5px', fontSize: 12 } },
                                    stratOpts.map(([v, lbl]) => h('option', { key: v, value: v }, lbl)))),
                            h('td', { style: td }, m.strategy === 'turning'
                                ? cellNum({ value: m.order ?? 1, step: 1, min: 1, max: 12, c, width: 54, onChange: (v) => setMon(i, 'order', Math.max(1, Math.round(v))) })
                                : h('span', { style: { color: c.textDim } }, '—')));
                    }))))),
    );
}
