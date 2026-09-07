import { EvalModeBadge, OptimizeBadge } from '../../../SurfaceModeBar.js';

const { createElement: h } = React;

function chevron(open, c) {
    return h('svg', {
        width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
        stroke: c.textDim, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        style: { flexShrink: 0 },
    }, h('path', { d: open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6' }));
}

function meritValue(label, value, title, c) {
    return h('span', { title },
        label + ' ',
        h('span', { style: { color: c.text, fontWeight: 600 } }, value.toFixed(6)));
}

/**
 * The bar above the wizard. The chevron folds the form away; the bar itself
 * stays, carrying the evaluation badges and the merit values, and a one-line
 * summary of the form while it is folded.
 */
export function WizardHeader({ open, onToggle, summary, design, mf, omf, busy, c, t, te }) {
    const tw = te.wizard;
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 10, height: 26, padding: '0 10px',
            background: c.panel, borderBottom: `1px solid ${c.border}`, flexShrink: 0,
            boxSizing: 'border-box', fontSize: 11, color: c.textDim,
        },
    },
        h('button', {
            onClick: onToggle,
            title: open ? tw.collapse : tw.expand,
            'aria-expanded': open ? 'true' : 'false',
            style: {
                display: 'flex', alignItems: 'center', gap: 8, padding: 0,
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: c.text, fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
            },
        }, chevron(open, c), tw.title),
        !open && summary && h('span', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, summary),
        h('span', { style: { flex: 1 } }),
        h(OptimizeBadge, { design, c, t }),
        h(EvalModeBadge, { design, c, t }),
        busy && h('span', { style: { fontStyle: 'italic' } }, te.evaluating),
        mf != null && meritValue(te.mfLabel, mf, null, c),
        mf != null && omf != null && meritValue(te.omfLabel, omf, te.omfTip, c),
    );
}
