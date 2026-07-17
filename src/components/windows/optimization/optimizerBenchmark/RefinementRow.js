import { chk } from './CheckField.js';

const { createElement: h } = React;

export function RefinementRow({ c, refineLocal, setRefineLocal, sweepIter, setSweepIter, refineGlobal, setRefineGlobal }) {
    return h('div', { style: { marginBottom: 6 } },
        h('span', { style: { fontSize: 11, color: c.textDim, marginRight: 8 } }, 'Refinement:'),
        chk(c, 'Local (DLS/CG/Newton/Newton-CG/SQP)', refineLocal, setRefineLocal),
        chk(c, 'sweep maxIter 60/200/500 (else: run to convergence, matches window)', sweepIter, setSweepIter, !refineLocal),
        chk(c, 'Global (DE/SA/DLS-multi)', refineGlobal, setRefineGlobal));
}
