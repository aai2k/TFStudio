import { chip } from './ui.js';

const { createElement: h } = React;

function SpecStatus({ spec, c, ea }) {
    const yieldValue = spec.yield;
    const color = yieldValue == null
        ? c.textDim
        : yieldValue >= 0.95 ? c.success : yieldValue >= 0.8 ? c.warning : c.error;
    const failures = (spec.perQualifier || [])
        .filter((qualifier) => qualifier.failRate > 0)
        .sort((a, b) => b.failRate - a.failRate);
    return h('span', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }
    },
        h('span', { style: { color, fontWeight: 600 } },
            `${ea.specYield || 'Spec yield'}: ${yieldValue == null ? '—' : (yieldValue * 100).toFixed(0) + '%'}`),
        ...failures.map((failure, i) => chip(
            `✗ ${failure.label} ${(failure.failRate * 100).toFixed(0)}%`, '#ef5350',
            `${failure.label}: fails ${(failure.failRate * 100).toFixed(0)}% of trials`, i)),
        failures.length === 0 && chip(ea.specAllPass || 'all pass', c.success, null, 'allpass'),
    );
}

export function ErrorAnalysisStatus({ controller, c, ea }) {
    const { design, running, progress, result, corridorSigma, setShowTrials } = controller;
    const showCompleted = result && !running;
    const showTrials = showCompleted && !!result.trials?.length;
    const showSpec = showCompleted && result.spec;
    return h(React.Fragment, null,
        h('div', {
            style: {
                padding: '3px 10px', borderTop: `1px solid ${c.border}`,
                background: c.panel, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                fontSize: 11, color: c.textDim,
            }
        },
            h('span', null, design.name),
            running && h('span', { style: { color: c.accent } },
                `${ea.running}: ${progress.i}/${progress.total}`),
            showCompleted && h('span', null,
                `${result.nTrials} ${ea.trialsDone}, ${result.char}, ${corridorSigma}σ corridor`),
            showTrials && h('button', {
                onClick: () => setShowTrials(true),
                title: ea.viewTrialsTip || 'Inspect each trial — the per-layer Δd / Δn / Δk applied and whether the spec passed',
                style: {
                    padding: '1px 8px', fontSize: 11, cursor: 'pointer',
                    border: `1px solid ${c.accent}`, borderRadius: 3,
                    background: c.accent + '22', color: c.accent,
                },
            }, ea.viewTrials || 'View trials…'),
            showSpec && h(SpecStatus, { spec: result.spec, c, ea }),
        ),
        running && h('div', {
            style: { height: 3, background: c.border, flexShrink: 0 }
        },
            h('div', {
                style: {
                    height: '100%', background: c.accent,
                    width: progress.total ? `${100 * progress.i / progress.total}%` : '0%',
                    transition: 'width 100ms linear',
                }
            }),
        ),
    );
}
