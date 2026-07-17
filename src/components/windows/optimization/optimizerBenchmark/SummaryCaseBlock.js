import { paretoFront, seedForJob } from '../../../../utils/benchmark/optimizerBenchmark.js';
import { caseRows, OPT_LABEL, fmtMF, fmtMs, OK } from './model.js';
import { thStyle, tdStyle, linkBtnStyle } from './styles.js';

const { createElement: h } = React;

export function SummaryCaseBlock({ cc, c, displayJobs, loadDesign }) {
    const th = thStyle(c), td = tdStyle(c), linkBtn = linkBtnStyle(c);
    const rows0 = caseRows(displayJobs, cc.id).filter((r) => !r.err && Number.isFinite(r.mf)).map((r) => ({ ...r, key: r.job.id }));
    const front = paretoFront(rows0).sort((a, b) => a.mf - b.mf);
    const bestMF = Math.min(...rows0.map((r) => r.mf));
    return h('div', { style: { marginBottom: 8 } },
        h('div', { style: { fontSize: 12, color: c.text, fontWeight: 600, marginBottom: 2 } }, cc.name),
        h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null, h('tr', null,
                h('th', { style: th }, 'Optimizer'), h('th', { style: th }, 'Setting'),
                h('th', { style: { ...th, textAlign: 'right' } }, 'MF'),
                h('th', { style: { ...th, textAlign: 'right' } }, 'Layers'),
                h('th', { style: { ...th, textAlign: 'right' } }, 'Time'),
                h('th', { style: { ...th, textAlign: 'center' } }, 'Inspect'))),
            h('tbody', null, front.map((r) => h('tr', { key: r.key, style: { background: r.mf === bestMF ? `${OK}22` : 'transparent' } },
                h('td', { style: { ...td, color: c.text } }, OPT_LABEL[r.job.optimizer] || r.job.optimizer),
                h('td', { style: { ...td, color: c.textDim } }, r.job.setting),
                h('td', { style: { ...td, color: c.text, textAlign: 'right', fontWeight: r.mf === bestMF ? 700 : 400 } }, fmtMF(r.mf), r.mf === bestMF ? h('span', { style: { color: OK, marginLeft: 4 } }, '★') : null),
                h('td', { style: { ...td, color: c.textDim, textAlign: 'right' } }, r.layers),
                h('td', { style: { ...td, color: c.textDim, textAlign: 'right' } }, fmtMs(r.ms)),
                h('td', { style: { ...td, textAlign: 'center', whiteSpace: 'nowrap' } },
                    r.design ? h('button', { title: 'Load this result + open Optical Evaluation', onClick: () => loadDesign(r.design, r.job, 'result'), style: linkBtn }, 'design') : null,
                    h('button', { title: 'Load the starting point + open Optical Evaluation', onClick: () => loadDesign(seedForJob(r.job), r.job, 'seed'), style: { ...linkBtn, color: c.textDim } }, 'seed')))))));
}
