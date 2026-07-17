import { BENCH_CASES } from '../../../../utils/benchmark/optimizerBenchmark.js';
import { PARETO, caseRows } from './model.js';
import { cardStyle } from './styles.js';
import { SummaryCaseBlock } from './SummaryCaseBlock.js';

const { createElement: h } = React;

export function SummaryPanel({ c, displayJobs, displayCaseIds, loadDesign }) {
    const cases = BENCH_CASES.filter((cc) => displayCaseIds.includes(cc.id) && caseRows(displayJobs, cc.id).some((r) => r.mf != null));
    if (!cases.length) return null;
    return h('div', { style: { ...cardStyle(c), marginBottom: 10, borderColor: `${PARETO}66` } },
        h('div', { style: { fontWeight: 700, color: c.text, marginBottom: 6, fontSize: 13 } },
            'Summary — Pareto-optimal configurations ',
            h('span', { style: { fontWeight: 400, color: c.textDim, fontSize: 11 } }, '(MF ↓ · time ↓ · layers ↓; non-dominated)')),
        cases.map((cc) => h(SummaryCaseBlock, { key: cc.id, cc, c, displayJobs, loadDesign })));
}
