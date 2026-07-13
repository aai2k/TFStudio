import { tableStyles } from './ui.js';

const { createElement: h } = React;

function StatRow({ c, label, value, color }) {
    return h('div', {
        style: { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '3px 0', borderBottom: `1px solid ${c.border}55` }
    },
        h('span', { style: { color: c.textDim, fontSize: 12 } }, label),
        h('span', { style: { color: color || c.text, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' } }, value),
    );
}

function WorstRequirements({ c, ea, sp, offenders, th, td }) {
    if (!sp) return null;
    if (offenders.length === 0) {
        return h('div', { style: { fontSize: 12, color: c.success, padding: '3px 0' } },
            ea.allReqsPass || 'All requirements pass in every trial');
    }
    return h('table', { style: { width: '100%', borderCollapse: 'collapse', marginTop: 2 } },
        h('thead', null, h('tr', null,
            h('th', { style: { ...th, textAlign: 'left' } }, ea.colReq || 'Requirement'),
            h('th', { style: th }, ea.colFailRate || 'Fail rate'),
        )),
        h('tbody', null, offenders.map((qualifier, i) => h('tr', {
            key: i, style: { background: i % 2 ? c.panel + '44' : 'transparent' }
        },
            h('td', { style: { ...td, textAlign: 'left', color: c.text } }, qualifier.label),
            h('td', { style: { ...td, color: '#ef5350', fontWeight: 600 } }, `${(qualifier.failRate * 100).toFixed(0)}%`),
        ))),
    );
}

function WorstLayers({ c, ea, layers, haveFails, th, td }) {
    if (layers.length === 0) return null;
    return h('table', { style: { width: '100%', borderCollapse: 'collapse', marginTop: 2 } },
        h('thead', null, h('tr', null,
            h('th', { style: { ...th, textAlign: 'left' } }, ea.colLayer || 'Layer'),
            h('th', { style: { ...th, textAlign: 'left' } }, ea.colMaterial || 'Material'),
            h('th', { style: th }, ea.colRmsD || 'RMS Δd'),
            haveFails && h('th', { style: th, title: ea.colFailDTip || 'Mean |Δd| in failing trials' }, ea.colFailD || 'Δ̄ fail'),
            haveFails && h('th', { style: th, title: ea.colPassDTip || 'Mean |Δd| in passing trials' }, ea.colPassD || 'Δ̄ pass'),
        )),
        h('tbody', null, layers.map((layer, i) => h('tr', {
            key: i, style: { background: i % 2 ? c.panel + '44' : 'transparent' }
        },
            h('td', { style: { ...td, textAlign: 'left', color: c.text } }, layer.label),
            h('td', { style: { ...td, textAlign: 'left', color: c.textDim } },
                h('span', {
                    title: layer.material || '',
                    style: { display: 'inline-block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }
                }, layer.material || '—')),
            h('td', { style: { ...td, color: c.text } }, `${layer.rms.toFixed(2)} nm`),
            haveFails && h('td', {
                style: { ...td, color: layer.offender > 1e-6 ? '#ffb74d' : c.textDim, fontWeight: layer.offender > 1e-6 ? 600 : 400 }
            }, `${layer.meanFail.toFixed(2)}`),
            haveFails && h('td', { style: { ...td, color: c.textDim } }, `${layer.meanPass.toFixed(2)}`),
        ))),
    );
}

const formatPercent = (value) => value == null ? '—' : (value * 100).toFixed(2) + '%';

function OverviewStatistics({ result, corridorSigma, blockLbl, c, ea }) {
    const sp = result.spec;
    const yieldCol = !sp || sp.yield == null ? c.textDim : sp.yield >= 0.95 ? c.success : sp.yield >= 0.8 ? c.warning : c.error;
    return h(React.Fragment, null,
        h('div', { style: blockLbl }, ea.statsOverview || 'Overview'),
        h(StatRow, { c, label: ea.trialsDone || 'Trials', value: String(result.nTrials) }),
        h(StatRow, { c, label: ea.statCharacteristic || 'Characteristic', value: String(result.char) }),
        corridorSigma != null && h(StatRow, { c, label: ea.statCorridor || 'Corridor', value: `±${corridorSigma}σ` }),
        sp && h(StatRow, {
            c, label: ea.specYield || 'Spec yield',
            value: sp.yield == null ? '—' : `${(sp.yield * 100).toFixed(1)}%  (${sp.passCount}/${sp.evaluated})`,
            color: yieldCol,
        }),
    );
}

function SpreadStatistics({ spread, corridorSigma, blockLbl, c, ea }) {
    return h(React.Fragment, null,
        h('div', { style: blockLbl }, ea.statsSpread || 'Spectral spread (Monte-Carlo σ)'),
        h(StatRow, { c, label: ea.statMeanSigma || 'Mean σ', value: formatPercent(spread.meanSig) }),
        h(StatRow, {
            c, label: ea.statPeakSigma || 'Peak σ',
            value: `${formatPercent(spread.maxSig)}${spread.maxLam != null ? `  @ ${spread.maxLam} nm` : ''}`,
        }),
        h(StatRow, {
            c, label: ea.statCorridorWidth || `Mean corridor width (±${corridorSigma ?? 1}σ)`,
            value: formatPercent(spread.meanWidth),
        }),
    );
}

function WorstLayersSection({ layers, haveFails, blockLbl, th, td, c, ea }) {
    return h(React.Fragment, null,
        layers.length > 0 && h('div', {
            style: blockLbl,
            title: haveFails
                ? (ea.worstLayersTip || 'Layers whose thickness deviates more in failing trials than passing ones — the likely culprits.')
                : (ea.worstLayersRmsTip || 'Layers with the largest RMS thickness deviation across all trials.'),
        }, haveFails
            ? (ea.worstLayers || 'Worst layers (failure-correlated)')
            : (ea.worstLayersRms || 'Most-perturbed layers (RMS Δd)')),
        h(WorstLayers, { c, ea, layers, haveFails, th, td }),
    );
}

export function TrialStatisticsPanel({ result, stats, spread, corridorSigma, c, ea }) {
    const { th, td } = tableStyles(c);
    const blockLbl = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: c.textDim, margin: '4px 0 2px' };
    const sp = result.spec;
    const offenders = ((sp && sp.perQualifier) || [])
        .filter((qualifier) => qualifier.failRate > 0)
        .sort((a, b) => b.failRate - a.failRate);
    const haveFails = stats.nFailTrials > 0;
    const layers = (haveFails ? stats.byOffender : stats.byRms).slice(0, 12);

    return h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 14px' } },
        h(OverviewStatistics, { result, corridorSigma, blockLbl, c, ea }),
        h(SpreadStatistics, { spread, corridorSigma, blockLbl, c, ea }),
        sp && h('div', { style: blockLbl }, ea.worstReqs || 'Worst requirements'),
        h(WorstRequirements, { c, ea, sp, offenders, th, td }),
        h(WorstLayersSection, { layers, haveFails, blockLbl, th, td, c, ea }),
    );
}
