import { chk } from './CheckField.js';

const { createElement: h } = React;

export function FeaturesRow({ c, doSeed, setDoSeed, doConsolidate, setDoConsolidate }) {
    return h('div', { style: { marginBottom: 6 } },
        h('span', { style: { fontSize: 11, color: c.textDim, marginRight: 8 } }, 'New features:'),
        chk(c, 'Smart seed (QW/HW AR row)', doSeed, setDoSeed),
        chk(c, '+ consolidation variant (·cons)', doConsolidate, setDoConsolidate),
        h('span', { style: { fontSize: 10.5, color: c.textDim, marginLeft: 6 } }, '— adds a "Smart seed" row and, per synth cell, a ·cons (layer-consolidated) twin for direct comparison'));
}
