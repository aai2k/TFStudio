import { chk } from './CheckField.js';
import { WARN } from './model.js';

const { createElement: h } = React;

export function ConstraintsRow({ c, noMNT, setNoMNT, useMNT40, setUseMNT40 }) {
    return h('div', { style: { marginBottom: 6 } },
        h('span', { style: { fontSize: 11, color: c.textDim, marginRight: 8 } }, 'Constraints (MNT min-thickness):'),
        chk(c, 'none', noMNT, setNoMNT), chk(c, 'MNT ≥ 40 nm', useMNT40, setUseMNT40),
        useMNT40
            ? h('span', { style: { fontSize: 10.5, color: WARN, marginLeft: 6 } }, '— GE, Structural & Refinement honor it; NEEDLE strips constraints by design (optical-only) → expect Min t violations on Needle rows only')
            : h('span', { style: { fontSize: 10.5, color: c.textDim, marginLeft: 6 } }, '— one-sided d ≥ nm penalty in the merit function; "Min t" shows if honored'));
}
