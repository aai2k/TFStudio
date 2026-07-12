// Top control bar of the Refinement window: Run/Stop/Reset/Best buttons, method
// selector, iteration budget, multi-start params, and the live MF/iter readout.
//
// The bar is composed from module-scope button/control/readout builders so the
// ControlBar component itself stays a flat assembly with no branching logic.

import { OptimizeBadge, EvalModeBadge } from '../../../SurfaceModeBar.js';
import { WARN_BADGE_STYLE } from '../synthesisHelpers.js';
import { REFINE_METHODS, METHOD_LABELS, METHOD_NOTES, ALL_ORDER } from './refinementConfig.js';

const { createElement: h } = React;   // React is a window global

const btnStyle = (color, disabled, c) => ({
    padding: '3px 14px', fontSize: 12, border: 'none', borderRadius: 3,
    background: disabled ? c.border : color, color: disabled ? c.textDim : '#fff',
    cursor: disabled ? 'default' : 'pointer', fontWeight: 600, fontFamily: 'inherit', opacity: disabled ? 0.5 : 1
});

const numInputStyle = (c, running) => ({
    width: 52, padding: '1px 4px', fontSize: 11, textAlign: 'right',
    background: c.bg, color: c.text,
    border: `1px solid ${c.border}`, borderRadius: 2,
    opacity: running ? 0.5 : 1,
});

// stopReason → display label + whether it reads as a "good" (green) outcome.
// 'best: X' (try-all winner) is passed through verbatim.
function stopReasonView(stopReason, tr) {
    if (!stopReason) return { label: null, good: false };
    if (stopReason.startsWith('best:')) return { label: stopReason, good: true };
    const label = stopReason === 'noOperands' ? tr.noOperands
        : stopReason === 'target'  ? (tr.targetReached || 'target reached')
        : stopReason === 'maxiter' ? (tr.maxIterReached || 'max iter')
        : (tr.stalled || 'no further improvement');
    return { label, good: stopReason === 'target' };
}

// Run / Stop / Reset / Best + the surface-mode badges.
function runButtons({ running, canReset, onRun, onStop, onReset, onBest, surfaceMode, mfEvalMode, t, c }) {
    const tr = t.refinement;
    return [
        h('button', { onClick: running ? onStop : onRun, style: btnStyle(running ? c.error : c.success, false, c) },
            running ? `■ ${tr.stop}` : `▶ ${tr.run}`),
        h('button', { onClick: onReset, disabled: !canReset, style: btnStyle('#5c6bc0', !canReset, c) }, tr.reset),
        h('button', { onClick: onBest,  disabled: !canReset, style: btnStyle('#0288d1', !canReset, c) }, tr.best),
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
            h(OptimizeBadge, { design: { surfaceMode, mfEvalMode }, c, t }),
            h(EvalModeBadge, { design: { surfaceMode, mfEvalMode }, c, t }),
        ),
    ];
}

// Method selector + max-iter + multi-start (nRestarts / perturbPct) inputs.
function runControls({ running, method, nRestarts, perturbPct, maxIter, onMethod, onNRestarts, onPerturbPct, onMaxIter, t, c }) {
    const tr = t.refinement;
    const numStyle = numInputStyle(c, running);
    const showMulti = method === 'dls-multi' || method === 'all';
    return [
        // Method selector (persisted globally)
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, marginLeft: 10, fontSize: 11, color: c.textDim } },
            tr.method || 'Method:',
            h('select', {
                value: method, disabled: running, title: METHOD_NOTES[method] || '',
                onChange: e => onMethod(e.target.value),
                style: { background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 2, fontSize: 11, padding: '2px 4px', cursor: running ? 'default' : 'pointer' },
            }, REFINE_METHODS.map(m => h('option', { key: m, value: m, title: METHOD_NOTES[m] || '' }, METHOD_LABELS[m])))
        ),

        // Max iterations — applies to single-method runs (Try-all uses each
        // method's own budget). The run still stops early at convergence.
        method !== 'all' && h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: c.textDim },
            title: 'Maximum optimizer iterations (the run still stops early at convergence). Defaults to the selected method’s natural budget.' },
            tr.maxIter || 'Max iter:',
            h('input', { type: 'number', min: 1, step: 10, value: maxIter, disabled: running,
                onChange: e => { const v = parseInt(e.target.value); if (!isNaN(v)) onMaxIter(Math.max(1, v)); },
                style: numStyle }),
        ),

        // Multi-start params (shown for dls-multi and all)
        showMulti && h('span', { style: { fontSize: 11, color: c.textDim, display: 'flex', alignItems: 'center', gap: 3 } },
            tr.nRestarts,
            h('input', { type: 'number', min: 1, step: 1, value: nRestarts, disabled: running,
                onChange: e => { const v = parseInt(e.target.value); if (!isNaN(v)) onNRestarts(Math.max(1, v)); },
                style: numStyle }),
        ),
        showMulti && h('span', { style: { fontSize: 11, color: c.textDim, display: 'flex', alignItems: 'center', gap: 3 } },
            tr.perturbPct,
            h('input', { type: 'number', min: 0, step: 5, value: perturbPct, disabled: running,
                onChange: e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onPerturbPct(Math.max(0, v)); },
                style: numStyle }),
        ),
    ];
}

// Right-aligned live readout: restart/method progress, MF/best/init, iter count,
// and the end-of-run reason pill.
function runReadout({ running, iter, mf, mfBest, mfInitial, restartIdx, method, nRestarts, stopReason, t, c }) {
    const tr = t.refinement;
    const reason = stopReasonView(stopReason, tr);
    const reasonPillStyle = stopReason === 'noOperands'
        ? { ...WARN_BADGE_STYLE, marginLeft: 8, cursor: 'help' }
        : { fontSize: 10, marginLeft: 8, padding: '1px 7px', borderRadius: 9, cursor: 'help',
            background: reason.good ? (c.success + '33') : '#8d6e6344', color: reason.good ? c.success : '#d7c4a8',
            border: `1px solid ${reason.good ? (c.success + '66') : '#8d6e6388'}` };
    return [
        h('div', { style: { flex: 1 } }),
        restartIdx > 0 && h('span', { style: { fontSize: 11, color: c.accent || '#ffa726', fontStyle: 'italic', marginRight: 8 } },
            method === 'all'
                ? `${tr.tryingMethod || 'method'} ${restartIdx}/${ALL_ORDER.length}`
                : `${tr.restartLabel(restartIdx)} / ${nRestarts}`),
        mf != null && h('span', { style: { fontSize: 11, color: c.textDim } },
            `${tr.mfLabel} `, h('span', { style: { color: c.text, fontWeight: 600 } }, mf.toFixed(6)),
            mfBest != null && mfBest < mf - 1e-9
                ? h('span', { style: { color: c.success, marginLeft: 8 } }, ` best: ${mfBest.toFixed(6)}`)
                : null,
            mfInitial != null
                ? h('span', { style: { color: c.textDim, marginLeft: 8 } }, `init: ${mfInitial.toFixed(6)}`)
                : null
        ),
        h('span', { style: { fontSize: 11, color: c.textDim, marginLeft: 12 } },
            `${tr.iterLabel} `, h('span', { style: { color: c.text } }, iter)),
        (!running && reason.label) && h('span', {
            title: stopReason === 'stalled' ? 'No improvement for many iterations — at a (local) minimum for this method.' : '',
            // Empty merit function → the shared amber warning badge (identical in
            // every optimizer window). Other end-states keep the pill, but with a
            // lighter tan so it's readable (was brown-on-brown).
            style: reasonPillStyle }, reason.label),
    ];
}

export function ControlBar(props) {
    const { c } = props;
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 8px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0, flexWrap: 'wrap',
        }
    },
        ...runButtons(props),
        ...runControls(props),
        ...runReadout(props),
    );
}
