// ── TutorialPlayer — interactive worked-example coach panel ─────────────────────
//
// Unlike the guided tour (GuidedTour.js), a tutorial is hands-on: the user must
// actually operate the real UI at each step. So this overlay is DELIBERATELY
// NON-BLOCKING — there is no full-screen dimmer and no click-catcher. It draws:
//
//   • a floating coach panel (bottom-right) with the step text + Back/Next/Exit
//   • an optional accent highlight RING around the step's target element, with
//     pointer-events:none so every click passes straight through to the app
//
// Each step may carry an action (open a tool, load a starter design, set a
// layout) that fires ONCE when the step is first entered — re-visiting a step
// via Back/Next never re-runs it (so designs aren't created twice). The renderer
// supplies `onAction`; this component owns only step navigation + ring geometry.

import { useTargetRect } from './useTargetRect.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

const PAD = 5;
const PANEL_W = 350;

export function TutorialPlayer({ c, t, lesson, designSig = '', designLayers = 0, onAction, onComplete, onClose }) {
    const [idx, setIdx] = useState(0);
    const steps = lesson.steps || [];
    const step = steps[idx] || {};
    const last = idx === steps.length - 1;
    const tt = t.tutorials.player;

    const rect = useTargetRect(step.selector);

    // Latest design signature, readable inside the once-per-step effect.
    const designSigRef = useRef(designSig);
    useEffect(() => { designSigRef.current = designSig; });

    // Fire each step's action at most once per run (Back/Next won't re-trigger),
    // and snapshot the design signature for 'changed' gates at the same moment.
    const firedRef = useRef(new Set());
    const gateBaseRef = useRef({});
    const onActionRef = useRef(onAction);
    useEffect(() => { onActionRef.current = onAction; });
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

    // ── Gate: block Next until the step's condition is met ─────────────────────
    let blocked = false;
    const gate = step.gate;
    if (gate) {
        if (gate === true || gate === 'changed') {
            const base = gateBaseRef.current[idx];
            blocked = base === undefined || designSig === base;
        } else if (typeof gate === 'object' && gate.minLayers != null) {
            blocked = (designLayers || 0) < gate.minLayers;
        }
    }
    const gateHint = blocked
        ? (gate && typeof gate === 'object' && gate.minLayers != null
            ? tt.gateLayers(gate.minLayers, designLayers || 0)
            : tt.gateRun)
        : null;

    const finish = useCallback(() => { onComplete?.(lesson.key); onClose?.(true); }, [lesson.key, onComplete, onClose]);
    const next = useCallback(() => { if (last) finish(); else setIdx(i => i + 1); }, [last, finish]);
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
                position: 'fixed', right: 18, bottom: 18, width: PANEL_W, pointerEvents: 'auto',
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
                    style: { background: 'transparent', border: 'none', color: c.textDim, fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: '0 2px', flexShrink: 0 },
                }, '×'),
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

            // Controls
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 } },
                h('button', {
                    onClick: () => onClose?.(false),
                    style: { padding: '7px 10px', border: 'none', background: 'transparent', color: c.textDim, fontSize: 12, cursor: 'pointer' },
                }, tt.exit),
                h('div', { style: { display: 'flex', gap: 8 } },
                    idx > 0 && h('button', {
                        onClick: back,
                        style: { padding: '7px 16px', borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${c.border}`, background: 'transparent', color: c.text },
                    }, tt.back),
                    h('button', {
                        onClick: blocked ? undefined : next,
                        disabled: blocked,
                        title: blocked ? gateHint : undefined,
                        style: {
                            padding: '7px 18px', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
                            cursor: blocked ? 'not-allowed' : 'pointer', border: 'none',
                            background: blocked ? c.border : c.accent, color: blocked ? c.textDim : '#fff',
                            opacity: blocked ? 0.7 : 1,
                        },
                    }, last ? tt.finish : tt.next),
                ),
            ),
        ),
    );
}
