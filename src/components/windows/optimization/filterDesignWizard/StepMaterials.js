import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { MaterialPicker } from '../../../ui/MaterialPicker.js';
import { CheckField, NumField, StepHeader, fieldLabel, inputStyle } from './ui.js';

const { createElement: h } = React;

// ── Step 1: Materials ─────────────────────────────────────────────────────────
export function StepMaterials({ p, set, c, t }) {
    const T = t.filterDesign;
    const matH = getMaterialById(p.matH), matL = getMaterialById(p.matL);
    const kH = matH?.getNK ? matH.getNK(p.lambda0_nm)[1] : 0;
    const kL = matL?.getNK ? matL.getNK(p.lambda0_nm)[1] : 0;
    const lossy = (kH > 1e-5) || (kL > 1e-5);
    const subMat = getMaterialById(p.substrateMaterial);
    const nSub = subMat?.getNK ? subMat.getNK(p.lambda0_nm)[0] : null;
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(StepHeader, { step: 1, title: T.step1.title, c }),
        h('div', { style: { fontSize: 12, color: c.textDim, display: 'flex', gap: 20 } },
            h('span', {}, `${T.step1.substrate}: ${nSub ? `n=${nSub.toFixed(3)}` : '—'}`),
            h('span', {}, `${T.step1.incident}: ${p.incidentMedium.split(':').pop()}`)),
        h('p', { style: { margin: 0, fontSize: 12, color: c.textDim } }, T.step1.intro),
        h('div', { style: { display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'center', maxWidth: 480 } },
            h('label', { style: { fontSize: 12, color: c.textDim } }, `${T.step1.matH} (H)`),
            h(MaterialPicker, { value: p.matH, onChange: (v) => set('matH', v), c, t }),
            h('label', { style: { fontSize: 12, color: c.textDim } }, `${T.step1.matL} (L)`),
            h(MaterialPicker, { value: p.matL, onChange: (v) => set('matL', v), c, t }),
            h('label', { style: { fontSize: 12, color: c.textDim } }, T.step1.substrate),
            h(MaterialPicker, { value: p.substrateMaterial, onChange: (v) => set('substrateMaterial', v), c, t }),
            h('label', { style: { fontSize: 12, color: c.textDim } }, T.step1.incident),
            h(MaterialPicker, { value: p.incidentMedium, onChange: (v) => set('incidentMedium', v), c, t })),
        h('div', { style: { display: 'flex', gap: 16, alignItems: 'flex-end', marginTop: 4 } },
            h(CheckField, { label: T.step1.oblique, value: p.oblique, c, onChange: (v) => set('oblique', v) }),
            p.oblique && h(NumField, { label: T.step1.angle, value: p.aoi, min: 0, max: 89, step: 0.5, suffix: '°', c, width: 80, onChange: (v) => set('aoi', v) }),
            p.oblique && h('label', { style: fieldLabel(c) }, h('span', {}, T.step1.pol),
                h('select', { value: p.pol, onChange: (e) => set('pol', e.target.value), style: inputStyle(c, 90) },
                    [['avg', 'avg'], ['s', 's'], ['p', 'p']].map(([v, l]) => h('option', { key: v, value: v }, l))))),
        lossy && h('div', { style: { marginTop: 4, padding: '8px 12px', borderRadius: 4, backgroundColor: 'rgba(239,152,0,0.15)', border: `1px solid ${c.warning || '#ef9800'}`, fontSize: 12, color: c.text } },
            T.step1.lossyWarn));
}
