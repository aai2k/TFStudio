// ── Guided tour spotlight overlay ──────────────────────────────────────────────
//
// A step-through onboarding tour. Each step points at a UI region tagged with a
// `data-tour="<id>"` attribute (project explorer, ribbon groups, docking area);
// the tour dims the rest of the screen, draws an accent spotlight around the
// target, and shows a tooltip card with Back / Next / Skip controls.
//
// Robust to missing targets (e.g. a ribbon group scrolled out of view): if the
// element can't be found it scrolls it into view, and failing that falls back to
// a centered card with no spotlight. Pure presentation — `onClose()` is the only
// app callback; all text comes from `t.tour.*`.

import { useTargetRect } from './useTargetRect.js';

const { createElement: h, useState, useEffect, useCallback, useRef } = React;

// Ordered tour steps. `sel` resolves a data-tour anchor; `k` keys into
// t.tour.steps[k] = { title, body }; `placement` is the preferred card side.
const STEPS = [
    { sel: '[data-tour="explorer"]',           k: 'explorer',     placement: 'right'  },
    { sel: '[data-tour="ribbon-design"]',      k: 'design',       placement: 'bottom' },
    { sel: '[data-tour="ribbon-analysis"]',    k: 'analysis',     placement: 'bottom' },
    { sel: '[data-tour="ribbon-optimization"]',k: 'optimization', placement: 'bottom' },
    { sel: '[data-tour="docking"]',            k: 'workspace',    placement: 'left'   },
    { sel: '[data-tour="ribbon-information"]', k: 'help',         placement: 'bottom' },
];

const PAD = 6;          // spotlight padding around the target
const CARD_W = 330;     // fixed tooltip width (used for placement math)

export function GuidedTour({ c, t, onClose }) {
    const [idx, setIdx] = useState(0);
    const cardRef = useRef(null);

    const steps = STEPS;
    const step = steps[idx];
    const last = idx === steps.length - 1;
    const tt = t.tour;
    const stepText = tt.steps[step.k] || { title: '', body: '' };

    const rect = useTargetRect(step?.sel);

    const next = useCallback(() => { if (last) onClose(); else setIdx(i => i + 1); }, [last, onClose]);
    const back = useCallback(() => setIdx(i => Math.max(0, i - 1)), []);

    // Keyboard: →/Enter next, ← back, Esc skip.
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape')      { e.preventDefault(); onClose(); }
            else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [next, back, onClose]);

    // ── Card position from target rect + placement (clamped to viewport) ───────
    const vw = window.innerWidth, vh = window.innerHeight;
    let cardStyle;
    if (!rect) {
        cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    } else {
        let top, left;
        const p = step.placement;
        if (p === 'right')       { left = rect.right + 12;          top = rect.top; }
        else if (p === 'left')   { left = rect.left - CARD_W - 12;  top = rect.top; }
        else if (p === 'top')    { left = rect.left;                top = rect.top - 12; }
        else /* bottom */        { left = rect.left;                top = rect.bottom + 12; }
        left = Math.max(12, Math.min(left, vw - CARD_W - 12));
        top  = Math.max(12, Math.min(top, vh - 200));
        cardStyle = { top, left };
    }

    const btn = (label, onClick, primary) => h('button', {
        onClick,
        style: {
            padding: '7px 16px', borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            border: primary ? 'none' : `1px solid ${c.border}`,
            background: primary ? c.accent : 'transparent',
            color: primary ? '#fff' : c.text,
        },
    }, label);

    return h('div', { style: { position: 'fixed', inset: 0, zIndex: 10002, pointerEvents: 'none' } },
        // Click-blocker: swallows interaction with the app behind the tour. When
        // no target is highlighted it also supplies the screen dim (otherwise the
        // spotlight's box-shadow does).
        h('div', {
            onClick: (e) => e.stopPropagation(),
            style: {
                position: 'fixed', inset: 0, pointerEvents: 'auto',
                background: rect ? 'transparent' : 'rgba(0,0,0,0.62)',
            },
        }),

        // Spotlight cut-out around the target.
        rect && h('div', {
            style: {
                position: 'fixed',
                top: rect.top - PAD, left: rect.left - PAD,
                width: rect.width + PAD * 2, height: rect.height + PAD * 2,
                borderRadius: 8, pointerEvents: 'none',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
                border: `2px solid ${c.accent}`,
                transition: 'all 0.18s ease',
            },
        }),

        // Tooltip card.
        h('div', {
            ref: cardRef,
            style: {
                position: 'fixed', ...cardStyle, width: CARD_W, pointerEvents: 'auto',
                background: c.panel, border: `1px solid ${c.border}`, borderRadius: 10,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)', padding: 18, zIndex: 10003,
                fontFamily: 'system-ui, -apple-system, sans-serif',
            },
        },
            h('div', { style: { fontSize: 15, fontWeight: 700, color: c.text, marginBottom: 7 } }, stepText.title),
            h('div', { style: { fontSize: 12.5, color: c.textDim, lineHeight: 1.5, marginBottom: 16 } }, stepText.body),
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                h('span', { style: { fontSize: 11.5, color: c.textDim } }, `${idx + 1} / ${steps.length}`),
                h('div', { style: { display: 'flex', gap: 8 } },
                    h('button', {
                        onClick: onClose,
                        style: { padding: '7px 12px', borderRadius: 6, fontSize: 12.5, cursor: 'pointer',
                                 border: 'none', background: 'transparent', color: c.textDim },
                    }, tt.skip),
                    idx > 0 && btn(tt.back, back, false),
                    btn(last ? tt.done : tt.next, next, true),
                ),
            ),
        ),
    );
}
