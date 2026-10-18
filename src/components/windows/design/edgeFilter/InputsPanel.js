import { MaterialPicker } from '../../../ui/MaterialPicker.js';
import { NumberField } from '../../../ui/numberField.js';
import { designMaterialName } from '../../../../utils/materials/designMaterials.js';
import { EDGE_SEARCH_LIMITS } from '../../../../utils/synthesis/edgeFilter.js';
import { FooterBtn, SideSeg } from '../stackFormula/ui.js';

const { createElement: h } = React;

const L = EDGE_SEARCH_LIMITS;

const labelStyle = c => ({ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: c.textDim });
const fieldStyle = (c, width) => ({
    width, padding: '5px 7px', fontSize: 13, backgroundColor: c.bg, color: c.text,
    border: `1px solid ${c.border}`, borderRadius: 4, outline: 'none',
});

function numberInput({ state, c, key, label, width = 80, ...bounds }) {
    return h('label', { key, style: labelStyle(c) },
        h('span', {}, label),
        h(NumberField, { value: state.inputs[key], onChange: v => state.setInput(key, v), style: fieldStyle(c, width), ...bounds }));
}

function pickerInput({ state, c, t, key, label }) {
    return h('label', { key, style: { ...labelStyle(c), width: 190, maxWidth: '48%' } },
        h('span', {}, label),
        h(MaterialPicker, { value: state.inputs[key], onChange: v => state.setInput(key, v), c, t }));
}

// Shortwave or longwave pass, on Stack Formula's side switch.
function PassSeg({ state, c, ef }) {
    return h('div', { style: { alignSelf: 'flex-start' } },
        h(SideSeg, {
            value: state.inputs.pass, onChange: value => state.setInput('pass', value), c,
            opts: [['short', ef.shortPass], ['long', ef.longPass]],
        }));
}

const row = (...children) => h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' } }, ...children);

// How far the search has got, and what it assumes about an absorbing
// material. Why a search found nothing is said in the table.
function StatusLines({ state, c, ef, design }) {
    const { running, progress, prepared, inputs } = state;
    const lines = [];
    if (running) lines.push(progress ? ef.searching(progress.done, progress.total) : ef.searchStarted);
    if (prepared.absorbing?.length) {
        const names = prepared.absorbing.map(id => designMaterialName(design, id)).join(', ');
        lines.push(ef.absorbs(names, inputs.edgeLambda));
    }
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        lines.map((text, i) => h('div', {
            key: i, role: 'status', style: { fontSize: 11, lineHeight: 1.4, color: c.textDim },
        }, text)));
}

export function InputsPanel({ state, c, t, ef, design }) {
    const field = args => numberInput({ state, c, ...args });
    const picker = args => pickerInput({ state, c, t, ...args });
    return h('div', { style: { flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { style: { fontSize: 12, color: c.textDim } }, ef.intro),
        h(PassSeg, { state, c, ef }),
        row(
            field({ key: 'edgeLambda', label: ef.edgeLambda, width: 90, step: 1, positive: true }),
            // 0° is taken, so the search can say why it finds nothing there.
            field({ key: 'angle', label: ef.angle, width: 70, step: 1, min: 0 }),
            field({ key: 'periods', label: ef.periods, width: 60, step: 1, positive: true, integer: true }),
        ),
        row(
            picker({ key: 'incidentMat', label: ef.incidentMedium }),
            picker({ key: 'substrateMat', label: ef.substrate }),
        ),
        row(
            picker({ key: 'matA', label: ef.materialA }),
            picker({ key: 'matB', label: ef.materialB }),
        ),
        row(
            field({ key: 'lower', label: ef.lower, width: 64, step: 0.05, min: L.lowerMin, max: L.upperMax }),
            field({ key: 'upper', label: ef.upper, width: 64, step: 0.05, min: L.lowerMin, max: L.upperMax }),
            field({ key: 'step', label: ef.step, width: 64, step: 0.01, min: L.stepMin }),
            state.running
                ? h(FooterBtn, { onClick: state.stop, c }, ef.stop)
                : h(FooterBtn, { onClick: state.search, c, primary: true }, ef.search),
        ),
        h(StatusLines, { state, c, ef, design }),
    );
}
