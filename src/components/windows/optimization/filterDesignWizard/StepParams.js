import { idealFilterCurve } from '../../../../utils/filter/filterDesign.js';
import { shapeFactor } from './model.js';
import { NumField, StepHeader } from './ui.js';
import { SpectrumPlot } from './SpectrumPlot.js';

const { createElement: h, useMemo, useCallback } = React;

// ── Step 2: Filter parameters ─────────────────────────────────────────────────
export function StepParams({ p, set, c, t }) {
    const T = t.filterDesign;
    const sf = shapeFactor(p);
    // The step-2 preview is the IDEAL TARGET schematic (a smooth bell
    // through the two spec points), NOT a real multilayer response.
    const curve = useMemo(() => idealFilterCurve({
        lambda0_nm: p.lambda0_nm, halfPass: p.passHalf_nm, halfStop: p.stopHalf_nm,
        passLevel: p.passLevel / 100, stopLevel: p.stopLevel / 100,
    }), [p.lambda0_nm, p.passHalf_nm, p.stopHalf_nm, p.passLevel, p.stopLevel]);
    const analyticT = useCallback((lam) => curve(lam), [curve]);
    const levelLines = [
        { y: p.passLevel, color: '#43a047', x0: p.lambda0_nm - p.passHalf_nm, x1: p.lambda0_nm + p.passHalf_nm },
        { y: p.stopLevel, color: '#e53935', x0: p.lambda0_nm - p.stopHalf_nm, x1: p.lambda0_nm + p.stopHalf_nm },
    ];
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(StepHeader, { step: 2, title: T.step2.title, c }),
        h('div', { style: { display: 'flex', gap: 18 } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 200 } },
                h(NumField, { label: T.step2.lambda0, value: p.lambda0_nm, min: 100, max: 5000, step: 0.1, suffix: 'nm', c, onChange: (v) => set('lambda0_nm', v) }),
                h(NumField, { label: `Δλ @ T=${p.passLevel}%`, value: p.passHalf_nm, min: 0.05, max: 250, step: 0.05, suffix: 'nm', c, onChange: (v) => set('passHalf_nm', v) }),
                h(NumField, { label: `Δλ @ T=${p.stopLevel}%`, value: p.stopHalf_nm, min: 0.05, max: 1000, step: 0.05, suffix: 'nm', c, onChange: (v) => set('stopHalf_nm', v) }),
                h(NumField, { label: T.step2.shapeFactor, value: sf, min: 1, max: 50, step: 0.1, c, onChange: (v) => { if (v > 0) set('stopHalf_nm', +(p.passHalf_nm * v).toFixed(4)); } }),
                h('div', { style: { display: 'flex', gap: 10 } },
                    h(NumField, { label: T.step2.passLevel, value: p.passLevel, min: 1, max: 99.9, step: 0.01, suffix: '%', c, width: 80, onChange: (v) => set('passLevel', v) }),
                    h(NumField, { label: T.step2.stopLevel, value: p.stopLevel, min: 0.001, max: 50, step: 0.01, suffix: '%', c, width: 80, onChange: (v) => set('stopLevel', v) }))),
            h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' } },
                h('div', { style: { fontSize: 11, color: c.textDim, marginBottom: 2 } }, T.step2.previewHint),
                h(SpectrumPlot, { analyticT, p, c, height: 300, levelLines }))));
}
