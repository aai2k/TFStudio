import { STORE } from './store.js';

const { createElement: h } = React;

export function ProgressBar({ c, displayJobs, elapsed, pct }) {
    if (!STORE.running && STORE.doneN === 0) return null;
    return h('div', { style: { margin: '8px 10px 0' } },
        h('div', { style: { height: 6, background: c.border, borderRadius: 3, overflow: 'hidden' } },
            h('div', { style: { height: '100%', width: `${pct}%`, background: c.accent, transition: 'width 0.2s' } })),
        h('div', { style: { fontSize: 11, color: c.textDim, marginTop: 3, display: 'flex', justifyContent: 'space-between' } },
            h('span', null, `${STORE.doneN}/${displayJobs.length} cells (${pct}%)`),
            h('span', null, `${elapsed.toFixed(1)}s${STORE.running ? ' …' : ' · done'}`)));
}
