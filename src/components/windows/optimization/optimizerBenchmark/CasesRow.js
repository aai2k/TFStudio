import { Checkbox } from '../../../ui/Checkbox.js';
import { BENCH_CASES } from '../../../../utils/benchmark/optimizerBenchmark.js';
import { STORE } from './store.js';

const { createElement: h } = React;

function caseCheckbox(c, cc, selCases, setSelCases) {
    return h('label', {
        key: cc.id, style: { display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 14, fontSize: 12, color: c.text, cursor: 'pointer' },
    }, h(Checkbox, {
        c, checked: selCases.has(cc.id), disabled: STORE.running,
        onChange: (e) => setSelCases((prev) => { const s = new Set(prev); e.target.checked ? s.add(cc.id) : s.delete(cc.id); return s; }),
    }), cc.name.split('  ')[0]);
}

export function CasesRow({ c, selCases, setSelCases }) {
    return h('div', { style: { marginBottom: 6 } },
        h('span', { style: { fontSize: 11, color: c.textDim, marginRight: 8 } }, 'Cases:'),
        BENCH_CASES.map((cc) => caseCheckbox(c, cc, selCases, setSelCases)));
}
