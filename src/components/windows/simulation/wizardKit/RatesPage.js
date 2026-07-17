/**
 * Page 1 — Deposition Rates (shared by BBM / Mono).
 *
 * Per-material mean / RMS / correlation-time controls for the OU deposition
 * rate process, with a live rate-vs-time preview (re-seeded by "Randomize").
 * The wizards differ only in how the preview path is sampled, supplied as
 * `samplePath(rate, rateNonce)`.
 */

import { Checkbox }                                              from '../../../ui/Checkbox.js';
import { SplitPage, inputStyle, NumField, cullName, matName, Chart } from '../wizardShared.js';

const { createElement: h, useEffect, useMemo } = React;

export function RatesPage({ p, set, materialIds, c, B, samplePath }) {
    const sel = p.selMat && materialIds.includes(p.selMat) ? p.selMat : materialIds[0];
    useEffect(() => { if (sel && sel !== p.selMat) set('selMat', sel); }, [sel]); // eslint-disable-line
    const rate = p.rates[sel] || { meanA: 4, rmsA: 0.4, corr: 3 };
    const setRate = (key, v) => set('rates', { ...p.rates, [sel]: { ...rate, [key]: v } });

    const path = useMemo(() => samplePath(rate, p.rateNonce),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [rate.meanA, rate.rmsA, rate.corr, p.rateNonce]);
    const traces = [{ x: path.t, y: path.r, type: 'scatter', mode: 'lines', line: { color: '#1f6feb', width: 1.3 } }];
    const yRange = p.rateYAt0 ? [0, Math.max(rate.meanA + 4 * Math.max(rate.rmsA, 0.1), rate.meanA * 1.4)] : null;

    return h(SplitPage, { c, leftWidth: 200,
        left: [
            h('label', { key: 'msl', style: { fontSize: 12, color: c.textDim, fontWeight: 600 } }, B.material),
            h('select', { key: 'ms', value: sel || '', onChange: (e) => set('selMat', e.target.value), style: inputStyle(c, '100%') },
                materialIds.map(id => h('option', { key: id, value: id, title: matName(id) }, cullName(matName(id), 26)))),
            h('div', { key: 'grp', style: { fontSize: 12, fontWeight: 600, color: c.text, marginTop: 4 } },
                cullName(matName(sel), 24)),
            h(NumField, { key: 'mean', label: B.meanRate, value: rate.meanA, min: 0.01, max: 200, step: 0.1, c, width: 110, onChange: (v) => setRate('meanA', v) }),
            h(NumField, { key: 'rms', label: B.rms, value: rate.rmsA, min: 0, max: 100, step: 0.05, c, width: 110, onChange: (v) => setRate('rmsA', v) }),
            h(NumField, { key: 'corr', label: B.corrTime, value: rate.corr, min: 0, max: 120, step: 0.5, c, width: 110, onChange: (v) => setRate('corr', v) }),
            h('label', { key: 'y0', style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.text, cursor: 'pointer', marginTop: 4 } },
                h(Checkbox, { c, checked: p.rateYAt0, onChange: (e) => set('rateYAt0', e.target.checked) }),
                B.yAxisAt0),
            h('button', { key: 'rnd', onClick: () => set('rateNonce', (p.rateNonce | 0) + 1),
                style: { marginTop: 6, padding: '7px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 4,
                         border: `1px solid ${c.border}`, background: c.bg, color: c.text } }, B.randomize),
        ],
        right: h('div', { style: { flex: 1, minHeight: 0 } },
            h(Chart, { traces, xTitle: B.timeAxis, yTitle: B.rateAxis, c, yRange })),
    });
}
