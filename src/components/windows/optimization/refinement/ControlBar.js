// Top control bar of the Refinement window: Run/Stop/Reset/Best buttons, method
// selector, iteration budget, multi-start params, the seed of the stochastic
// methods, and the live MF/iter readout.
//
// The bar is composed from module-scope button/control/readout builders so the
// ControlBar component itself stays a flat assembly with no branching logic.

import { OptimizeBadge, EvalModeBadge } from '../../../SurfaceModeBar.js';
import { WARN_BADGE_STYLE } from '../synthesisShared/synthesisHelpers.js';
import { LiveUpdateSwitch } from '../../../ui/LiveUpdateSwitch.js';
import { NumberField } from '../../../ui/numberField.js';
import { REFINE_METHODS, ALL_ORDER } from './refinementConfig.js';
import { STOCHASTIC_METHODS } from './refinementUtils.js';
import { normalizeSeed } from '../../../../utils/physics/errorAnalysis/mcConfig.js';

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

// stopReason → the locale key of its label. Anything else reads as stalled.
const REASON_KEYS = {
    noOperands: 'noOperands', target: 'targetReached', maxiter: 'maxIterReached',
    workerFailed: 'workerFailed', presampleFailed: 'presampleFailed',
};

// Reasons that stopped a run before it changed the design: the amber warning
// badge rather than the pill.
const WARN_REASONS = new Set(['noOperands', 'workerFailed', 'presampleFailed']);
const isWarnReason = stopReason => WARN_REASONS.has(stopReason) || !!stopReason?.startsWith('invalidOperand:');

// stopReason → display label + whether it reads as a "good" (green) outcome.
// 'best: X' (try-all winner) is passed through verbatim.
function stopReasonView(stopReason, tr) {
    if (!stopReason) return { label: null, good: false };
    if (stopReason.startsWith('best:')) {
        const id = stopReason.slice('best:'.length);
        return { label: `${tr.bestLabel} ${tr.methods[id] || id}`, good: true };
    }
    if (stopReason.startsWith('invalidOperand:')) {
        return { label: stopReason.slice('invalidOperand:'.length), good: false };
    }
    return { label: tr[REASON_KEYS[stopReason] || 'stalled'], good: stopReason === 'target' };
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

// Seed of the stochastic methods: empty draws a fresh one, and a run leaves the
// seed it drew in the field, so pressing Run again replays it. An entry that is
// not a seed, such as 0, empties the field like an emptied one, rather than
// being moved onto a seed nobody chose.
function seedControl({ running, method, seed, onSeed, t, c }) {
    const tr = t.refinement;
    if (!(STOCHASTIC_METHODS.has(method) || method === 'all')) return null;
    return h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: c.textDim },
        title: tr.seedTip },
        tr.seed,
        h(NumberField, { nullable: true, emptyStep: 1, value: seed, disabled: running,
            placeholder: tr.seedRandom,
            onChange: v => onSeed(normalizeSeed(v)),
            style: { ...numInputStyle(c, running), width: 96 } }),
    );
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
                value: method, disabled: running, title: tr.methodNotes[method] || '',
                onChange: e => onMethod(e.target.value),
                style: { background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 2, fontSize: 11, padding: '2px 4px', cursor: running ? 'default' : 'pointer' },
            }, REFINE_METHODS.map(m => h('option', { key: m, value: m, title: tr.methodNotes[m] || '' }, tr.methods[m])))
        ),

        // Max iterations — applies to single-method runs (Try-all uses each
        // method's own budget). The run still stops early at convergence.
        method !== 'all' && h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: c.textDim },
            title: tr.maxIterTip },
            tr.maxIter || 'Max iter:',
            h(NumberField, { min: 1, step: 10, integer: true, value: maxIter, disabled: running,
                onChange: onMaxIter, style: numStyle }),
        ),

        // Multi-start params (shown for dls-multi and all)
        showMulti && h('span', { style: { fontSize: 11, color: c.textDim, display: 'flex', alignItems: 'center', gap: 3 } },
            tr.nRestarts,
            h(NumberField, { min: 1, step: 1, integer: true, value: nRestarts, disabled: running,
                onChange: onNRestarts, style: numStyle }),
        ),
        showMulti && h('span', { style: { fontSize: 11, color: c.textDim, display: 'flex', alignItems: 'center', gap: 3 } },
            tr.perturbPct,
            h(NumberField, { min: 0, step: 5, value: perturbPct, disabled: running,
                onChange: onPerturbPct, style: numStyle }),
        ),
    ];
}

// Live readout: restart/method progress, MF/best/init, iter count, and the
// end-of-run reason pill. Rendered inside one unit with the Live update switch.
function runReadout({ running, iter, mf, mfBest, mfInitial, restartIdx, method, nRestarts, stopReason, t, c }) {
    const tr = t.refinement;
    const reason = stopReasonView(stopReason, tr);
    const reasonPillStyle = isWarnReason(stopReason)
        ? { ...WARN_BADGE_STYLE, marginLeft: 8, cursor: 'help' }
        : { fontSize: 10, marginLeft: 8, padding: '1px 7px', borderRadius: 9, cursor: 'help',
            background: reason.good ? (c.success + '33') : (c.textDim + '26'), color: reason.good ? c.success : c.text,
            border: `1px solid ${reason.good ? (c.success + '66') : (c.textDim + '66')}` };
    return [
        restartIdx > 0 && h('span', { style: { fontSize: 11, color: c.accent || '#ffa726', fontStyle: 'italic', marginRight: 8 } },
            method === 'all'
                ? `${tr.tryingMethod || 'method'} ${restartIdx}/${ALL_ORDER.length}`
                : `${tr.restartLabel(restartIdx)} / ${nRestarts}`),
        mf != null && h('span', { style: { fontSize: 11, color: c.textDim } },
            `${tr.mfLabel} `, h('span', { style: { color: c.text, fontWeight: 600 } }, mf.toFixed(6)),
            mfBest != null && mfBest < mf - 1e-9
                ? h('span', { style: { color: c.success, marginLeft: 8 } }, ` ${tr.bestLabel} ${mfBest.toFixed(6)}`)
                : null,
            mfInitial != null
                ? h('span', { style: { color: c.textDim, marginLeft: 8 } }, `${tr.initLabel} ${mfInitial.toFixed(6)}`)
                : null
        ),
        h('span', { style: { fontSize: 11, color: c.textDim, marginLeft: 12 } },
            `${tr.iterLabel} `, h('span', { style: { color: c.text } }, iter)),
        (!running && reason.label) && h('span', {
            title: stopReason === 'stalled' ? tr.stalledTip : '',
            // A run that ended before it changed the design → the shared amber warning
            // badge (identical in every optimizer window). Other end-states keep the pill, in the
            // theme's own text colour so it reads on a light theme and a dark one.
            style: reasonPillStyle }, reason.label),
    ];
}

export function ControlBar(props) {
    const { c, t } = props;
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 8px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0, flexWrap: 'wrap',
        }
    },
        ...runButtons(props),
        ...runControls(props),
        seedControl(props),
        // The readout and the Live update switch are one unit anchored to the
        // right, so the numbers stay beside the switch and the group moves to
        // the next toolbar line together when the bar is narrow, instead of
        // its pieces wrapping one at a time as the window is resized.
        h('div', {
            'data-refinement-readout': true,
            style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', flexWrap: 'nowrap' },
        },
            ...runReadout(props),
            h('span', { style: { marginLeft: 12 } },
                h(LiveUpdateSwitch, { c, label: t.liveUpdate.label, title: t.liveUpdate.hint })),
        ),
    );
}
