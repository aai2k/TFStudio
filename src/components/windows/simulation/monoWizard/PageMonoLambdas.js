/**
 * Page 4 — Monitoring Wavelengths (per-layer λ + termination strategy).
 *
 * Batch tools (auto-pick the most sensitive λ per layer, or one λ for the
 * whole run), the per-layer plan table at full page height, and the ideal
 * signal preview for the layer the table has selected. Clicking a table row
 * previews that layer, so the page needs no separate layer strip.
 */

import { pickMonitoringPlan } from '../../../../utils/monitoring/monoSim.js';
import { flipLayerIndex }      from '../../../../utils/monitoring/depositionSpectrum.js';
import {
    matName, cullName, inputStyle, cellNum, Chart,
}                               from '../wizardShared.js';
import { useMonoPreview }      from './useMonoPreview.js';

const { createElement: h } = React;

function batchButton(c, label, title, onClick) {
    return h('button', { onClick, title,
        style: { padding: '6px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, color: c.text } }, label);
}

export function PageMonoLambdas({ p, set, layers, c, B, ctx, design }) {
    const resolveMat = ctx.resolveMat;
    const { k, series, referenceLines } = useMonoPreview({ p, layers, ctx, design, nonce: p.monNonce });

    // Storage-order rows paired with their deposition number, listed in the order
    // the chamber grows them (substrate-adjacent first).
    const depRows = layers.map((l, i) => ({ l, i, num: flipLayerIndex(layers.length, i) })).reverse();

    const setMon = (i, key, v) => { const arr = p.monTable.map(x => ({ ...x })); arr[i] = { ...arr[i], [key]: v }; set('monTable', arr); };
    const autoAll = () => {
        const ref = design.referenceWavelength || 550;
        // The table is indexed against the deposited coating (in back mode the
        // reversed back stack grown from the exit side), so the pick reads the
        // simulated design, not the raw one. Wavelength and strategy are
        // chosen together: a wavelength picked for a level cut is the wrong
        // place for a turning rule and the other way around.
        const plan = pickMonitoringPlan({
            design: ctx.simDesign || design, resolveMat,
            lamA: ref * 0.7, lamB: ref * 1.3,
            theta: p.aoi, pol: p.pol, char: p.quantity,
            chipMaterial: p.chipMaterial || null,
            noisePct: p.randomPct, absNoisePct: p.absNoisePct,
        });
        const arr = layers.map((l, i) => ({
            ...(p.monTable[i] || {}),
            lambda: plan[i]?.lambda ?? ref,
            strategy: plan[i]?.strategy ?? 'turning',
        }));
        set('monTable', arr); set('monNonce', (p.monNonce | 0) + 1);
    };
    // A cleared field reports 0, which is not a wavelength: fall back to the
    // design reference rather than writing 0 onto every layer.
    const bulk = p.bulkLambda > 0 ? p.bulkLambda : (design.referenceWavelength || 550);
    const setAllLambda = () => {
        const arr = layers.map((l, i) => ({ ...(p.monTable[i] || {}), lambda: bulk }));
        set('monTable', arr); set('monNonce', (p.monNonce | 0) + 1);
    };

    const th = { textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${c.border}`, fontWeight: 600, color: c.textDim, fontSize: 11.5, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: c.panel };
    const td = { padding: '3px 8px', borderBottom: `1px solid ${c.border}55`, fontSize: 12, color: c.text };
    const stratOpts = [['turning', B.stratTurning], ['level', B.stratLevel], ['time', B.stratTime]];

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 } },
        // Batch tools: auto λ per layer, or one λ for the whole run.
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 } },
            batchButton(c, B.autoLambda, B.autoLambdaHint, autoAll),
            h('span', { style: { fontSize: 12, color: c.textDim, marginLeft: 12 } }, B.bulkLambda),
            cellNum({ value: bulk, step: 1, min: 100, max: 20000, c, width: 84, onChange: (v) => set('bulkLambda', v) }),
            batchButton(c, B.setAllLambda, B.setAllLambdaHint, setAllLambda),
            // One strategy for the whole run, applied on selection; the blank
            // entry is the resting label, so the control carries no state.
            h('select', {
                value: '',
                onChange: (e) => {
                    const v = e.target.value;
                    if (!v) return;
                    set('monTable', p.monTable.map(m => ({ ...m, strategy: v })));
                    set('monNonce', (p.monNonce | 0) + 1);
                },
                style: { ...inputStyle(c, 150), padding: '4px 6px', marginLeft: 12, fontSize: 12 } },
                h('option', { value: '' }, B.allStrategy),
                ...stratOpts.map(([v, lbl]) => h('option', { key: v, value: v }, lbl)))),
        // Per-layer plan (left, full height) + selected layer's signal (right).
        h('div', { style: { display: 'flex', gap: 14, flex: 1, minHeight: 0 } },
            h('div', { style: { flex: '0 0 470px', border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'auto' } },
                h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                    h('thead', null, h('tr', null, [B.colNum, B.colMaterial, B.colLambda, B.colStrategy, B.colOrder].map((x, i) => h('th', { key: i, style: th }, x)))),
                    // Listed in deposition order (layer 1 = substrate-adjacent,
                    // grown first) to match the Design Editor; `monTable`
                    // itself stays storage-indexed.
                    h('tbody', null, depRows.map(({ l, i, num }) => {
                        const m = p.monTable[i] || { lambda: design.referenceWavelength || 550, strategy: 'turning', order: 1 };
                        const active = num === k;
                        return h('tr', { key: i, onClick: () => set('previewLayer', num),
                            style: { cursor: 'pointer', background: active ? c.accent + '18' : 'transparent' } },
                            h('td', { style: td }, num),
                            h('td', { style: { ...td, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: matName(resolveMat, l.material) }, cullName(matName(resolveMat, l.material), 18)),
                            h('td', { style: td }, cellNum({ value: m.lambda ?? 550, step: 1, min: 100, max: 20000, c, width: 78, onChange: (v) => setMon(i, 'lambda', v) })),
                            h('td', { style: td },
                                h('select', { value: m.strategy || 'turning', onChange: (e) => setMon(i, 'strategy', e.target.value), style: { ...inputStyle(c, 120), padding: '3px 5px', fontSize: 12 } },
                                    stratOpts.map(([v, lbl]) => h('option', { key: v, value: v }, lbl)))),
                            h('td', { style: td }, m.strategy === 'turning'
                                ? cellNum({ value: m.order ?? 1, step: 1, min: 1, max: 12, c, width: 54, onChange: (v) => setMon(i, 'order', Math.max(1, Math.round(v))) })
                                : h('span', { style: { color: c.textDim } }, '—')));
                    })))),
            h('div', { style: { flex: 1, minWidth: 0, minHeight: 0 } },
                h(Chart, { series, xTitle: B.thicknessAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c, referenceLines, minHeight: 0 }))),
    );
}
