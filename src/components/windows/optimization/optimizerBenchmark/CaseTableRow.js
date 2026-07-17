import { seedForJob } from '../../../../utils/benchmark/optimizerBenchmark.js';
import { OPT_LABEL, fmtMs, OK, WARN, ERR, PARETO } from './model.js';
import { rowStatus, rowMfText, rowLayers, rowColor, rowViolated, rowMinText } from './caseRowModel.js';
import { tdStyle, linkBtnStyle } from './styles.js';
import { STORE } from './store.js';

const { createElement: h } = React;

export function CaseTableRow({ r, best, front, c, loadDesign }) {
    const td = tdStyle(c), linkBtn = linkBtnStyle(c);
    const j = r.job;
    const isBest = r.mf != null && Number.isFinite(r.mf) && r.mf === best;
    const isPareto = front.has(j.id);
    const status = rowStatus(r, STORE.running);
    const mfText = rowMfText(r, STORE.running);
    const layers = rowLayers(r);
    const color = rowColor(status, c);
    const violated = rowViolated(j, r);
    const minTxt = rowMinText(r);
    return h('tr', { style: { background: isBest ? `${OK}22` : (isPareto ? `${PARETO}14` : 'transparent') } },
        h('td', { style: { ...td, color: c.text } }, OPT_LABEL[j.optimizer] || j.optimizer),
        h('td', { style: { ...td, color: c.textDim } }, j.group.replace('Refinement ', 'Refine ')),
        h('td', { style: { ...td, color: j.mnt ? WARN : c.textDim } }, j.setting),
        h('td', { style: { ...td, color, fontWeight: isBest ? 700 : 400, textAlign: 'right' } },
            mfText, isBest ? h('span', { style: { color: OK, marginLeft: 4 } }, '★') : null),
        h('td', { style: { ...td, color: c.textDim, textAlign: 'right' } }, layers),
        h('td', { style: { ...td, color: violated ? ERR : c.textDim, textAlign: 'right', fontWeight: violated ? 700 : 400 } },
            minTxt, violated ? '!' : ''),
        h('td', { style: { ...td, color: c.textDim, textAlign: 'right' } }, r.ms != null ? fmtMs(r.ms) : ''),
        h('td', { style: { ...td, textAlign: 'center', color: PARETO, fontSize: 10 } }, isPareto ? '◆' : ''),
        h('td', { style: { ...td, textAlign: 'center', whiteSpace: 'nowrap' } },
            r.design ? h('button', {
                title: 'Load this result design + open Optical Evaluation (preview only — not added to the explorer)',
                onClick: () => loadDesign(r.design, j, 'result'),
                style: linkBtn,
            }, 'design') : h('span', { style: { color: c.textDim, opacity: 0.4 } }, '–'),
            h('button', {
                title: 'Load the STARTING POINT (seed) this cell ran from + open Optical Evaluation',
                onClick: () => loadDesign(seedForJob(j), j, 'seed'),
                style: { ...linkBtn, color: c.textDim },
            }, 'seed')));
}
