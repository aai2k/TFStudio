import { TrialDetailsPanel } from './TrialDetailsPanel.js';
import { TrialStatisticsPanel } from './TrialStatisticsPanel.js';
import {
    buildLayerStatistics,
    buildSpectralSpread,
    buildTrialDetailRows,
    loadTrialThicknesses,
} from './trialModel.js';

const { createElement: h, useCallback, useMemo, useState } = React;

function TabButton({ id, label, tab, setTab, c }) {
    return h('button', {
        onClick: () => setTab(id),
        style: {
            padding: '5px 16px', fontSize: 12, cursor: 'pointer', border: 'none', outline: 'none',
            borderBottom: `2px solid ${tab === id ? c.accent : 'transparent'}`,
            background: 'transparent', color: tab === id ? c.accent : c.textDim,
            fontWeight: tab === id ? 600 : 400, fontFamily: 'inherit',
        }
    }, label);
}

export function TrialsModal({ result, design, c, t, corridorSigma, updateDesign, checkpoint, onClose }) {
    const ea = t.errorAnalysis || {};
    const trials = result.trials || [];
    const [selected, setSelected] = useState(0);
    const [tab, setTab] = useState('stats');
    const [loaded, setLoaded] = useState(null);
    const front = design?.frontLayers || [];
    const back = design?.backLayers || [];
    const hasFront = trials[0]?.dThkF != null;
    const hasBack = trials[0]?.dThkB != null;

    const loadThicknesses = useCallback((dThkF, dThkB, tagN) => {
        if (!updateDesign) return;
        loadTrialThicknesses({ front, back, dThkF, dThkB, checkpoint, updateDesign });
        setLoaded(tagN);
    }, [front, back, updateDesign, checkpoint]);

    const stats = useMemo(() => buildLayerStatistics({ trials, front, back, hasFront, hasBack }),
        [result, design]); // eslint-disable-line react-hooks/exhaustive-deps
    const spread = useMemo(() => buildSpectralSpread(result, corridorSigma), [result, corridorSigma]);
    const trial = trials[selected] || null;
    const rows = buildTrialDetailRows({ front, back, trial, hasFront, hasBack });
    const panel = tab === 'stats'
        ? h(TrialStatisticsPanel, { result, stats, spread, corridorSigma, c, ea })
        : h(TrialDetailsPanel, {
            trials, selected, setSelected, trial, loaded, loadThicknesses, rows, c, t, ea,
        });

    return h('div', {
        onClick: onClose,
        style: {
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            WebkitAppRegion: 'no-drag',
        }
    },
        h('div', {
            onClick: (event) => event.stopPropagation(),
            style: {
                width: 'min(860px, 94vw)', height: 'min(600px, 88vh)',
                background: c.bg, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 6, overflow: 'hidden',
                display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
            }
        },
            h('div', { style: { display: 'flex', alignItems: 'center', padding: '6px 12px', borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0 } },
                h('span', { style: { fontWeight: 600, fontSize: 13 } }, ea.trialInspector || 'Trial inspector'),
                h('span', { style: { marginLeft: 10, color: c.textDim, fontSize: 11 } },
                    `${trials.length} ${ea.trialsDone || 'trials'}${result.spec ? ` · ${ea.specYield || 'yield'} ${result.spec.yield == null ? '—' : (result.spec.yield * 100).toFixed(0) + '%'}` : ''}`),
                h('div', { style: { flex: 1 } }),
                h('button', { onClick: onClose, title: ea.close || 'Close', style: { padding: '2px 10px', cursor: 'pointer', border: `1px solid ${c.border}`, borderRadius: 3, background: c.inputBg || c.hover, color: c.text } }, '✕'),
            ),
            h('div', { style: { display: 'flex', alignItems: 'center', borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0 } },
                h(TabButton, { id: 'stats', label: ea.tabStatistics || 'Statistics', tab, setTab, c }),
                h(TabButton, { id: 'trials', label: `${ea.tabTrials || 'Trials'} (${trials.length})`, tab, setTab, c }),
            ),
            panel,
        ),
    );
}
