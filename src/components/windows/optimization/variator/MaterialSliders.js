import { SectionHeader } from './SectionHeader.js';
import { SliderRow } from './SliderRow.js';
import { matLabel } from './model.js';
import { resolveColor } from '../../../../utils/materials/catalogManager.js';

const { createElement: h } = React;

// Δn, Δk offset sliders — one pair per unique material in the stack.
// These offsets stay local to the Variator preview (see model.js).
export function MaterialSliders({ uniqueMats, dN, dK, setMatDN, setMatDK, c, v }) {
    return h('div', null,
        h(SectionHeader, { label: v.materials || 'Material n/k offsets', count: uniqueMats.length, c }),
        h('div', {
            style: {
                padding: '4px 10px 6px', fontSize: 10.5, color: c.textDim,
                background: c.panel + '40', borderBottom: `1px solid ${c.border}30`
            }
        }, v.matNote || 'Δn, Δk applied as constant offsets to dispersive n(λ), k(λ). Local to the Variator preview — other windows show the unperturbed materials.'),
        uniqueMats.map(({ id, mat }) => h('div', { key: id, style: { paddingBottom: 2, borderBottom: `1px solid ${c.border}30` } },
            h(SliderRow, {
                label: `${matLabel(mat)} · Δn`,
                value: dN[id] || 0, min: -0.5, max: 0.5, step: 0.001,
                unit: '', color: mat ? resolveColor(mat) : undefined, c,
                onChange: (val) => setMatDN(id, val),
                displayPrecision: 3,
                resetTip: v.resetRow,
            }),
            h(SliderRow, {
                label: `${matLabel(mat)} · Δk`,
                value: dK[id] || 0, min: -0.1, max: 0.1, step: 0.0005,
                unit: '', color: mat ? resolveColor(mat) : undefined, c,
                onChange: (val) => setMatDK(id, val),
                displayPrecision: 4,
                resetTip: v.resetRow,
            }),
        ))
    );
}
