import { chk } from './CheckField.js';

const { createElement: h } = React;

export function SynthesisRow({ c, doNeedle, setDoNeedle, doGE, setDoGE, doStruct, setDoStruct, useD1, setUseD1, useD40, setUseD40 }) {
    return h('div', { style: { marginBottom: 6 } },
        h('span', { style: { fontSize: 11, color: c.textDim, marginRight: 8 } }, 'Synthesis:'),
        chk(c, 'Needle', doNeedle, setDoNeedle), chk(c, 'Gradual Evol.', doGE, setDoGE), chk(c, 'Structural', doStruct, setDoStruct),
        h('span', { style: { fontSize: 11, color: c.textDim, margin: '0 8px 0 14px' } }, 'dMin:'),
        chk(c, '1 (free)', useD1, setUseD1), chk(c, '40 (constrained)', useD40, setUseD40));
}
