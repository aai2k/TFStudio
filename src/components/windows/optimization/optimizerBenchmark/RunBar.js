import { chk } from './CheckField.js';
import { OK, ERR } from './model.js';
import { STORE } from './store.js';

const { createElement: h } = React;

export function RunBar({
    c, budgetSec, setBudgetSec, showSeeds, setShowSeeds, showSummary, setShowSummary,
    previewJobs, estimate, copied, exportResults, hasRun, clear, run, stop,
}) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
        h('label', { style: { fontSize: 12, color: c.text, display: 'inline-flex', alignItems: 'center', gap: 6 } }, 'Synth budget',
            h('input', {
                type: 'number', min: 1, max: 60, step: 1, value: budgetSec, disabled: STORE.running,
                onChange: (e) => setBudgetSec(Math.max(1, Math.min(60, Number(e.target.value) || 12))),
                style: { width: 56, background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, padding: '2px 6px' },
            }), 's/run'),
        chk(c, 'seeds', showSeeds, setShowSeeds), chk(c, 'summary', showSummary, setShowSummary),
        h('div', { style: { flex: 1 } }),
        h('span', { style: { fontSize: 11, color: c.textDim } }, `${previewJobs.length} cells · ~${estimate}s est.`),
        (STORE.doneN > 0)
            ? h('button', { onClick: exportResults, title: 'Copy a tab-separated report to the clipboard (and download a .txt) for analysis', style: { padding: '6px 14px', background: 'transparent', color: copied ? OK : c.accent, border: `1px solid ${copied ? OK : c.accent}`, borderRadius: 5, fontWeight: 600, cursor: 'pointer' } }, copied ? 'Copied ✓' : 'Export')
            : null,
        (!STORE.running && hasRun)
            ? h('button', { onClick: clear, title: 'Clear all results (also clears the saved snapshot)', style: { padding: '6px 14px', background: 'transparent', color: c.textDim, border: `1px solid ${c.border}`, borderRadius: 5, fontWeight: 600, cursor: 'pointer' } }, 'Clear')
            : null,
        STORE.running
            ? h('button', { onClick: stop, style: { padding: '6px 18px', background: ERR, color: '#fff', border: 'none', borderRadius: 5, fontWeight: 600, cursor: 'pointer' } }, 'Stop')
            : h('button', { onClick: run, disabled: !previewJobs.length, style: { padding: '6px 18px', background: previewJobs.length ? c.accent : c.border, color: '#fff', border: 'none', borderRadius: 5, fontWeight: 600, cursor: previewJobs.length ? 'pointer' : 'default' } }, hasRun ? 'Re-run' : 'Run benchmark'));
}
