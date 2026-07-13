import { EvalModeBadge, ConeBadge } from '../../../SurfaceModeBar.js';
import { OverlayChart } from './OverlayChart.js';

const { createElement: h } = React;

export function Placeholder(props) {
    const { message, c } = props;
    return h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        },
    }, message);
}

export function ChartPanel(props) {
    const { spectrum, selected, selectedResult, c, theme, t } = props;
    return h('div', {
        style: { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
    },
        h('div', {
            style: {
                padding: '4px 10px', fontSize: 11, color: c.textDim,
                borderBottom: `1px solid ${c.border}`, background: c.panel + '55',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            },
        }, selected
            ? `${selected.label}: ${selected.char}(λ) × ${selected.weighting.label}  — ${selected.weighting.reference}`
            : ''),
        h('div', { style: { flex: 1, minHeight: 0 } },
            spectrum && selected
                ? h(OverlayChart, {
                    spectrum, char: selected.char, weighting: selected.weighting,
                    minMaxMarks: selectedResult, c, theme,
                })
                : h(Placeholder, { message: t.integralValues.computing, c })),
    );
}

export function StatusBar(props) {
    const { design, spectrum, params, customCount, c, t } = props;
    return h('div', {
        style: {
            padding: '3px 10px', borderTop: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 12,
            fontSize: 11, color: c.textDim,
        },
    },
        h('span', null, design.name),
        spectrum && h('span', null,
            `${spectrum.lambda.length} λ samples, ${params.lambdaStart}–${params.lambdaEnd} nm @ ${params.lambdaStep} nm`),
        h(EvalModeBadge, { design, c, t }),
        h(ConeBadge, { design, c, t }),
        customCount > 0 && h('span', null, `· ${customCount} custom`),
    );
}
