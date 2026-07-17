import { recommendCavities } from '../../../../utils/filter/filterDesign.js';
import { shapeFactor } from './model.js';
import { IntField, StepHeader } from './ui.js';

const { createElement: h, useEffect } = React;

// ── Step 3: Number of cavities ────────────────────────────────────────────────
export function StepCavities({ p, set, c, t }) {
    const T = t.filterDesign;
    const sf = shapeFactor(p);
    const rec = recommendCavities({ shapeFactor: sf, Tpass: p.passLevel / 100, Tstop: p.stopLevel / 100 });
    const N = p.cavities ?? rec.recommended;
    useEffect(() => { if (p.cavities == null) set('cavities', rec.recommended); }, []); // eslint-disable-line
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h(StepHeader, { step: 3, title: T.step3.title, c }),
        h('p', { style: { margin: 0, fontSize: 13, color: c.text } }, T.step3.recommend(Math.max(1, rec.recommended - 1))),
        h(IntField, { label: T.step3.cavities, value: N, min: 1, max: 10, c, onChange: (v) => set('cavities', v) }),
        h('p', { style: { margin: 0, fontSize: 11, color: c.textDim } }, T.step3.hint(sf.toFixed(2), rec.q.toFixed(2))));
}
