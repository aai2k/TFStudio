import { caseSeeds, paretoFront } from '../../../../utils/benchmark/optimizerBenchmark.js';
import { caseRows, sortRows } from './model.js';
import { cardStyle, thStyle } from './styles.js';
import { CaseTableRow } from './CaseTableRow.js';

const { createElement: h } = React;

function sortableHeader(ctx, label, key) {
    const { c, th, sort, toggleSort } = ctx;
    return h('th', {
        style: { ...th, textAlign: 'right', cursor: 'pointer', userSelect: 'none', color: sort.key === key ? c.accent : c.textDim },
        onClick: () => toggleSort(key),
    }, label, sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');
}

export function CaseTable({ cc, c, displayJobs, showSeeds, sort, toggleSort, loadDesign }) {
    const th = thStyle(c);
    const rows0 = caseRows(displayJobs, cc.id);
    if (!rows0.length) return null;
    let best = Infinity;
    for (const r of rows0) if (!r.err && Number.isFinite(r.mf) && r.mf < best) best = r.mf;
    const front = new Set(paretoFront(rows0.filter((r) => !r.err && Number.isFinite(r.mf)).map((r) => ({ ...r, key: r.job.id }))).map((p) => p.key));
    const sd = caseSeeds(cc.id);
    const rows = sortRows(rows0, sort).map((r) => h(CaseTableRow, { key: r.job.id, r, best, front, c, loadDesign }));
    const sortCtx = { c, th, sort, toggleSort };

    return h('div', { style: { ...cardStyle(c), marginBottom: 10 } },
        h('div', { style: { fontWeight: 600, color: c.text, marginBottom: showSeeds ? 4 : 6, fontSize: 13 } }, cc.name),
        showSeeds && sd ? h('div', { style: { fontSize: 10.5, color: c.textDim, marginBottom: 6, lineHeight: 1.5, fontFamily: 'monospace' } },
            h('div', null, `seed → refine: ${sd.refine}`),
            h('div', null, `seed → needle: ${sd.thick}`),
            h('div', null, `seed → GE/str: ${sd.thin}`)) : null,
        h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null, h('tr', null,
                h('th', { style: th }, 'Optimizer'), h('th', { style: th }, 'Family'),
                h('th', { style: th }, 'Setting'), sortableHeader(sortCtx, 'Merit (MF)', 'mf'),
                sortableHeader(sortCtx, 'Layers', 'layers'), h('th', { style: { ...th, textAlign: 'right' } }, 'Min t'),
                sortableHeader(sortCtx, 'Time', 'ms'),
                h('th', { style: { ...th, textAlign: 'center' } }, 'Par'),
                h('th', { style: { ...th, textAlign: 'center' } }, 'Inspect'))),
            h('tbody', null, rows)));
}
