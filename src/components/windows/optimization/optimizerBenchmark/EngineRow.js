import { Checkbox } from '../../../ui/Checkbox.js';
import { SYNTH_ENGINES } from '../../../../utils/benchmark/optimizerBenchmark.js';
import { STORE } from './store.js';

const { createElement: h } = React;

// Which inner refiner(s) the synthesis tools (Needle/GE/Structural) use.
const ENG_LABEL = { dls: 'DLS', cg: 'CG', newton: 'Newton', 'newton-cg': 'Newton-CG', sqp: 'SQP' };

export function EngineRow({ c, engSel, toggleEng }) {
    return h('div', { style: { marginBottom: 6 } },
        h('span', { style: { fontSize: 11, color: c.textDim, marginRight: 8 } }, 'Synthesis inner refiner (which method Needle/GE/Structural use):'),
        SYNTH_ENGINES.map((e) => h('label', {
            key: e, style: { display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 12, fontSize: 12, color: c.text, cursor: STORE.running ? 'default' : 'pointer' },
        }, h(Checkbox, { c, checked: engSel.has(e), disabled: STORE.running, onChange: () => toggleEng(e) }), ENG_LABEL[e])));
}
