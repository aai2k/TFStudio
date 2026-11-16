// ── TutorialPlayer — interactive worked-example coach panel ─────────────────────
//
// Unlike the guided tour (GuidedTour.js), a tutorial is hands-on: the user must
// actually operate the real UI at each step. So this overlay is DELIBERATELY
// NON-BLOCKING — there is no full-screen dimmer and no click-catcher. It draws:
//
//   • a floating coach panel with the step text + Back/Next/Exit, in the bottom
//     corner away from the window the step highlights, so it never covers the
//     controls the step asks for. A step that highlights nothing sits left,
//     clear of Optical Evaluation on the right where lessons show their
//     results; a step may name its side (`panel: 'left' | 'right'`) when the
//     user acts on one side and reads the result on the other
//   • an optional accent highlight RING around the step's target element, with
//     pointer-events:none so every click passes straight through to the app
//
// Each step may carry an action (open a tool, load a starter design, set a
// layout) that fires ONCE when the step is first entered — re-visiting a step
// via Back/Next never re-runs it (so designs aren't created twice). The renderer
// supplies `onAction`; this component owns only step navigation + ring geometry.

import { useTargetRect } from './useTargetRect.js';
import { tablerIcon } from './ui/tablerIcons.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

const PAD = 5;
const PANEL_W = 350;

// The side of the screen the coach panel sits on (see the header).
function panelSideFor(step, rect) {
    if (step.panel) return step.panel;
    const targetOnLeft = !!rect && rect.left + rect.width / 2 < window.innerWidth / 2;
    return targetOnLeft ? 'right' : 'left';
}

// Why Next is blocked on this step, or null when it is not. A 'changed' gate
// holds until the design differs from its signature when the step began
// (`base`), and says what to do in the step's own `wait` text when it has one;
// a { minLayers } gate holds until the design holds that many layers.
function gateHintFor(step, base, designSig, designLayers, tt) {
    const { gate } = step;
    if (gate === true || gate === 'changed') {
        return base === undefined || designSig === base ? (step.wait || tt.gateRun) : null;
    }
    if (gate && typeof gate === 'object' && gate.minLayers != null) {
        const layers = designLayers || 0;
        return layers < gate.minLayers ? tt.gateLayers(gate.minLayers, layers) : null;
    }
    return null;
}

// Fire each step's action at most once per run (Back/Next won't re-trigger),
// and snapshot the design signature for 'changed' gates at the same moment.
// Returns the snapshots, by step index.
function useStepActions(idx, steps, designSig, onAction) {
    // Latest design signature and callback, readable inside the once-per-step effect.
    const designSigRef = useRef(designSig);
    useEffect(() => { designSigRef.current = designSig; });
    const onActionRef = useRef(onAction);
    useEffect(() => { onActionRef.current = onAction; });

    const firedRef = useRef(new Set());
    const gateBaseRef = useRef({});
    useEffect(() => {
        if (firedRef.current.has(idx)) return;
        firedRef.current.add(idx);
        const s = steps[idx];
        if (!s) return;
        if (s.gate && gateBaseRef.current[idx] === undefined) gateBaseRef.current[idx] = designSigRef.current;
        if (s.tool || s.loadDesign || s.layout || s.prep) {
            try { onActionRef.current?.({ tool: s.tool, loadDesign: s.loadDesign, layout: s.layout, prep: s.prep }); } catch (_) {}
        }
    }, [idx, steps]);
    return gateBaseRef;
}

const secondaryButtonStyle = c => ({
    padding: '7px 16px', borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${c.border}`, background: 'transparent', color: c.text,
});

// The step's forward button, greyed out with the gate's reason while blocked:
// Next, or on the last step Finish. When the curriculum has a lesson after
// this one, the last step offers it as the main button and Finish steps back.
function NextButton({ c, tt, gateHint, last, nextLesson, onNext, onNextLesson }) {
    const blocked = !!gateHint;
    const primaryStyle = {
        padding: '7px 18px', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
        cursor: blocked ? 'not-allowed' : 'pointer', border: 'none',
        background: blocked ? c.border : c.accent, color: blocked ? c.textDim : '#fff',
        opacity: blocked ? 0.7 : 1,
    };
    const button = (label, onClick, style) => h('button', {
        onClick: blocked ? undefined : onClick, disabled: blocked, title: gateHint || undefined, style,
    }, label);
    if (!last) return button(tt.next, onNext, primaryStyle);
    if (!nextLesson) return button(tt.finish, onNext, primaryStyle);
    return h(React.Fragment, null,
        button(tt.finish, onNext, secondaryButtonStyle(c)),
        button(tt.nextLesson, onNextLesson, primaryStyle));
}

// `nextLesson` ({ key, title }) is the lesson after this one, or null after the
// last; `onStartLesson(key)` starts it in place of this one.
export function TutorialPlayer({
    c, t, lesson, designSig = '', designLayers = 0, nextLesson = null,
    onAction, onComplete, onClose, onStartLesson,
}) {
    const [idx, setIdx] = useState(0);
    const steps = lesson.steps || [];
    const step = steps[idx] || {};
    const last = idx === steps.length - 1;
    const tt = t.tutorials.player;

    const rect = useTargetRect(step.selector);
    const panelSide = panelSideFor(step, rect);
    const gateBaseRef = useStepActions(idx, steps, designSig, onAction);

    // ── Gate: block Next until the step's condition is met ─────────────────────
    const gateHint = gateHintFor(step, gateBaseRef.current[idx], designSig, designLayers, tt);

    const finish = useCallback(() => { onComplete?.(lesson.key); onClose?.(true); }, [lesson.key, onComplete, onClose]);
    const next = useCallback(() => { if (last) finish(); else setIdx(i => i + 1); }, [last, finish]);
    const goToNextLesson = useCallback(() => {
        onComplete?.(lesson.key);
        onStartLesson?.(nextLesson.key);
    }, [lesson.key, nextLesson, onComplete, onStartLesson]);
    const back = useCallback(() => setIdx(i => Math.max(0, i - 1)), []);

    return h('div', { style: { position: 'fixed', inset: 0, zIndex: 10002, pointerEvents: 'none' } },
        // Highlight ring (non-blocking). The big translucent box-shadow gives a
        // gentle focus glow WITHOUT dimming/blocking the rest of the screen.
        rect && h('div', {
            style: {
                position: 'fixed',
                top: rect.top - PAD, left: rect.left - PAD,
                width: rect.width + PAD * 2, height: rect.height + PAD * 2,
                borderRadius: 8, pointerEvents: 'none',
                border: `2px solid ${c.accent}`,
                boxShadow: `0 0 0 2px ${c.accent}55, 0 0 18px 4px ${c.accent}40`,
                transition: 'all 0.18s ease',
            },
        }),

        // Coach panel (interactive).
        h('div', {
            style: {
                position: 'fixed', [panelSide]: 18, bottom: 18, width: PANEL_W, pointerEvents: 'auto',
                background: c.panel, border: `1px solid ${c.border}`, borderRadius: 12,
                boxShadow: '0 10px 40px rgba(0,0,0,0.55)', padding: 18, zIndex: 10003,
                fontFamily: 'system-ui, -apple-system, sans-serif',
            },
        },
            // Header: lesson title + progress + exit
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 } },
                h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
                    h('span', { style: { fontSize: 10.5, fontWeight: 700, color: c.accent, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, lesson.title),
                    h('span', { style: { fontSize: 10.5, color: c.textDim, marginTop: 2 } }, tt.stepOf(idx + 1, steps.length)),
                ),
                h('button', {
                    onClick: () => onClose?.(false),
                    title: tt.exit,
                    style: { display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', color: c.textDim, cursor: 'pointer', padding: '0 2px', flexShrink: 0 },
                }, tablerIcon('x', 16)),
            ),

            // Progress bar
            h('div', { style: { height: 3, background: c.border, borderRadius: 2, marginBottom: 12, overflow: 'hidden' } },
                h('div', { style: { height: '100%', width: `${((idx + 1) / steps.length) * 100}%`, background: c.accent, transition: 'width 0.2s' } }),
            ),

            // Step body
            h('div', { style: { fontSize: 14, fontWeight: 700, color: c.text, marginBottom: 6 } }, step.title),
            h('div', { style: { fontSize: 12.5, color: c.textDim, lineHeight: 1.5 } }, step.body),
            step.tip && h('div', {
                style: {
                    marginTop: 10, padding: '8px 10px', borderRadius: 7,
                    background: c.accent + '14', border: `1px solid ${c.accent}40`,
                    fontSize: 11.5, color: c.text, lineHeight: 1.45,
                },
            }, h('span', { style: { fontWeight: 700, color: c.accent } }, `${tt.tip}: `), step.tip),

            // Gate hint — shown while Next is blocked (must run/optimise first).
            gateHint && h('div', {
                style: {
                    marginTop: 14, padding: '8px 10px', borderRadius: 7,
                    background: '#e8943a18', border: '1px solid #e8943a55',
                    fontSize: 11.5, color: c.text, lineHeight: 1.45, display: 'flex', gap: 7, alignItems: 'center',
                },
            }, h('span', null, '⏳'), gateHint),

            last && nextLesson && h('div', {
                style: { marginTop: 14, fontSize: 11.5, color: c.textDim },
            }, tt.upNext(nextLesson.title)),

            // Controls
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 } },
                h('button', {
                    onClick: () => onClose?.(false),
                    style: { padding: '7px 10px', border: 'none', background: 'transparent', color: c.textDim, fontSize: 12, cursor: 'pointer' },
                }, tt.exit),
                h('div', { style: { display: 'flex', gap: 8 } },
                    idx > 0 && h('button', { onClick: back, style: secondaryButtonStyle(c) }, tt.back),
                    h(NextButton, {
                        c, tt, gateHint, last, nextLesson: onStartLesson ? nextLesson : null,
                        onNext: next, onNextLesson: goToNextLesson,
                    }),
                ),
            ),
        ),
    );
}
