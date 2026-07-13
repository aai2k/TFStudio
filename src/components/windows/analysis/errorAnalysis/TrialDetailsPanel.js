import { chip, tableStyles } from './ui.js';

const { createElement: h } = React;

function TrialList({ trials, selected, setSelected, c, ea }) {
    return h('div', {
        style: { width: 150, flexShrink: 0, borderRight: `1px solid ${c.border}`, overflowY: 'auto', background: c.panel + '55' }
    }, trials.map((trial, i) => {
        const failed = trial.spec && trial.spec.allPass === false;
        const mark = !trial.spec ? '' : failed ? '✗' : '✓';
        const markColor = !trial.spec ? c.textDim : failed ? c.error : c.success;
        return h('div', {
            key: i, onClick: () => setSelected(i),
            style: {
                padding: '4px 10px', cursor: 'pointer', fontSize: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: i === selected ? (c.accent + '33') : 'transparent',
                borderLeft: `2px solid ${i === selected ? c.accent : 'transparent'}`,
            }
        },
            h('span', null, `${ea.trialN || 'Trial'} ${trial.i}`),
            h('span', { style: { color: markColor, fontWeight: 700 } }, mark),
        );
    }));
}

function TrialToolbar({ trial, loaded, loadThicknesses, c, ea }) {
    if (!trial) return null;
    return h('div', {
        style: { padding: '6px 12px', borderBottom: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }
    },
        h('button', {
            onClick: () => loadThicknesses(trial.dThkF, trial.dThkB, trial.i),
            title: ea.loadTrialTip || 'Replace the active design\'s layer thicknesses with this trial\'s perturbed values (Δn/Δk are not applied — they are not stored on the design). Undoable with Ctrl+Z.',
            style: { padding: '4px 12px', cursor: 'pointer', border: `1px solid ${c.accent}`, borderRadius: 3, background: c.accent + '22', color: c.accent, fontWeight: 600, fontSize: 12, fontFamily: 'inherit' },
        }, `↧ ${ea.loadTrial || 'Load thicknesses into design'}`),
        loaded === trial.i && h('span', { style: { color: c.success, fontSize: 11 } }, ea.loadedOk || 'Loaded — Ctrl+Z to undo'),
    );
}

function TrialSpecBand({ trial, c, t, ea }) {
    if (!trial || !trial.spec) return null;
    return h('div', {
        style: { padding: '6px 12px', borderBottom: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }
    },
        chip(
            trial.spec.allPass
                ? (ea.specAllPassShort || 'Spec PASS')
                : `${trial.spec.total - trial.spec.passing}/${trial.spec.total} ${(t.specification && t.specification.failSuffix) || 'fail'}`,
            trial.spec.allPass ? c.success : c.error, null, 'v',
        ),
        ...(trial.spec.results || []).filter((result) => result.pass === false).map((result, i) =>
            chip(`✗ ${result.label} = ${result.value ?? '—'}`, '#ef5350', null, i)),
    );
}

function TrialLayerTable({ rows, hasIndexErrors, c, ea }) {
    const { th, td } = tableStyles(c);
    return h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null, h('tr', null,
                h('th', { style: { ...th, textAlign: 'left' } }, ea.colLayer || 'Layer'),
                h('th', { style: { ...th, textAlign: 'left' } }, ea.colMaterial || 'Material'),
                h('th', { style: th }, ea.colNominal || 'd₀ (nm)'),
                h('th', { style: th }, 'Δd (nm)'),
                h('th', { style: th }, ea.colNew || 'd (nm)'),
                hasIndexErrors && h('th', { style: th }, 'Δn'),
                hasIndexErrors && h('th', { style: th }, 'Δk'),
            )),
            h('tbody', null, rows.map((row, i) => {
                const newD = Math.max(0, row.nominal + row.dThk);
                const deltaColor = Math.abs(row.dThk) < 1e-9 ? c.textDim : (row.dThk > 0 ? '#4fc3f7' : '#ef9800');
                return h('tr', { key: i, style: { background: i % 2 ? c.panel + '44' : 'transparent' } },
                    h('td', { style: { ...td, textAlign: 'left', color: c.text } }, row.label),
                    h('td', { style: { ...td, textAlign: 'left', color: c.textDim } },
                        h('span', {
                            title: row.material || '',
                            style: { display: 'inline-block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }
                        }, row.material || '—')),
                    h('td', { style: { ...td, color: c.textDim } }, row.nominal.toFixed(2)),
                    h('td', { style: { ...td, color: deltaColor, fontWeight: 600 } }, (row.dThk >= 0 ? '+' : '') + row.dThk.toFixed(3)),
                    h('td', { style: { ...td, color: c.text } }, newD.toFixed(2)),
                    hasIndexErrors && h('td', { style: { ...td, color: c.textDim } }, row.dn != null ? (row.dn >= 0 ? '+' : '') + row.dn.toFixed(4) : '—'),
                    hasIndexErrors && h('td', { style: { ...td, color: c.textDim } }, row.dk != null ? (row.dk >= 0 ? '+' : '') + row.dk.toFixed(4) : '—'),
                );
            })),
        ),
    );
}

export function TrialDetailsPanel(props) {
    const { trials, selected, setSelected, trial, loaded, loadThicknesses, rows, c, t, ea } = props;
    const hasIndexErrors = rows.some((row) => row.dn != null || row.dk != null);
    return h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } },
        h(TrialList, { trials, selected, setSelected, c, ea }),
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h(TrialToolbar, { trial, loaded, loadThicknesses, c, ea }),
            h(TrialSpecBand, { trial, c, t, ea }),
            h(TrialLayerTable, { rows, hasIndexErrors, c, ea }),
        ),
    );
}
