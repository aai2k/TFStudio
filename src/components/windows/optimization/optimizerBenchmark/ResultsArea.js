import { BENCH_CASES } from '../../../../utils/benchmark/optimizerBenchmark.js';
import { ERR } from './model.js';
import { STORE } from './store.js';
import { SummaryPanel } from './SummaryPanel.js';
import { CaseTable } from './CaseTable.js';
import { Legend } from './Legend.js';

const { createElement: h } = React;

export function ResultsArea({ c, displayJobs, displayCaseIds, showSummary, showSeeds, sort, toggleSort, loadDesign }) {
    const errResult = STORE.results.get('__err');
    const body = errResult
        ? h('div', { style: { color: ERR, padding: 12 } }, errResult.err)
        : (displayJobs.length
            ? [
                showSummary ? h(SummaryPanel, { key: 'summary', c, displayJobs, displayCaseIds, loadDesign }) : null,
                ...BENCH_CASES.filter((cc) => displayCaseIds.includes(cc.id)).map((cc) => h(CaseTable, { key: cc.id, cc, c, displayJobs, showSeeds, sort, toggleSort, loadDesign })),
            ]
            : h('div', { style: { color: c.textDim, padding: 20, textAlign: 'center' } }, 'Select at least one case and one optimizer family.'));
    return h('div', { style: { flex: 1, overflow: 'auto', padding: 10 } },
        body,
        h(Legend, { c }));
}
